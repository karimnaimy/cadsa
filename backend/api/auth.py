"""
Auth API endpoints — login, 2FA, refresh, logout, password change, TOTP setup.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import pyotp
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, field_validator

from api.auth_utils import (
    create_access_token,
    create_refresh_token,
    generate_backup_codes,
    hash_password,
    verify_password,
)
from api.dependencies import CurrentUser
from db.sqlite_manager import (
    audit_log,
    confirm_totp,
    consume_backup_code,
    get_user_by_username,
    record_login_failure,
    record_login_success,
    revoke_refresh_token,
    set_totp_secret,
    store_refresh_token,
    update_password,
    validate_refresh_token,
    get_user_by_id,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


# ── Request models ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TwoFARequest(BaseModel):
    partial_token: str
    code: str


class BackupCodeRequest(BaseModel):
    partial_token: str
    code: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_strength(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain an uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain a digit")
        return v


class ConfirmTOTPRequest(BaseModel):
    code: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def _user_agent(request: Request) -> str:
    return request.headers.get("User-Agent", "")[:256]


# Partial token store (in-memory, short-lived — user_id after password OK but before 2FA)
# In production this would be Redis; for Phase 1 a simple dict is fine
import secrets as _secrets
_partial_tokens: dict[str, dict] = {}


def _create_partial_token(user_id: int) -> str:
    tok = _secrets.token_urlsafe(32)
    _partial_tokens[tok] = {
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).timestamp(),
    }
    return tok


def _consume_partial_token(token: str) -> Optional[int]:
    data = _partial_tokens.pop(token, None)
    if not data:
        return None
    age = datetime.now(timezone.utc).timestamp() - data["created_at"]
    if age > 300:  # 5 minutes
        return None
    return data["user_id"]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, request: Request) -> dict:
    ip = _client_ip(request)
    ua = _user_agent(request)

    user = await get_user_by_username(body.username)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Check account lock
    if user.get("locked_until"):
        locked = datetime.fromisoformat(user["locked_until"])
        if locked > datetime.now(timezone.utc):
            await audit_log("login_fail_locked", user["id"], ip, ua, "account locked")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Account temporarily locked. Try again later.",
            )

    if not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account inactive")

    if not verify_password(user["password_hash"], body.password):
        attempts = await record_login_failure(user["id"])
        await audit_log("login_fail", user["id"], ip, ua, f"bad password, attempt {attempts}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await audit_log("login_password_ok", user["id"], ip, ua)

    # If 2FA is not yet configured, skip straight to issuing tokens
    if not user.get("totp_confirmed"):
        await record_login_success(user["id"])
        refresh_tok = create_refresh_token()
        await store_refresh_token(user["id"], refresh_tok, ua, ip)
        access_tok = create_access_token(user["id"])
        await audit_log("login_ok_no2fa", user["id"], ip, ua)
        return {
            "access_token": access_tok,
            "refresh_token": refresh_tok,
            "token_type": "bearer",
            "must_setup_2fa": True,
            "must_change_password": bool(user.get("must_change_password")),
        }

    partial_token = _create_partial_token(user["id"])

    return {
        "requires_2fa": True,
        "requires_password_change": bool(user.get("must_change_password")),
        "partial_token": partial_token,
    }


@router.post("/login/2fa")
async def login_2fa(body: TwoFARequest, request: Request) -> dict:
    ip = _client_ip(request)
    ua = _user_agent(request)

    user_id = _consume_partial_token(body.partial_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if not user.get("totp_secret") or not user.get("totp_confirmed"):
        # 2FA not yet set up — issue full token with flag
        await record_login_success(user_id)
        refresh_tok = create_refresh_token()
        await store_refresh_token(user_id, refresh_tok, ua, ip)
        access_tok = create_access_token(user_id)
        await audit_log("login_ok_no2fa", user_id, ip, ua)
        return {
            "access_token": access_tok,
            "refresh_token": refresh_tok,
            "token_type": "bearer",
            "must_setup_2fa": True,
            "must_change_password": bool(user.get("must_change_password")),
        }

    # Verify TOTP (allow ±1 step drift)
    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        await audit_log("2fa_fail", user_id, ip, ua)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid 2FA code")

    await record_login_success(user_id)
    refresh_tok = create_refresh_token()
    await store_refresh_token(user_id, refresh_tok, ua, ip)
    access_tok = create_access_token(user_id)

    await audit_log("login_ok", user_id, ip, ua)

    return {
        "access_token": access_tok,
        "refresh_token": refresh_tok,
        "token_type": "bearer",
        "must_change_password": bool(user.get("must_change_password")),
    }


@router.post("/login/backup-code")
async def login_backup_code(body: BackupCodeRequest, request: Request) -> dict:
    ip = _client_ip(request)
    ua = _user_agent(request)

    user_id = _consume_partial_token(body.partial_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

    consumed = await consume_backup_code(user_id, body.code)
    if not consumed:
        await audit_log("backup_code_fail", user_id, ip, ua)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid backup code")

    await record_login_success(user_id)
    refresh_tok = create_refresh_token()
    await store_refresh_token(user_id, refresh_tok, ua, ip)
    access_tok = create_access_token(user_id)

    await audit_log("backup_code_used", user_id, ip, ua)
    return {
        "access_token": access_tok,
        "refresh_token": refresh_tok,
        "token_type": "bearer",
    }


@router.post("/refresh")
async def refresh_token(body: RefreshRequest) -> dict:
    token_row = await validate_refresh_token(body.refresh_token)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = await get_user_by_id(token_row["user_id"])
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    access_tok = create_access_token(user["id"])
    return {"access_token": access_tok, "token_type": "bearer"}


@router.post("/logout")
async def logout(body: RefreshRequest, current_user: CurrentUser) -> dict:
    await revoke_refresh_token(body.refresh_token)
    await audit_log("logout", current_user["id"])
    return {"ok": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, current_user: CurrentUser, request: Request) -> dict:
    if not verify_password(current_user["password_hash"], body.current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    new_hash = hash_password(body.new_password)
    await update_password(current_user["id"], new_hash)
    await audit_log("pw_change", current_user["id"], _client_ip(request))
    return {"ok": True}


@router.get("/2fa/setup")
async def setup_2fa(current_user: CurrentUser) -> dict:
    secret = pyotp.random_base32()
    await set_totp_secret(current_user["id"], secret)

    totp = pyotp.TOTP(secret)
    username = current_user["username"]
    provisioning_uri = totp.provisioning_uri(name=username, issuer_name="cadsa")

    return {
        "secret": secret,
        "provisioning_uri": provisioning_uri,
    }


@router.post("/2fa/confirm")
async def confirm_2fa(body: ConfirmTOTPRequest, current_user: CurrentUser, request: Request) -> dict:
    user = await get_user_by_id(current_user["id"])
    if not user or not user.get("totp_secret"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up yet")

    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")

    plain_codes, hashed_codes = generate_backup_codes()
    await confirm_totp(current_user["id"], json.dumps(hashed_codes))
    await audit_log("2fa_confirmed", current_user["id"], _client_ip(request))

    return {
        "ok": True,
        "backup_codes": plain_codes,
    }


@router.get("/me")
async def get_me(current_user: CurrentUser) -> dict:
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "email": current_user.get("email"),
        "must_change_password": bool(current_user.get("must_change_password")),
        "totp_confirmed": bool(current_user.get("totp_confirmed")),
        "last_login": current_user.get("last_login"),
    }
