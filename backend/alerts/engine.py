"""
Alert evaluation engine — checks alert rules against current metrics and fires notifications.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from config import get_config
from db.sqlite_manager import get_alert_rules, record_alert_triggered

logger = logging.getLogger(__name__)


async def evaluate_alert_rules() -> None:
    """Called by scheduler every minute."""
    rules = await get_alert_rules(enabled_only=True)
    if not rules:
        return

    from datetime import timedelta, timezone
    now = datetime.now(timezone.utc)
    from_ts = now - timedelta(minutes=5)

    for rule in rules:
        try:
            await _check_rule(rule, now, from_ts)
        except Exception as e:
            logger.error("Alert rule %s evaluation failed: %s", rule.get("id"), e)


async def _check_rule(rule: dict, now: datetime, from_ts: datetime) -> None:
    conditions = rule.get("conditions") or {}
    rule_type = rule.get("rule_type", "threshold")
    metric = conditions.get("metric", "")
    threshold = conditions.get("threshold", 0)
    host = conditions.get("host")

    # Check cooldown
    last = rule.get("last_triggered")
    cooldown = rule.get("cooldown_minutes", 30)
    if last:
        last_dt = datetime.fromisoformat(last)
        if (now - last_dt).total_seconds() < cooldown * 60:
            return

    triggered = False
    details: dict[str, Any] = {}

    if rule_type == "threshold":
        triggered, details = await _check_threshold(metric, threshold, conditions, host, from_ts, now)

    if triggered:
        await record_alert_triggered(rule["id"], details)
        await _fire_notifications(rule, details)


async def _check_threshold(
    metric: str, threshold: float, conditions: dict, host, from_ts: datetime, to_ts: datetime
) -> tuple[bool, dict]:
    from db.duckdb_manager import query_overview

    overview = query_overview(host, from_ts, to_ts)

    if metric == "request_rate":
        window_min = max((to_ts - from_ts).total_seconds() / 60, 1)
        rate = overview["total_requests"] / window_min
        if rate > threshold:
            return True, {"metric": metric, "value": round(rate, 1), "threshold": threshold}

    elif metric == "error_rate":
        rate = overview["error_rate"]
        if rate > threshold:
            return True, {"metric": metric, "value": round(rate, 4), "threshold": threshold}

    elif metric == "latency_p95":
        # Use performance query
        from db.duckdb_manager import query_performance
        rows = query_performance(host, from_ts, to_ts, "minute")
        if rows:
            p95 = max(r["p95"] for r in rows)
            if p95 > threshold:
                return True, {"metric": metric, "value": p95, "threshold": threshold}

    return False, {}


async def _fire_notifications(rule: dict, details: dict) -> None:
    cfg = get_config()
    notifiers = rule.get("notifiers") or []
    rule_name = rule.get("name", f"Rule #{rule.get('id')}")

    subject = f"cadsa Alert: {rule_name}"
    body = (
        f"Alert '{rule_name}' triggered.\n\n"
        f"Details: {details}\n\n"
        f"Time: {datetime.now(timezone.utc).isoformat()}"
    )

    if "email" in notifiers and cfg.alerts.email.enabled:
        from alerts.notifiers.email import send_email
        ec = cfg.alerts.email
        await send_email(
            subject=subject,
            body=body,
            to=ec.to,
            from_addr=ec.from_ or "cadsa@localhost",
            smtp_host=ec.smtp_host,
            smtp_port=ec.smtp_port,
            smtp_user=ec.smtp_user,
            smtp_password=ec.smtp_password,
        )

    if "webhook" in notifiers and cfg.alerts.webhook.enabled:
        from alerts.notifiers.webhook import send_webhook
        payload = {"rule": rule_name, "details": details, "ts": datetime.now(timezone.utc).isoformat()}
        await send_webhook(
            url=cfg.alerts.webhook.url,
            payload=payload,
            secret=cfg.alerts.webhook.secret,
        )
