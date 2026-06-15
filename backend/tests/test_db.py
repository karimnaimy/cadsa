"""
Tests for the database layer (DuckDB analytics + SQLite app data).

Uses in-memory DuckDB and a session-scoped temp SQLite from conftest.
No network, no GeoIP, no external services.
"""
from datetime import datetime, timezone

import pytest
import pytest_asyncio

# ── DuckDB tests ───────────────────────────────────────────────────────────────

class TestDuckDBSchema:
    def test_tables_created(self, duck_conn):
        tables = {row[0] for row in duck_conn.execute("SHOW TABLES").fetchall()}
        for expected in ("requests", "parse_errors", "stats_minutely", "stats_hourly",
                         "security_events", "top_paths_hourly", "top_ips_hourly"):
            assert expected in tables, f"Missing table: {expected}"

    def test_requests_columns(self, duck_conn):
        cols = {row[0] for row in duck_conn.execute("DESCRIBE requests").fetchall()}
        for required in ("id", "ts", "host", "remote_ip", "method", "status",
                         "tls_version", "tls_cipher", "country_code", "threat_score"):
            assert required in cols, f"Missing column: {required}"


class TestDuckDBInsertAndQuery:
    def _make_row(self, **overrides):
        base = {
            "ts": datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc),
            "host": "test.example.com",
            "remote_ip": "1.2.3.4",
            "method": "GET",
            "uri": "/api/v1/test",
            "path": "/api/v1/test",
            "query": "",
            "protocol": "HTTP/2.0",
            "status": 200,
            "status_class": "2xx",
            "response_bytes": 512,
            "request_bytes": 0,
            "duration_ms": 45,
            "user_agent": "TestBot/1.0",
            "ua_browser": "Chrome",
            "ua_os": "Linux",
            "ua_device": "desktop",
            "referer": "",
            "referer_domain": "",
            "tls_version": "TLS 1.3",
            "tls_cipher": "TLS_AES_128_GCM_SHA256",
            "tls_alpn": "h2",
            "tls_resumed": False,
            "tls_ech": False,
            "http_proto": "HTTP/2.0",
            "logger_id": "log1",
            "logger_name": "http.log.access.log1",
            "log_source": "/var/log/caddy/access.log",
            "country_code": "US",
            "country_name": "United States",
            "city": "New York",
            "latitude": 40.7128,
            "longitude": -74.0060,
            "asn": 15169,
            "org": "Google LLC",
            "is_bot": False,
            "threat_score": 0,
        }
        base.update(overrides)
        return base

    def test_insert_and_retrieve(self, duck_conn):
        from db.duckdb_manager import insert_request, get_conn
        row = self._make_row()
        insert_request(row)

        result = duck_conn.execute(
            "SELECT host, remote_ip, status FROM requests WHERE remote_ip = '1.2.3.4'"
        ).fetchone()
        assert result is not None
        assert result[0] == "test.example.com"
        assert result[2] == 200

    def test_insert_4xx_row(self, duck_conn):
        from db.duckdb_manager import insert_request
        row = self._make_row(
            remote_ip="10.0.0.1",
            status=404,
            status_class="4xx",
            uri="/missing",
            path="/missing",
        )
        insert_request(row)
        result = duck_conn.execute(
            "SELECT status_class FROM requests WHERE remote_ip = '10.0.0.1'"
        ).fetchone()
        assert result[0] == "4xx"

    def test_query_overview_returns_structure(self, duck_conn):
        from db.duckdb_manager import query_overview
        from datetime import timedelta

        end = datetime(2024, 7, 1, tzinfo=timezone.utc)
        start = end - timedelta(days=1)
        result = query_overview(start, end)
        assert isinstance(result, dict)
        for key in ("total_requests", "unique_ips", "error_rate", "p50_ms"):
            assert key in result

    def test_query_top_paths(self, duck_conn):
        from db.duckdb_manager import insert_request, query_top_paths
        from datetime import timedelta

        row = self._make_row(
            remote_ip="55.55.55.55",
            uri="/top-path-test",
            path="/top-path-test",
            ts=datetime(2024, 6, 1, 12, 30, 0, tzinfo=timezone.utc),
        )
        insert_request(row)

        end = datetime(2024, 6, 2, tzinfo=timezone.utc)
        start = end - timedelta(days=2)
        rows = query_top_paths(start, end, limit=20)
        assert isinstance(rows, list)

    def test_query_top_countries(self, duck_conn):
        from db.duckdb_manager import query_top_countries
        from datetime import timedelta

        end = datetime(2024, 7, 1, tzinfo=timezone.utc)
        start = end - timedelta(days=60)
        rows = query_top_countries(start, end)
        assert isinstance(rows, list)
        if rows:
            assert "country_code" in rows[0]
            assert "req_count" in rows[0]

    def test_query_timeseries(self, duck_conn):
        from db.duckdb_manager import query_timeseries
        from datetime import timedelta

        end = datetime(2024, 7, 1, tzinfo=timezone.utc)
        start = end - timedelta(days=2)
        rows = query_timeseries(start, end, bucket="1 hour")
        assert isinstance(rows, list)

    def test_insert_parse_error(self, duck_conn):
        from db.duckdb_manager import insert_parse_error

        insert_parse_error(
            raw_line="{bad json}",
            error_msg="JSONDecodeError: ...",
            log_source="/var/log/caddy/access.log",
        )
        count = duck_conn.execute("SELECT COUNT(*) FROM parse_errors").fetchone()[0]
        assert count >= 1


