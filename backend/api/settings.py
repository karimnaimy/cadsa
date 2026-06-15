"""
Settings and system info API.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.dependencies import CurrentUser
from config import get_config
from version import __version__ as APP_VERSION
from db.sqlite_manager import get_all_settings, set_setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/")
async def get_settings(_: CurrentUser) -> dict:
    stored = await get_all_settings()
    return {"settings": stored}


class SettingsPatch(BaseModel):
    data: dict[str, Any]


@router.patch("/")
async def patch_settings(_: CurrentUser, body: SettingsPatch) -> dict:
    for key, value in body.data.items():
        await set_setting(key, str(value))
    return {"ok": True}


@router.get("/log-sources")
async def get_log_sources(_: CurrentUser) -> dict:
    from core.discovery import discover_caddy_logs
    cfg = get_config()
    result, tried = await discover_caddy_logs(
        admin_api_url=cfg.caddy.admin_api_url,
        admin_api_enabled=cfg.caddy.admin_api_enabled,
        caddyfile_path=cfg.caddy.caddyfile_path,
        manual_sources=[s.model_dump() for s in cfg.logs.sources] if cfg.logs.sources else None,
    )
    return {
        "success": result.success,
        "log_files": result.log_files,
        "logger_to_hosts": result.logger_to_hosts,
        "skip_hosts": list(result.skip_hosts),
        "source": result.source,
        "tried": tried,
    }


@router.post("/log-sources/{source_path:path}/test")
async def test_log_source(_: CurrentUser, source_path: str) -> dict:
    if not os.path.isfile(source_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        lines: list[str] = []
        with open(source_path) as f:
            all_lines = f.readlines()
            lines = [l.strip() for l in all_lines[-5:] if l.strip()]
        return {"ok": True, "last_lines": lines}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/geoip/update")
async def trigger_geoip_update(_: CurrentUser) -> dict:
    cfg = get_config()
    db_path = cfg.geoip.db_path

    try:
        import aiohttp
        url = "https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    os.makedirs(os.path.dirname(db_path), exist_ok=True)
                    content = await resp.read()
                    with open(db_path, "wb") as f:
                        f.write(content)

                    from core.enrichment import init_geoip
                    init_geoip(db_path)
                    return {"ok": True, "size": len(content)}
                else:
                    raise HTTPException(status_code=502, detail=f"Download failed: HTTP {resp.status}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/email/test")
async def test_email(_: CurrentUser) -> dict:
    cfg = get_config()
    if not cfg.alerts.email.enabled:
        raise HTTPException(status_code=400, detail="Email alerts not configured")
    from alerts.notifiers.email import send_email
    ec = cfg.alerts.email
    ok = await send_email(
        subject="cadsa Email Test",
        body="This is a test email from cadsa.",
        to=ec.to,
        from_addr=ec.from_ or "cadsa@localhost",
        smtp_host=ec.smtp_host,
        smtp_port=ec.smtp_port,
        smtp_user=ec.smtp_user,
        smtp_password=ec.smtp_password,
    )
    return {"ok": ok}


@router.post("/webhook/test")
async def test_webhook(_: CurrentUser) -> dict:
    cfg = get_config()
    if not cfg.alerts.webhook.enabled:
        raise HTTPException(status_code=400, detail="Webhook not configured")
    from alerts.notifiers.webhook import send_webhook
    ok = await send_webhook(
        url=cfg.alerts.webhook.url,
        payload={"type": "test", "ts": datetime.now(timezone.utc).isoformat()},
        secret=cfg.alerts.webhook.secret,
    )
    return {"ok": ok}


@router.get("/system")
async def get_system_info(_: CurrentUser) -> dict:
    cfg = get_config()
    info: dict[str, Any] = {
        "version": APP_VERSION,
        "uptime_seconds": _get_uptime(),
        "db_sizes": {},
        "geoip": {},
        "log_files": [],
    }

    # DB sizes
    for label, path in [
        ("analytics", cfg.database.analytics_path),
        ("app", cfg.database.app_path),
    ]:
        try:
            info["db_sizes"][label] = os.path.getsize(path)
        except Exception:
            info["db_sizes"][label] = 0

    # GeoIP
    geoip_path = cfg.geoip.db_path
    if os.path.isfile(geoip_path):
        stat = os.stat(geoip_path)
        info["geoip"]["size"] = stat.st_size
        info["geoip"]["modified"] = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    else:
        info["geoip"]["available"] = False

    return info


_start_time = datetime.now(timezone.utc)


def _get_uptime() -> float:
    return (datetime.now(timezone.utc) - _start_time).total_seconds()
