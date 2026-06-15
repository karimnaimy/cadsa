import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import aiosqlite

from config import get_config

logger = logging.getLogger(__name__)

_db_path: str = ""


def init_sqlite(path: Optional[str] = None) -> None:
    global _db_path
    cfg = get_config()
    _db_path = path or cfg.database.app_path


def get_db_path() -> str:
    if not _db_path:
        raise RuntimeError("SQLite not initialized — call init_sqlite() first")
    return _db_path


async def create_tables() -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id                   INTEGER PRIMARY KEY,
                username             TEXT UNIQUE NOT NULL,
                email                TEXT,
                password_hash        TEXT NOT NULL,
                is_active            INTEGER DEFAULT 1,
                must_change_password INTEGER DEFAULT 1,
                totp_secret          TEXT,
                totp_confirmed       INTEGER DEFAULT 0,
                backup_codes         TEXT,
                created_at           TEXT,
                last_login           TEXT,
                failed_attempts      INTEGER DEFAULT 0,
                locked_until         TEXT
            );

            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id          INTEGER PRIMARY KEY,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
                token_hash  TEXT UNIQUE NOT NULL,
                issued_at   TEXT,
                expires_at  TEXT,
                revoked     INTEGER DEFAULT 0,
                user_agent  TEXT,
                remote_ip   TEXT
            );

            CREATE TABLE IF NOT EXISTS auth_audit (
                id          INTEGER PRIMARY KEY,
                ts          TEXT NOT NULL,
                user_id     INTEGER,
                event       TEXT NOT NULL,
                remote_ip   TEXT,
                user_agent  TEXT,
                detail      TEXT
            );

            CREATE TABLE IF NOT EXISTS alert_rules (
                id               INTEGER PRIMARY KEY,
                name             TEXT NOT NULL,
                enabled          INTEGER DEFAULT 1,
                rule_type        TEXT NOT NULL,
                conditions       TEXT NOT NULL,
                cooldown_minutes INTEGER DEFAULT 30,
                last_triggered   TEXT,
                notifiers        TEXT
            );

            CREATE TABLE IF NOT EXISTS alert_history (
                id           INTEGER PRIMARY KEY,
                rule_id      INTEGER REFERENCES alert_rules(id) ON DELETE CASCADE,
                triggered_at TEXT,
                resolved_at  TEXT,
                details      TEXT
            );

            CREATE TABLE IF NOT EXISTS settings (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ip_whitelist (
                id         INTEGER PRIMARY KEY,
                cidr       TEXT UNIQUE NOT NULL,
                note       TEXT,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ip_blocklist (
                id         INTEGER PRIMARY KEY,
                cidr       TEXT UNIQUE NOT NULL,
                note       TEXT,
                created_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit(ts);
            CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit(user_id);
        """)
        await db.commit()
    logger.info("SQLite initialized at %s", _db_path)


# ── User helpers ───────────────────────────────────────────────────────────────

async def get_user_by_username(username: str) -> Optional[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE username = ?", (username,)) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None


async def get_user_by_id(user_id: int) -> Optional[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None


async def create_user(
    username: str, password_hash: str, email: str = "", must_change_password: bool = True
) -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """INSERT INTO users (username, email, password_hash, is_active,
                must_change_password, created_at)
               VALUES (?, ?, ?, 1, ?, ?)""",
            (username, email, password_hash, int(must_change_password), _now()),
        )
        await db.commit()
        return cursor.lastrowid  # type: ignore[return-value]


async def update_password(user_id: int, password_hash: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (password_hash, user_id),
        )
        await db.commit()


async def set_totp_secret(user_id: int, secret: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE users SET totp_secret = ?, totp_confirmed = 0 WHERE id = ?",
            (secret, user_id),
        )
        await db.commit()


async def confirm_totp(user_id: int, backup_codes_json: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE users SET totp_confirmed = 1, backup_codes = ? WHERE id = ?",
            (backup_codes_json, user_id),
        )
        await db.commit()


async def record_login_success(user_id: int) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE users SET last_login = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?",
            (_now(), user_id),
        )
        await db.commit()


async def record_login_failure(user_id: int) -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?",
            (user_id,),
        )
        async with db.execute("SELECT failed_attempts FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
        attempts = row[0] if row else 0
        if attempts >= 10:
            locked = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
            await db.execute(
                "UPDATE users SET locked_until = ? WHERE id = ?", (locked, user_id)
            )
        await db.commit()
        return attempts


async def consume_backup_code(user_id: int, code: str) -> bool:
    """Returns True if code was valid and consumed."""
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError

    ph = PasswordHasher()
    user = await get_user_by_id(user_id)
    if not user or not user.get("backup_codes"):
        return False

    codes: list[str] = json.loads(user["backup_codes"])
    for i, hashed in enumerate(codes):
        try:
            ph.verify(hashed, code)
            codes.pop(i)
            async with aiosqlite.connect(get_db_path()) as db:
                await db.execute(
                    "UPDATE users SET backup_codes = ? WHERE id = ?",
                    (json.dumps(codes), user_id),
                )
                await db.commit()
            return True
        except VerifyMismatchError:
            continue
    return False


# ── Refresh tokens ─────────────────────────────────────────────────────────────

async def store_refresh_token(
    user_id: int, token: str, user_agent: str = "", remote_ip: str = ""
) -> None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """INSERT INTO refresh_tokens (user_id, token_hash, issued_at, expires_at, user_agent, remote_ip)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, token_hash, _now(), expires, user_agent, remote_ip),
        )
        await db.commit()


async def validate_refresh_token(token: str) -> Optional[dict]:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT * FROM refresh_tokens
               WHERE token_hash = ? AND revoked = 0 AND expires_at > ?""",
            (token_hash, _now()),
        ) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None


async def revoke_refresh_token(token: str) -> None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?", (token_hash,)
        )
        await db.commit()


async def revoke_all_user_tokens(user_id: int) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?", (user_id,)
        )
        await db.commit()


# ── Audit log ──────────────────────────────────────────────────────────────────

async def audit_log(
    event: str,
    user_id: Optional[int] = None,
    remote_ip: str = "",
    user_agent: str = "",
    detail: str = "",
) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            """INSERT INTO auth_audit (ts, user_id, event, remote_ip, user_agent, detail)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (_now(), user_id, event, remote_ip, user_agent, detail),
        )
        await db.commit()