# ── SQLite tests ───────────────────────────────────────────────────────────────

class TestSQLiteUserManagement:
    @pytest_asyncio.fixture(autouse=True)
    async def _unique_user(self, sqlite_db):
        # Each test gets a fresh username to avoid UNIQUE conflicts
        import time
        self._suffix = str(int(time.time() * 1000))[-6:]

    async def _make_username(self):
        return f"dbtest_{self._suffix}"

    @pytest.mark.asyncio
    async def test_create_and_get_user(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("SomePass1!"))
        user = await sm.get_user_by_username(username)
        assert user is not None
        assert user["id"] == uid
        assert user["username"] == username
        assert user["must_change_password"] == 1

    @pytest.mark.asyncio
    async def test_get_nonexistent_user_returns_none(self, sqlite_db):
        import db.sqlite_manager as sm
        result = await sm.get_user_by_username("no_such_user_xyz")
        assert result is None

    @pytest.mark.asyncio
    async def test_update_password_clears_must_change(self, sqlite_db):
        from api.auth_utils import hash_password, verify_password
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("OldPass1!"))
        await sm.update_password(uid, hash_password("NewPass2@"))

        user = await sm.get_user_by_username(username)
        assert user["must_change_password"] == 0
        assert verify_password(user["password_hash"], "NewPass2@")

    @pytest.mark.asyncio
    async def test_totp_secret_stored(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm
        import pyotp

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("APass3#"))
        secret = pyotp.random_base32()
        await sm.set_totp_secret(uid, secret)

        user = await sm.get_user_by_id(uid)
        assert user["totp_secret"] == secret
        assert user["totp_confirmed"] == 0

    @pytest.mark.asyncio
    async def test_confirm_totp(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm
        import pyotp
        import json

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("BPass4$"))
        await sm.set_totp_secret(uid, pyotp.random_base32())
        await sm.confirm_totp(uid, json.dumps(["code1", "code2"]))

        user = await sm.get_user_by_id(uid)
        assert user["totp_confirmed"] == 1

    @pytest.mark.asyncio
    async def test_record_login_failure_increments_count(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("CPass5%"))

        count = await sm.record_login_failure(uid)
        assert count == 1
        count = await sm.record_login_failure(uid)
        assert count == 2

    @pytest.mark.asyncio
    async def test_account_locked_after_10_failures(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("DPass6^"))

        for _ in range(10):
            await sm.record_login_failure(uid)

        user = await sm.get_user_by_id(uid)
        assert user["locked_until"] is not None

    @pytest.mark.asyncio
    async def test_record_login_success_resets_failures(self, sqlite_db):
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("EPass7&"))
        await sm.record_login_failure(uid)
        await sm.record_login_failure(uid)
        await sm.record_login_success(uid)

        user = await sm.get_user_by_id(uid)
        assert user["failed_attempts"] == 0
        assert user["locked_until"] is None

    @pytest.mark.asyncio
    async def test_refresh_token_store_validate_revoke(self, sqlite_db):
        from api.auth_utils import hash_password, create_refresh_token
        import db.sqlite_manager as sm

        username = await self._make_username()
        uid = await sm.create_user(username, hash_password("FPass8*"))
        tok = create_refresh_token()

        await sm.store_refresh_token(uid, tok, "TestAgent/1.0", "127.0.0.1")

        row = await sm.validate_refresh_token(tok)
        assert row is not None
        assert row["user_id"] == uid

        await sm.revoke_refresh_token(tok)
        row2 = await sm.validate_refresh_token(tok)
        assert row2 is None
