"""
Caddy JSON log parser.

Key observations from Caddy v2.11.4:
- request.tls.version and cipher_suite are raw IANA integers, not strings
- duration is float seconds → we store as integer milliseconds
- Headers are lists: {"User-Agent": ["value"]}
- proto appears twice with different meanings (HTTP vs ALPN)
"""
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# TLS version integer → human-readable string
TLS_VERSION_MAP: dict[int, str] = {
    769: "TLS 1.0",
    770: "TLS 1.1",
    771: "TLS 1.2",
    772: "TLS 1.3",
}

# TLS cipher suite integer → human-readable name
TLS_CIPHER_MAP: dict[int, str] = {
    4865: "TLS_AES_128_GCM_SHA256",
    4866: "TLS_AES_256_GCM_SHA384",
    4867: "TLS_CHACHA20_POLY1305_SHA256",
    49195: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
    49196: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
    49199: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    49200: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    52392: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305",
    52393: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305",
}


def decode_tls_version(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, int):
        return TLS_VERSION_MAP.get(v, f"UNKNOWN({v})")
    return str(v)


def decode_tls_cipher(c: Any) -> Optional[str]:
    if c is None:
        return None
    if isinstance(c, int):
        return TLS_CIPHER_MAP.get(c, f"UNKNOWN({c})")
    return str(c)


def deep_get(d: Any, *keys: Any) -> Any:
    """Safely navigate nested dict/list; returns None on any missing step."""
    current = d
    for key in keys:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(key)
        elif isinstance(current, list) and isinstance(key, int):
            try:
                current = current[key]
            except IndexError:
                return None
        else:
            return None
    return current


def get_header(entry: dict, name: str) -> Optional[str]:
    """Extract a header value from request.headers (always a list in Caddy)."""
    val = deep_get(entry, "request", "headers", name)
    if val is None:
        return None
    if isinstance(val, list):
        return val[0] if val else None
    return str(val)


def clean_host(h: str) -> str:
    """Normalize host: strip port, brackets, trailing dot."""
    h = h.strip().rstrip(".")
    if not h:
        return h
    if h.startswith("["):
        bracket_end = h.find("]")
        if bracket_end != -1:
            h = h[1:bracket_end]
    elif ":" in h and h.count(":") == 1:
        h = h.rsplit(":", 1)[0]
    return h.lower()


def clean_ip(ip: str) -> str:
    """Strip IPv6 brackets and zone IDs."""
    if not ip:
        return ip
    ip = ip.strip()
    if ip.startswith("["):
        ip = ip[1:]
    close = ip.find("]")
    if close != -1:
        ip = ip[:close]
    pct = ip.find("%")
    if pct != -1:
        ip = ip[:pct]
    # Remove port from host:port for plain IPv4
    if ":" in ip and ip.count(":") == 1:
        ip = ip.rsplit(":", 1)[0]
    return ip


def resolve_host(entry: dict, logger_to_hosts: dict[str, list[str]], source_label: str = "") -> str:
    """5-level fallback chain to determine the virtual host for a log entry."""
    # 1. request.host field
    h = deep_get(entry, "request", "host")
    if h and str(h).strip():
        return clean_host(str(h))

    # 2. TLS SNI
    sni = deep_get(entry, "request", "tls", "server_name")
    if sni and str(sni).strip():
        return clean_host(str(sni))

    # 3. Host header
    host_header = get_header(entry, "Host")
    if host_header and host_header.strip():
        return clean_host(host_header)

    # 4. Logger ID → hostname from Admin API mapping
    logger_name = entry.get("logger", "")
    logger_id = logger_name.split(
        ".")[-1] if "." in logger_name else logger_name
    if logger_id:
        hosts = logger_to_hosts.get(logger_id, [])
        if hosts:
            return hosts[0]

    # 5. Config-level source label
    return source_label or "unknown"


def extract_path_and_query(uri: str) -> tuple[str, str]:
    """Split URI into path and query string components."""
    if not uri:
        return "", ""
    try:
        parsed = urlparse(uri)
        return parsed.path or "", parsed.query or ""
    except Exception:
        parts = uri.split("?", 1)
        return parts[0], parts[1] if len(parts) > 1 else ""


def extract_referer_domain(referer: str) -> str:
    if not referer:
        return ""
    try:
        return urlparse(referer).netloc or ""
    except Exception:
        return ""


def get_status_class(status: Optional[int]) -> Optional[str]:
    if status is None:
        return None
    if 200 <= status < 300:
        return "2xx"
    if 300 <= status < 400:
        return "3xx"
    if 400 <= status < 500:
        return "4xx"
    if 500 <= status < 600:
        return "5xx"
    return None


