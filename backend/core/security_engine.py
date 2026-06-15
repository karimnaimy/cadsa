"""
Security event detection engine.
Evaluates incoming log rows against 15 threat detection rules.
"""
import asyncio
import logging
import re
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Per-IP sliding window trackers (in-memory, approximate)
_ip_req_window: dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
_ip_404_paths: dict[str, set] = defaultdict(set)
_ip_login_posts: dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
_host_req_window: dict[str, deque] = defaultdict(lambda: deque(maxlen=10000))

# Known scanner user-agents
_SCANNER_UA = re.compile(
    r"(nikto|nessus|sqlmap|masscan|zgrab|nuclei|nmap|dirbuster|gobuster|"
    r"wfuzz|hydra|medusa|metasploit|burpsuite|acunetix|netsparker|appscan|"
    r"w3af|skipfish|whatweb|httprint|fimap|commix|dalfox|jaeles|"
    r"feroxbuster|ffuf|dirb)",
    re.IGNORECASE,
)

# Bad bot user-agents
_BAD_BOT_UA = re.compile(
    r"(ahrefsbot|semrushbot|dotbot|majestic|mj12bot|petalbot|"
    r"yandexbot|baiduspider|ia_archiver)",
    re.IGNORECASE,
)

# SQLi patterns
_SQLI = re.compile(
    r"(union\s+select|select\s+.*\s+from|insert\s+into|drop\s+table|"
    r"'\s*or\s+'1'\s*=\s*'1|--\s*$|;\s*--|\bexec\s*\(|"
    r"xp_cmdshell|0x[0-9a-f]{4,}|char\(\d+\)\s*\+)",
    re.IGNORECASE,
)

# XSS patterns
_XSS = re.compile(
    r"(<script[^>]*>|javascript:|on\w+\s*=|<img[^>]+src\s*=\s*['\"]?javascript|"
    r"eval\s*\(|document\.cookie|alert\s*\(|<iframe[^>]*>)",
    re.IGNORECASE,
)

# Path traversal
_PATH_TRAVERSAL = re.compile(
    r"(\.\./|\.\.\\|%2e%2e|%252e%252e|\x00|%00)",
    re.IGNORECASE,
)


_security_callbacks: list = []


def register_security_callback(cb) -> None:
    _security_callbacks.append(cb)


async def evaluate_async(row: dict[str, Any]) -> None:
    """Evaluate a parsed row against all security rules."""
    events = _evaluate(row)
    if not events:
        return

    from db.duckdb_manager import insert_security_event

    loop = asyncio.get_event_loop()
    for event in events:
        try:
            await loop.run_in_executor(None, insert_security_event, event)
            for cb in list(_security_callbacks):
                try:
                    cb({"type": "security_event", "data": event})
                except Exception:
                    pass
        except Exception as e:
            logger.debug("Security event store failed: %s", e)


def _evaluate(row: dict[str, Any]) -> list[dict]:
    now = datetime.now(timezone.utc)
    ip = row.get("remote_ip", "")
    host = row.get("host", "")
    uri = (row.get("uri") or "").lower()
    path = (row.get("path") or "").lower()
    ua = (row.get("user_agent") or "").lower()
    method = (row.get("method") or "").upper()
    status = row.get("status") or 0

    events: list[dict] = []

    # Track per-IP requests in 1-minute sliding window
    window = _ip_req_window[ip]
    window.append(now)
    _expire_window(window, now, seconds=60)

    # Track per-host requests in 1-minute window
    host_window = _host_req_window[host]
    host_window.append(now)
    _expire_window(host_window, now, seconds=60)

    def make_event(event_type: str, severity: str, details: dict | None = None) -> dict:
        return {
            "ts": now,
            "event_type": event_type,
            "severity": severity,
            "remote_ip": ip,
            "host": host,
            "uri": row.get("uri") or "",
            "details": details or {},
        }

    # 1. Rate limit trigger (>300 req/min from single IP)
    from config import get_config
    cfg = get_config()
    if len(window) >= cfg.security.rate_limit_threshold:
        events.append(make_event(
            "rate_limit_trigger", "high",
            {"req_per_min": len(window), "threshold": cfg.security.rate_limit_threshold},
        ))

    # 2. SQL injection attempt
    if _SQLI.search(uri):
        events.append(make_event("sql_injection_attempt", "high", {"pattern": "sqli", "uri": uri[:500]}))

    # 3. XSS attempt
    if _XSS.search(uri):
        events.append(make_event("xss_attempt", "medium", {"uri": uri[:500]}))

    # 4. Path traversal
    if _PATH_TRAVERSAL.search(uri):
        events.append(make_event("path_traversal", "high", {"uri": uri[:500]}))

    # 5. Known scanner UA
    if _SCANNER_UA.search(ua):
        events.append(make_event("known_scanner", "critical", {"ua": ua[:200]}))

    # 6. Bad bot UA
    if _BAD_BOT_UA.search(ua) and not _SCANNER_UA.search(ua):
        events.append(make_event("bad_bot", "low", {"ua": ua[:200]}))

    # 7. Empty UA with high volume (>50 req/min)
    if not ua and len(window) > 50:
        events.append(make_event("bad_bot", "medium", {"ua": "empty", "req_per_min": len(window)}))

    # 8. Port scan / directory scan attempt (>50 unique 404 paths from same IP per hour)
    if status == 404:
        _ip_404_paths[ip].add(path)
        if len(_ip_404_paths[ip]) > 50:
            events.append(make_event(
                "port_scan_attempt", "high",
                {"unique_404_paths": len(_ip_404_paths[ip])},
            ))

    # 9. Repeated auth failures (>10 POSTs to login endpoints per hour)
    if method == "POST" and any(p in path for p in ("/login", "/auth", "/signin", "/wp-login")):
        login_w = _ip_login_posts[ip]
        login_w.append(now)
        _expire_window(login_w, now, seconds=3600)
        if len(login_w) > 10:
            events.append(make_event(
                "repeated_auth_fail", "high",
                {"login_attempts": len(login_w)},
            ))

    # 10. HTTP method abuse
    if method in ("TRACE", "CONNECT") or (method == "OPTIONS" and len(window) > 20):
        events.append(make_event("http_method_abuse", "medium", {"method": method}))

    # 11. Slow request spike (duration > threshold)
    dur = row.get("duration_ms") or 0
    if dur > cfg.security.slow_request_threshold_ms:
        events.append(make_event(
            "slow_request_spike", "info",
            {"duration_ms": dur, "threshold": cfg.security.slow_request_threshold_ms},
        ))

    return events


def _expire_window(window: deque, now: datetime, seconds: int) -> None:
    cutoff = now - timedelta(seconds=seconds)
    while window and window[0] < cutoff:
        window.popleft()


def cleanup_stale_ip_data() -> None:
    """Called periodically to free memory from inactive IPs."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=1)
    stale = [ip for ip, w in _ip_req_window.items() if not w or w[-1] < cutoff]
    for ip in stale:
        del _ip_req_window[ip]
        _ip_404_paths.pop(ip, None)
        _ip_login_posts.pop(ip, None)
