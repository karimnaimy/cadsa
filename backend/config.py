import os
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, field_validator


CONFIG_PATH = os.environ.get("CADSA_CONFIG_PATH", "/etc/cadsa/cadsa.yaml")


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 3131
    secret_key: str = ""
    jwt_private_key_path: str = "/etc/cadsa/jwt_private.pem"
    jwt_public_key_path: str = "/etc/cadsa/jwt_public.pem"


class CaddyConfig(BaseModel):
    admin_api_url: str = "http://localhost:2019"
    admin_api_enabled: bool = True
    caddyfile_path: str = ""


class LogSource(BaseModel):
    path: str
    format: str = "json"
    label: str = ""


class LogsConfig(BaseModel):
    auto_discover: bool = True
    sources: list[LogSource] = []
    initial_backfill_hours: int = 24


MAX_RETENTION_DAYS = 30


class DatabaseConfig(BaseModel):
    analytics_path: str = "/var/lib/cadsa/analytics.duckdb"
    app_path: str = "/var/lib/cadsa/app.sqlite"
    retention_days: int = 30
    aggregation_retention_days: int = 365

    @field_validator("retention_days")
    @classmethod
    def cap_retention(cls, v: int) -> int:
        return min(max(v, 1), MAX_RETENTION_DAYS)


class GeoIPConfig(BaseModel):
    enabled: bool = True
    db_path: str = "/var/lib/cadsa/GeoLite2-City.mmdb"
    auto_update: bool = True


class SecurityConfig(BaseModel):
    rate_limit_threshold: int = 300
    error_rate_threshold: float = 0.20
    slow_request_threshold_ms: int = 2000


class EmailAlertsConfig(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    from_: str = ""
    to: list[str] = []

    model_config = {"populate_by_name": True}

    @field_validator("from_", mode="before")
    @classmethod
    def alias_from(cls, v: object) -> object:
        return v


class WebhookAlertsConfig(BaseModel):
    enabled: bool = False
    url: str = ""
    secret: str = ""


class AlertsConfig(BaseModel):
    email: EmailAlertsConfig = EmailAlertsConfig()
    webhook: WebhookAlertsConfig = WebhookAlertsConfig()


class AbuseIPDBConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    cache_hours: int = 24


class ThreatIntelConfig(BaseModel):
    abuseipdb: AbuseIPDBConfig = AbuseIPDBConfig()


class CadsaConfig(BaseModel):
    server: ServerConfig = ServerConfig()
    caddy: CaddyConfig = CaddyConfig()
    logs: LogsConfig = LogsConfig()
    database: DatabaseConfig = DatabaseConfig()
    geoip: GeoIPConfig = GeoIPConfig()
    security: SecurityConfig = SecurityConfig()
    alerts: AlertsConfig = AlertsConfig()
    threat_intel: ThreatIntelConfig = ThreatIntelConfig()


_config: Optional[CadsaConfig] = None


def load_config(path: Optional[str] = None) -> CadsaConfig:
    global _config
    config_path = path or CONFIG_PATH

    raw: dict = {}
    if Path(config_path).exists():
        with open(config_path) as f:
            raw = yaml.safe_load(f) or {}

    # Map yaml "from" key (reserved in Python) to from_
    email_cfg = raw.get("alerts", {}).get("email", {})
    if "from" in email_cfg:
        email_cfg["from_"] = email_cfg.pop("from")

    _config = CadsaConfig.model_validate(raw)
    return _config


def get_config() -> CadsaConfig:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def is_dev_mode() -> bool:
    return os.environ.get("CADSA_DEV_MODE", "").strip() == "1"


def get_log_level() -> str:
    return os.environ.get("CADSA_LOG_LEVEL", "info").lower()
