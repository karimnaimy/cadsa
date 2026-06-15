"""
GeoIP and User-Agent enrichment for parsed log entries.
"""
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_geoip_reader = None

# Known bad bot / scanner user-agent patterns
_BAD_BOT_PATTERNS = re.compile(
    r"(nikto|nessus|sqlmap|masscan|zgrab|nuclei|nmap|dirbuster|gobuster|"
    r"wfuzz|hydra|medusa|metasploit|burpsuite|acunetix|netsparker|"
    r"appscan|w3af|skipfish|whatweb|httprint|fimap|commix|dalfox|"
    r"jaeles|subfinder|amass|feroxbuster|ffuf|dirb|crawl|spider|"
    r"python-requests|go-http-client|curl/|wget/|libwww|lwp-|"
    r"scrapy|mechanize|ahrefsbot|semrushbot|dotbot|majestic|mj12bot|"
    r"petalbot|yandexbot|baiduspider|duckduckbot|ia_archiver|"
    r"facebookexternalhit|twitterbot|linkedinbot|slackbot)",
    re.IGNORECASE,
)

# Suspicious but not necessarily malicious
_SUSPICIOUS_UA_PATTERNS = re.compile(
    r"(python-requests|go-http-client|curl/|wget/|libwww|lwp-|ruby|perl)",
    re.IGNORECASE,
)


def init_geoip(db_path: str) -> bool:
    global _geoip_reader
    try:
        import geoip2.database
        _geoip_reader = geoip2.database.Reader(db_path)
        logger.info("GeoIP database loaded from %s", db_path)
        return True
    except Exception as e:
        logger.warning("GeoIP unavailable: %s", e)
        return False


def enrich(row: dict[str, Any]) -> dict[str, Any]:
    """Mutates and returns the row with enriched fields."""
    row = _enrich_geoip(row)
    row = _enrich_ua(row)
    row = _score_threat(row)
    return row


def _enrich_geoip(row: dict[str, Any]) -> dict[str, Any]:
    if not _geoip_reader:
        return row
    ip = row.get("remote_ip", "")
    if not ip or ip in ("127.0.0.1", "::1"):
        return row
    try:
        resp = _geoip_reader.city(ip)
        row["country_code"] = resp.country.iso_code
        row["country_name"] = resp.country.name
        row["city"] = resp.city.name
        row["latitude"] = resp.location.latitude
        row["longitude"] = resp.location.longitude
    except Exception:
        pass
    return row


def _enrich_ua(row: dict[str, Any]) -> dict[str, Any]:
    ua_str = row.get("user_agent") or ""
    if not ua_str:
        row["ua_browser"] = None
        row["ua_os"] = None
        row["ua_device"] = "bot"
        row["is_bot"] = True
        return row

    if _BAD_BOT_PATTERNS.search(ua_str):
        row["is_bot"] = True

    try:
        from ua_parser import user_agent_parser
        parsed = user_agent_parser.Parse(ua_str)
        ua = parsed.get("user_agent", {})
        os_ = parsed.get("os", {})
        device = parsed.get("device", {})

        browser = ua.get("family", "")
        if ua.get("major"):
            browser = f"{browser} {ua['major']}"
        row["ua_browser"] = browser or None

        os_name = os_.get("family", "")
        if os_.get("major"):
            os_name = f"{os_name} {os_['major']}"
        row["ua_os"] = os_name or None

        device_family = (device.get("family") or "").lower()
        brand = (device.get("brand") or "").lower()

        if row.get("is_bot") or "bot" in device_family or "spider" in device_family:
            row["ua_device"] = "bot"
        elif "mobile" in device_family or "phone" in device_family or "android" in brand:
            row["ua_device"] = "mobile"
        elif "tablet" in device_family or "ipad" in device_family:
            row["ua_device"] = "tablet"
        else:
            row["ua_device"] = "desktop"

    except Exception:
        row["ua_browser"] = None
        row["ua_os"] = None
        row["ua_device"] = "unknown"

    return row


def _score_threat(row: dict[str, Any]) -> dict[str, Any]:
    score = 0
    ua = (row.get("user_agent") or "").lower()
    status = row.get("status") or 0

    # Known scanner/bad bot UA
    if _BAD_BOT_PATTERNS.search(ua):
        score += 40

    # Empty UA with requests
    if not ua:
        score += 15

    # HTTP errors that indicate scanning
    if status in (400, 401, 403, 404, 405, 429):
        score += 5

    row["threat_score"] = min(score, 100)
    return row