# ── Alert rules ────────────────────────────────────────────────────────────────

async def get_alert_rules(enabled_only: bool = False) -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        sql = "SELECT * FROM alert_rules"
        if enabled_only:
            sql += " WHERE enabled = 1"
        sql += " ORDER BY id"
        async with db.execute(sql) as cur:
            rows = await cur.fetchall()
        return [_parse_rule(dict(r)) for r in rows]


async def create_alert_rule(data: dict) -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            """INSERT INTO alert_rules (name, enabled, rule_type, conditions, cooldown_minutes, notifiers)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                data["name"], data.get("enabled", 1), data["rule_type"],
                json.dumps(data.get("conditions", {})),
                data.get("cooldown_minutes", 30),
                json.dumps(data.get("notifiers", [])),
            ),
        )
        await db.commit()
        return cursor.lastrowid  # type: ignore[return-value]


async def update_alert_rule(rule_id: int, data: dict) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        fields: list[str] = []
        params: list[Any] = []
        for key in ("name", "enabled", "rule_type", "cooldown_minutes"):
            if key in data:
                fields.append(f"{key} = ?")
                params.append(data[key])
        if "conditions" in data:
            fields.append("conditions = ?")
            params.append(json.dumps(data["conditions"]))
        if "notifiers" in data:
            fields.append("notifiers = ?")
            params.append(json.dumps(data["notifiers"]))
        if not fields:
            return False
        params.append(rule_id)
        await db.execute(
            f"UPDATE alert_rules SET {', '.join(fields)} WHERE id = ?", params
        )
        await db.commit()
        return True


async def delete_alert_rule(rule_id: int) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        await db.commit()
        return True


async def record_alert_triggered(rule_id: int, details: dict) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "UPDATE alert_rules SET last_triggered = ? WHERE id = ?",
            (_now(), rule_id),
        )
        await db.execute(
            "INSERT INTO alert_history (rule_id, triggered_at, details) VALUES (?, ?, ?)",
            (rule_id, _now(), json.dumps(details)),
        )
        await db.commit()


async def get_alert_history(limit: int = 100, offset: int = 0) -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT h.*, r.name as rule_name
               FROM alert_history h
               LEFT JOIN alert_rules r ON r.id = h.rule_id
               ORDER BY h.triggered_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ) as cur:
            rows = await cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("details"):
                d["details"] = json.loads(d["details"])
            result.append(d)
        return result


# ── Settings ───────────────────────────────────────────────────────────────────

async def get_setting(key: str) -> Optional[str]:
    async with aiosqlite.connect(get_db_path()) as db:
        async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
        return row[0] if row else None


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, _now()),
        )
        await db.commit()


async def get_all_settings() -> dict[str, str]:
    async with aiosqlite.connect(get_db_path()) as db:
        async with db.execute("SELECT key, value FROM settings") as cur:
            rows = await cur.fetchall()
        return {r[0]: r[1] for r in rows}


# ── IP Whitelist ───────────────────────────────────────────────────────────────

async def get_whitelist() -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM ip_whitelist ORDER BY id") as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_whitelist(cidr: str, note: str = "") -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "INSERT OR IGNORE INTO ip_whitelist (cidr, note, created_at) VALUES (?, ?, ?)",
            (cidr, note, _now()),
        )
        await db.commit()
        return cursor.lastrowid  # type: ignore[return-value]


async def remove_whitelist(entry_id: int) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM ip_whitelist WHERE id = ?", (entry_id,))
        await db.commit()
        return True


# ── IP Blocklist ──────────────────────────────────────────────────────────────

async def get_blocklist() -> list[dict]:
    async with aiosqlite.connect(get_db_path()) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM ip_blocklist ORDER BY id") as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_blocklist(cidr: str, note: str = "") -> int:
    async with aiosqlite.connect(get_db_path()) as db:
        cursor = await db.execute(
            "INSERT OR IGNORE INTO ip_blocklist (cidr, note, created_at) VALUES (?, ?, ?)",
            (cidr, note, _now()),
        )
        await db.commit()
        return cursor.lastrowid  # type: ignore[return-value]


async def remove_blocklist(entry_id: int) -> bool:
    async with aiosqlite.connect(get_db_path()) as db:
        await db.execute("DELETE FROM ip_blocklist WHERE id = ?", (entry_id,))
        await db.commit()
        return True


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_rule(r: dict) -> dict:
    if r.get("conditions"):
        try:
            r["conditions"] = json.loads(r["conditions"])
        except Exception:
            pass
    if r.get("notifiers"):
        try:
            r["notifiers"] = json.loads(r["notifiers"])
        except Exception:
            pass
    return r
