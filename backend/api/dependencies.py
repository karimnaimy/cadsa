"""
FastAPI dependency injection — JWT auth guard + time range resolver.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.auth_utils import decode_access_token
from db.sqlite_manager import get_user_by_id

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


# ── Auth ─────────────────────────────────────────────────────────────────────

async def require_auth(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)],
) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = await get_user_by_id(int(payload["sub"]))
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


async def require_auth_ws(websocket: WebSocket) -> Optional[dict]:
    """WebSocket auth — token passed as query param ?token=<jwt>."""
    token = websocket.query_params.get("token")
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    user = await get_user_by_id(int(payload["sub"]))
    return user if user and user.get("is_active") else None


CurrentUser = Annotated[dict, Depends(require_auth)]


# ── Time Range ────────────────────────────────────────────────────────────────

@dataclass
class TimeRange:
    from_ts:     datetime
    to_ts:       datetime
    bucket:      str   # DuckDB time_bucket interval (e.g. "1 hour", "15 minutes")
    granularity: str   # Frontend chart hint (e.g. "hour", "15min", "8hour")


# period → (lookback timedelta, DuckDB bucket string, frontend granularity hint)
_PERIOD_CFG: dict[str, tuple[timedelta, str, str]] = {
    "l15m": (timedelta(minutes=15), "1 minute",   "minute"),
    "l1h":  (timedelta(hours=1),    "1 minute",   "minute"),
    "l6h":  (timedelta(hours=6),    "15 minutes", "15min"),
    "l24h": (timedelta(hours=24),   "1 hour",     "hour"),
    "l7d":  (timedelta(days=7),     "8 hours",    "8hour"),
    "l30d": (timedelta(days=30),    "1 day",      "day"),
}


async def resolve_time_range(
    period: Optional[str] = Query(
        None,
        pattern=r"^(l15m|l1h|l6h|l24h|l7d|l30d)$",
        description="Relative period, e.g. l1h, l24h, l7d",
    ),
    date: Optional[str] = Query(
        None,
        description="Specific calendar date as ISO-8601 with UTC offset, e.g. 2024-01-13T00:00:00+02:00",
    ),
) -> TimeRange:
    now = datetime.now(timezone.utc)

    if date:
        try:
            local_midnight = datetime.fromisoformat(date)
            from_ts = local_midnight.astimezone(timezone.utc)
            to_ts   = from_ts + timedelta(hours=24)
            return TimeRange(from_ts=from_ts, to_ts=to_ts, bucket="1 hour", granularity="hour")
        except Exception:
            pass  # fall through to default

    delta, bucket, granularity = _PERIOD_CFG.get(period or "l24h", _PERIOD_CFG["l24h"])
    return TimeRange(from_ts=now - delta, to_ts=now, bucket=bucket, granularity=granularity)


TimeRangeDep = Annotated[TimeRange, Depends(resolve_time_range)]
