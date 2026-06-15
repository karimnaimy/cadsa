"""
Shared pytest fixtures for cadsa backend tests.

Strategy:
- SQLite: a real temp file per test session (aiosqlite requires a real path)
- DuckDB: in-memory ":memory:" connection per test session
- FastAPI TestClient: app wired to the above DBs, no GeoIP, no log watcher
- No network calls; no systemd; no Caddy
"""
import os
import tempfile

import duckdb
import pyotp
import pytest
import pytest_asyncio

os.environ.setdefault("CADSA_DEV_MODE", "1")
os.environ.setdefault("CADSA_LOG_LEVEL", "error")

# ── Config bootstrap ───────────────────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _bootstrap_config(tmp_path_factory):
    """
    Inject a fully in-memory config before any module reads get_config().
    We build the CadsaConfig directly instead of going through load_config()
    so there is no file I/O and no dependency on /etc/cadsa.
    """
    tmp = tmp_path_factory.mktemp("cadsa_test")
    sqlite_path = str(tmp / "app.sqlite")

    import config as cfg_module
    from config import (
        CadsaConfig, ServerConfig, CaddyConfig, LogsConfig,
        DatabaseConfig, GeoIPConfig, SecurityConfig,
        AlertsConfig, ThreatIntelConfig,
    )

    cfg_module._config = CadsaConfig(
        server=ServerConfig(
            secret_key="test-secret-key-for-unit-tests-only",
            jwt_private_key_path="",
            jwt_public_key_path="",
        ),
        caddy=CaddyConfig(admin_api_enabled=False),
        logs=LogsConfig(auto_discover=False),
        database=DatabaseConfig(analytics_path=":memory:", app_path=sqlite_path),
        geoip=GeoIPConfig(enabled=False),
        security=SecurityConfig(),
        alerts=AlertsConfig(),
        threat_intel=ThreatIntelConfig(),
    )
    yield


# ── SQLite fixture ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def sqlite_db(_bootstrap_config):
    """Initialized SQLite DB (real temp file, session-scoped)."""
    import db.sqlite_manager as sm
    from config import get_config

    sm.init_sqlite(get_config().database.app_path)
    await sm.create_tables()
    return sm.get_db_path()


# ── DuckDB fixture ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def duck_conn(_bootstrap_config):
    """In-memory DuckDB connection, session-scoped."""
    import db.duckdb_manager as dm

    conn = dm.init_duckdb(":memory:")
    return conn


# ── FastAPI test client ────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def client(sqlite_db, duck_conn):
    """
    httpx AsyncClient wired to the test app.
    Skips lifespan (db already initialized above).
    """
    from fastapi.testclient import TestClient
    from api.auth import router as auth_router
    from api.analytics import router as analytics_router
    from api.security_api import router as security_router
    from api.alerts import router as alerts_router
    from api.settings import router as settings_router
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(analytics_router, prefix="/api/v1")
    app.include_router(security_router, prefix="/api/v1")
    app.include_router(alerts_router, prefix="/api/v1")
    app.include_router(settings_router, prefix="/api/v1")

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


# ── Auth helpers ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def test_user(sqlite_db):
    """Create a test user without forced password/2FA change."""
    from api.auth_utils import hash_password
    import db.sqlite_manager as sm

    uid = await sm.create_user(
        username="testuser",
        password_hash=hash_password("TestPassword1!"),
        email="test@example.com",
        must_change_password=False,
    )
    # Give the user a confirmed TOTP so full login flow works
    secret = pyotp.random_base32()
    await sm.set_totp_secret(uid, secret)
    await sm.confirm_totp(uid, "[]")  # empty backup codes for simplicity

    return {"id": uid, "username": "testuser", "password": "TestPassword1!", "totp_secret": secret}


@pytest.fixture(scope="session")
def auth_headers(test_user):
    """
    Bearer headers for authenticated tests.
    Token is minted directly (bypassing HTTP) — the HTTP login flow is covered
    separately in TestLoginFlow.
    """
    from api.auth_utils import create_access_token
    token = create_access_token(test_user["id"])
    return {"Authorization": f"Bearer {token}"}
