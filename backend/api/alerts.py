"""
Alert rules and history API.
"""
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.dependencies import CurrentUser
from config import get_config
from db.sqlite_manager import (
    create_alert_rule,
    delete_alert_rule,
    get_alert_history,
    get_alert_rules,
    update_alert_rule,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertRuleCreate(BaseModel):
    name: str
    enabled: bool = True
    rule_type: str
    conditions: dict[str, Any]
    cooldown_minutes: int = 30
    notifiers: list[str] = []


class AlertRuleUpdate(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    rule_type: str | None = None
    conditions: dict[str, Any] | None = None
    cooldown_minutes: int | None = None
    notifiers: list[str] | None = None


@router.get("/rules")
async def list_rules(_: CurrentUser) -> list:
    return await get_alert_rules()


@router.post("/rules")
async def create_rule(_: CurrentUser, body: AlertRuleCreate) -> dict:
    rule_id = await create_alert_rule(body.model_dump())
    return {"id": rule_id, **body.model_dump()}


@router.put("/rules/{rule_id}")
async def update_rule(_: CurrentUser, rule_id: int, body: AlertRuleUpdate) -> dict:
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    ok = await update_alert_rule(rule_id, data)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.delete("/rules/{rule_id}")
async def delete_rule(_: CurrentUser, rule_id: int) -> dict:
    await delete_alert_rule(rule_id)
    return {"ok": True}


@router.post("/rules/{rule_id}/test")
async def test_rule(_: CurrentUser, rule_id: int) -> dict:
    cfg = get_config()
    rules = await get_alert_rules()
    rule = next((r for r in rules if r["id"] == rule_id), None)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    notifiers = rule.get("notifiers") or []

    if "email" in notifiers and cfg.alerts.email.enabled:
        from alerts.notifiers.email import send_email
        ec = cfg.alerts.email
        await send_email(
            subject="cadsa Test Alert",
            body="This is a test alert from cadsa.",
            to=ec.to,
            from_addr=ec.from_ or "cadsa@localhost",
            smtp_host=ec.smtp_host,
            smtp_port=ec.smtp_port,
            smtp_user=ec.smtp_user,
            smtp_password=ec.smtp_password,
        )

    if "webhook" in notifiers and cfg.alerts.webhook.enabled:
        from alerts.notifiers.webhook import send_webhook
        await send_webhook(
            url=cfg.alerts.webhook.url,
            payload={"type": "test", "rule": rule.get("name")},
            secret=cfg.alerts.webhook.secret,
        )

    return {"ok": True, "notifiers_tested": notifiers}


@router.get("/history")
async def get_history(
    _: CurrentUser,
    limit: int = 100,
    offset: int = 0,
) -> list:
    return await get_alert_history(limit, offset)
