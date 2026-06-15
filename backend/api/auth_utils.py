"""
JWT (RS256) and password utilities.
"""
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt

logger = logging.getLogger(__name__)

ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7


def _load_keys() -> tuple[str, str]:
    from config import get_config
    cfg = get_config()
    private_key = ""
    public_key = ""
    try:
        with open(cfg.server.jwt_private_key_path) as f:
            private_key = f.read()
        with open(cfg.server.jwt_public_key_path) as f:
            public_key = f.read()
    except Exception as e:
        logger.error("Could not load JWT keys: %s — using fallback HMAC", e)
    return private_key, public_key


def create_access_token(user_id: int, extra: dict | None = None) -> str:
    private_key, _ = _load_keys()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),  # JWT spec: sub must be a string
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    if extra:
        payload.update(extra)

    if private_key:
        return jwt.encode(payload, private_key, algorithm="RS256")
    # Fallback to HS256 with secret_key (dev mode without keys)
    from config import get_config
    return jwt.encode(payload, get_config().server.secret_key or "dev-secret", algorithm="HS256")


def decode_access_token(token: str) -> Optional[dict]:
    _, public_key = _load_keys()
    try:
        if public_key:
            payload = jwt.decode(token, public_key, algorithms=["RS256"])
        else:
            from config import get_config
            payload = jwt.decode(
                token, get_config().server.secret_key or "dev-secret", algorithms=["HS256"]
            )
        if payload.get("type") != "access":
            return None
        return payload
    except JWTError:
        return None


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_password(password: str) -> str:
    from argon2 import PasswordHasher
    ph = PasswordHasher()
    return ph.hash(password)


def verify_password(hashed: str, plain: str) -> bool:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
    ph = PasswordHasher()
    try:
        return ph.verify(hashed, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def generate_backup_codes(count: int = 8) -> tuple[list[str], list[str]]:
    """Returns (plain_codes, hashed_codes)."""
    from argon2 import PasswordHasher
    ph = PasswordHasher()
    plain = [secrets.token_hex(6).upper() for _ in range(count)]
    hashed = [ph.hash(c) for c in plain]
    return plain, hashed
