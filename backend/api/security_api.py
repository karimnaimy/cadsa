"""
Security events API.
"""
import ipaddress
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.analytics import FiltersDep
from api.dependencies import CurrentUser, TimeRangeDep
from db import duckdb_manager as db
from db.sqlite_manager import (
    add_whitelist, get_whitelist, remove_whitelist,
    add_blocklist, get_blocklist, remove_blocklist,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/security", tags=["security"])


@router.get("/events")
async def get_security_events(
    _: CurrentUser,
    tr: TimeRangeDep,
    f: FiltersDep,
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    rows, total = db.query_security_events(
        tr.from_ts, tr.to_ts, f.host, f.remote_ip, event_type, severity, limit, (page - 1) * limit
    )
    return {"total": total, "page": page, "limit": limit, "data": rows}


@router.get("/events/{event_id}")
async def get_security_event(_: CurrentUser, event_id: int) -> dict:
    from db.duckdb_manager import get_conn
    conn = get_conn()
    row = conn.execute(
        "SELECT id, ts, event_type, severity, remote_ip, host, uri, details, alert_sent FROM security_events WHERE id = ?",
        [event_id],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return {
        "id": row[0], "ts": row[1].isoformat() if row[1] else None,
        "event_type": row[2], "severity": row[3], "remote_ip": row[4],
        "host": row[5], "uri": row[6],
        "details": json.loads(row[7]) if row[7] else {},
        "alert_sent": row[8],
    }


@router.get("/top-threats")
async def get_top_threats(
    _: CurrentUser,
    tr: TimeRangeDep,
    limit: int = Query(20, ge=1, le=100),
) -> list:
    return db.query_top_threats(tr.from_ts, tr.to_ts, limit)


# ── IP status (must be declared before /ip/{ip} to avoid shadowing) ───────────

def _match_cidr(ip: str, entries: list[dict]) -> dict | None:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    for entry in entries:
        try:
            if addr in ipaddress.ip_network(entry["cidr"], strict=False):
                return entry
        except ValueError:
            continue
    return None


def _is_individual(cidr: str) -> bool:
    try:
        net = ipaddress.ip_network(cidr, strict=False)
        return net.prefixlen == (32 if net.version == 4 else 128)
    except ValueError:
        return True


def _entry_info(entry: dict | None) -> dict | None:
    if entry is None:
        return None
    return {
        "id": entry["id"],
        "cidr": entry["cidr"],
        "note": entry.get("note") or "",
        "is_individual": _is_individual(entry["cidr"]),
    }


@router.get("/ip/{ip}/status")
async def get_ip_status(_: CurrentUser, ip: str) -> dict:
    whitelist = await get_whitelist()
    blocklist = await get_blocklist()
    wl_match = _match_cidr(ip, whitelist)
    bl_match = _match_cidr(ip, blocklist)
    return {
        "ip": ip,
        "whitelisted": wl_match is not None,
        "whitelist_entry": _entry_info(wl_match),
        "blocked": bl_match is not None,
        "block_entry": _entry_info(bl_match),
    }


@router.get("/ip/{ip}")
async def get_ip_profile(
    _: CurrentUser,
    ip: str,
    tr: TimeRangeDep,
) -> dict:
    return db.query_ip_profile(ip, tr.from_ts, tr.to_ts)


# ── Whitelist ─────────────────────────────────────────────────────────────────

class WhitelistRequest(BaseModel):
    cidr: str
    note: str = ""


@router.post("/whitelist")
async def create_whitelist_entry(_: CurrentUser, body: WhitelistRequest) -> dict:
    entry_id = await add_whitelist(body.cidr, body.note)
    return {"id": entry_id, "cidr": body.cidr}


@router.get("/whitelist")
async def list_whitelist(_: CurrentUser) -> list:
    return await get_whitelist()


@router.delete("/whitelist/{entry_id}")
async def delete_whitelist_entry(_: CurrentUser, entry_id: int) -> dict:
    await remove_whitelist(entry_id)
    return {"ok": True}


# ── Blocklist ─────────────────────────────────────────────────────────────────

class BlocklistRequest(BaseModel):
    cidr: str
    note: str = ""


@router.post("/blocklist")
async def create_blocklist_entry(_: CurrentUser, body: BlocklistRequest) -> dict:
    entry_id = await add_blocklist(body.cidr, body.note)
    return {"id": entry_id, "cidr": body.cidr}


@router.get("/blocklist")
async def list_blocklist(_: CurrentUser) -> list:
    return await get_blocklist()


@router.delete("/blocklist/{entry_id}")
async def delete_blocklist_entry(_: CurrentUser, entry_id: int) -> dict:
    await remove_blocklist(entry_id)
    return {"ok": True}
