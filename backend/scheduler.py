"""
APScheduler jobs: minutely/hourly aggregations, data cleanup, GeoIP updates.
"""
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    _scheduler = AsyncIOScheduler()

    # Minutely aggregation
    _scheduler.add_job(_run_minutely, "interval", minutes=1, id="minutely_agg", max_instances=1)

    # Hourly aggregation
    _scheduler.add_job(_run_hourly, "cron", minute=0, id="hourly_agg", max_instances=1)

    # Daily cleanup
    _scheduler.add_job(_run_cleanup, "cron", hour=3, minute=0, id="daily_cleanup", max_instances=1)

    # Alert rule evaluation (every minute)
    _scheduler.add_job(_run_alert_eval, "interval", minutes=1, id="alert_eval", max_instances=1)

    # Security engine stale data cleanup (every 30 minutes)
    _scheduler.add_job(_run_security_cleanup, "interval", minutes=30, id="security_cleanup", max_instances=1)

    # Live metrics broadcast — every 1 second for responsive charts
    _scheduler.add_job(_broadcast_metrics, "interval", seconds=1, id="metrics_broadcast", max_instances=1)

    _scheduler.start()
    logger.info("Scheduler started")
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Scheduler stopped")


async def _run_minutely() -> None:
    try:
        from db.duckdb_manager import aggregate_minutely
        import asyncio
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, aggregate_minutely)
    except Exception as e:
        logger.error("Minutely aggregation failed: %s", e)


async def _run_hourly() -> None:
    try:
        from db.duckdb_manager import get_conn
        from datetime import datetime, timedelta, timezone
        import asyncio

        loop = asyncio.get_event_loop()
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        bucket = now - timedelta(hours=1)

        def _do():
            conn = get_conn()
            conn.execute("""
                INSERT OR REPLACE INTO stats_hourly
                SELECT
                    date_trunc('hour', ts),
                    host,
                    COUNT(*),
                    SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END),
                    SUM(COALESCE(response_bytes, 0)),
                    SUM(COALESCE(request_bytes, 0)),
                    MEDIAN(duration_ms),
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms),
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms),
                    COUNT(DISTINCT remote_ip)
                FROM requests
                WHERE ts >= ? AND ts < ?
                GROUP BY date_trunc('hour', ts), host
            """, [bucket, now])

        await loop.run_in_executor(None, _do)
    except Exception as e:
        logger.error("Hourly aggregation failed: %s", e)


async def _run_cleanup() -> None:
    try:
        from config import get_config
        from db.duckdb_manager import purge_old_data
        import asyncio
        cfg = get_config()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, purge_old_data,
            cfg.database.retention_days,
            cfg.database.aggregation_retention_days,
        )
    except Exception as e:
        logger.error("Data cleanup failed: %s", e)


async def _run_alert_eval() -> None:
    try:
        from alerts.engine import evaluate_alert_rules
        await evaluate_alert_rules()
    except Exception as e:
        logger.error("Alert evaluation failed: %s", e)


async def _run_security_cleanup() -> None:
    try:
        from core.security_engine import cleanup_stale_ip_data
        import asyncio
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, cleanup_stale_ip_data)
    except Exception as e:
        logger.error("Security cleanup failed: %s", e)


async def _broadcast_metrics() -> None:
    try:
        from core.ingestion import get_live_metrics, _broadcast_callbacks
        metrics = get_live_metrics()
        msg = {"type": "metrics_update", "data": metrics}
        for cb in list(_broadcast_callbacks):
            try:
                cb(msg)
            except Exception:
                pass
    except Exception as e:
        logger.debug("Metrics broadcast failed: %s", e)
