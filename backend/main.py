"""
cadsa — Caddy Server Analytics
FastAPI entry point. Serves both the REST API and built React static files.
"""
import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import get_config, get_log_level, is_dev_mode
from version import __version__ as APP_VERSION

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, get_log_level().upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cadsa")


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_config()
    logger.info("cadsa starting up…")

    # Ensure data directories exist
    paths = [cfg.database.analytics_path, cfg.database.app_path]
    if cfg.geoip.enabled:
        paths.append(cfg.geoip.db_path)
    for path in paths:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)

    # Initialize databases
    from db.duckdb_manager import init_duckdb
    from db.sqlite_manager import create_tables, init_sqlite
    init_sqlite()
    await create_tables()
    init_duckdb()

    # Create admin user if no users exist
    await _ensure_admin_user()

    # Initialize GeoIP
    if cfg.geoip.enabled and os.path.isfile(cfg.geoip.db_path):
        from core.enrichment import init_geoip
        init_geoip(cfg.geoip.db_path)

    # Discover Caddy log files and start watching
    from core.discovery import discover_caddy_logs
    result, tried = await discover_caddy_logs(
        admin_api_url=cfg.caddy.admin_api_url,
        admin_api_enabled=cfg.caddy.admin_api_enabled,
        caddyfile_path=cfg.caddy.caddyfile_path,
        manual_sources=[s.model_dump()
                        for s in cfg.logs.sources] if cfg.logs.sources else None,
    )

    if result.success:
        logger.info("Log discovery: %s — found %d file(s)",
                    result.source, len(result.log_files))
        from core.ingestion import ingest_line_async, set_discovery_state
        from core.log_watcher import start_watching

        set_discovery_state(result.logger_to_hosts)

        # Backfill: up to min(30, retention_days) days of history on startup
        backfill_days = (
            min(30, cfg.database.retention_days)
            if cfg.logs.initial_backfill_hours > 0 else 0
        )

        def _get_last_ts(filepath: str):
            from db.duckdb_manager import get_conn
            row = get_conn().execute(
                "SELECT MAX(ts) FROM requests WHERE log_source = ?", [filepath]
            ).fetchone()
            if row and row[0]:
                ts = row[0]
                return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
            return None

        loop = asyncio.get_event_loop()
        start_watching(result.log_files, loop,
                       ingest_line_async, backfill_days, _get_last_ts)
    else:
        logger.warning("Log discovery failed: %s", result.failures)
        logger.warning("Tried: %s", tried)
        app.state.discovery_failures = tried

    # Start scheduler
    from scheduler import start_scheduler
    start_scheduler()

    logger.info("cadsa ready on %s:%d", cfg.server.host, cfg.server.port)
    yield

    # Shutdown
    from core.log_watcher import stop_watching
    from scheduler import stop_scheduler
    stop_watching()
    stop_scheduler()
    logger.info("cadsa shutdown complete")


async def _ensure_admin_user() -> None:
    from db.sqlite_manager import get_user_by_username, create_user
    from api.auth_utils import hash_password

    existing = await get_user_by_username("admin")
    if existing:
        return

    pw_hash = hash_password("admin")
    await create_user("admin", pw_hash, must_change_password=True)
    logger.info("Admin user created with default password. Login at /login with admin / admin.")


# ── App factory ────────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="cadsa",
        description="Caddy Server Analytics",
        version=APP_VERSION,
        docs_url="/api/docs" if is_dev_mode() else None,
        redoc_url="/api/redoc" if is_dev_mode() else None,
        lifespan=lifespan,
    )

    # CORS — only in dev mode (Vite proxy handles this in prod)
    if is_dev_mode():
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # API routers
    from api.auth import router as auth_router
    from api.analytics import router as analytics_router
    from api.realtime import router as realtime_router
    from api.alerts import router as alerts_router
    from api.settings import router as settings_router
    from api.security_api import router as security_router

    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(analytics_router, prefix="/api/v1")
    app.include_router(realtime_router, prefix="/api/v1")
    app.include_router(alerts_router, prefix="/api/v1")
    app.include_router(settings_router, prefix="/api/v1")
    app.include_router(security_router, prefix="/api/v1")

    # Serve React static files (production)
    static_dir = Path(__file__).parent / "static"
    if static_dir.exists() and (static_dir / "index.html").exists():
        # Mount /assets with long-lived caching (Vite outputs content-hashed filenames)
        app.mount(
            "/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            from fastapi import HTTPException
            if full_path.startswith("api/") or full_path.startswith("ws/"):
                raise HTTPException(status_code=404)
            # Serve public/ files (favicon, logo, icons, etc.) that Vite copies to
            # dist/ root.  Guard against path traversal before serving.
            candidate = (static_dir / full_path).resolve()
            if candidate.is_relative_to(static_dir.resolve()) and candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(static_dir / "index.html"))

    return app


app = create_app()


if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run(
        "main:app",
        host=cfg.server.host,
        port=cfg.server.port,
        loop="uvloop",
        log_level=get_log_level(),
        access_log=False,
        reload=is_dev_mode(),
    )