def parse_line(
    raw_line: str,
    logger_to_hosts: dict[str, list[str]],
    source_label: str = "",
    log_source: str = "",
) -> Optional[dict[str, Any]]:
    """
    Parse a single Caddy JSON log line.
    Returns a flat dict ready for DuckDB insertion, or None if not an access log line.
    Raises ValueError on JSON parse failure (caller should store in parse_errors).
    """
    line = raw_line.strip()
    if not line:
        return None

    entry: dict = json.loads(line)  # may raise — caller catches

    # Only process access log lines
    msg = entry.get("msg", "")
    if msg != "handled request":
        return None

    # Timestamp
    ts_raw = entry.get("ts") or entry.get("time") or entry.get("timestamp")
    if ts_raw is None:
        return None
    ts = datetime.fromtimestamp(float(ts_raw), tz=timezone.utc)

    # Client IP
    remote_ip = (
        deep_get(entry, "request", "client_ip")
        or deep_get(entry, "request", "remote_ip")
        or deep_get(entry, "request", "remote_addr")
        or ""
    )
    remote_ip = clean_ip(str(remote_ip))

    # Host
    logger_name = entry.get("logger", "")
    logger_id = logger_name.split(
        ".")[-1] if "." in logger_name else logger_name
    host = resolve_host(entry, logger_to_hosts, source_label)

    # Method, URI, HTTP proto
    method = deep_get(entry, "request", "method") or ""
    uri = deep_get(entry, "request", "uri") or deep_get(
        entry, "request", "url") or ""
    http_proto = deep_get(entry, "request", "proto") or ""
    path, query = extract_path_and_query(str(uri))

    # Response
    status_raw = entry.get("status") or deep_get(entry, "response", "status")
    status = int(status_raw) if status_raw is not None else None
    status_class = get_status_class(status)

    response_bytes_raw = entry.get("size") or deep_get(
        entry, "response", "size") or entry.get("bytes_written")
    response_bytes = int(
        response_bytes_raw) if response_bytes_raw is not None else None

    request_bytes_raw = entry.get("bytes_read") or deep_get(
        entry, "request", "bytes_read")
    request_bytes = int(
        request_bytes_raw) if request_bytes_raw is not None else None

    duration_raw = entry.get("duration")
    duration_ms = int(float(duration_raw) *
                      1000) if duration_raw is not None else None

    # Headers
    user_agent = get_header(entry, "User-Agent") or ""
    referer = get_header(entry, "Referer") or get_header(
        entry, "Referrer") or ""
    referer_domain = extract_referer_domain(referer)

    # TLS
    tls_version_raw = deep_get(entry, "request", "tls", "version")
    tls_cipher_raw = deep_get(entry, "request", "tls", "cipher_suite")
    tls_alpn = deep_get(entry, "request", "tls", "proto") or None
    tls_sni = deep_get(entry, "request", "tls", "server_name") or None
    tls_resumed = deep_get(entry, "request", "tls", "resumed")
    # None if absent (old Caddy)
    tls_ech = deep_get(entry, "request", "tls", "ech")

    return {
        "ts": ts,
        "host": host,
        "remote_ip": remote_ip,
        "method": method.upper()[:10] if method else None,
        "uri": str(uri)[:4096] if uri else None,
        "path": path[:2048] if path else None,
        "query": query[:2048] if query else None,
        "protocol": http_proto[:10] if http_proto else None,
        "status": status,
        "status_class": status_class,
        "response_bytes": response_bytes,
        "request_bytes": request_bytes,
        "duration_ms": duration_ms,
        "user_agent": user_agent[:512] if user_agent else None,
        "ua_browser": None,   # filled by enrichment
        "ua_os": None,
        "ua_device": None,
        "referer": referer[:512] if referer else None,
        "referer_domain": referer_domain[:128] if referer_domain else None,
        "tls_version": decode_tls_version(tls_version_raw),
        "tls_cipher": decode_tls_cipher(tls_cipher_raw),
        "tls_alpn": str(tls_alpn)[:10] if tls_alpn else None,
        "tls_resumed": bool(tls_resumed) if tls_resumed is not None else None,
        "tls_ech": bool(tls_ech) if tls_ech is not None else None,
        "http_proto": http_proto[:10] if http_proto else None,
        "logger_id": logger_id[:20] if logger_id else None,
        "logger_name": logger_name[:64] if logger_name else None,
        "log_source": log_source,
        # GeoIP fields filled by enrichment
        "country_code": None,
        "country_name": None,
        "city": None,
        "latitude": None,
        "longitude": None,
        "asn": None,
        "org": None,
        "is_bot": False,
        "threat_score": 0,
    }
