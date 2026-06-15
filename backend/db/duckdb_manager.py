import logging
import threading
from dataclasses import dataclass, replace
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Optional

import duckdb

from config import get_config

logger = logging.getLogger(__name__)

# Thread-local storage: each thread (event loop + scheduler workers) gets its
# own DuckDB connection to the same file, avoiding concurrent-access corruption.
_db_path: Optional[str] = None
_thread_local = threading.local()


def get_conn() -> duckdb.DuckDBPyConnection:
    if _db_path is None:
        raise RuntimeError("DuckDB not initialized — call init_duckdb() first")
    conn: Optional[duckdb.DuckDBPyConnection] = getattr(_thread_local, "conn", None)
    if conn is None:
        _thread_local.conn = duckdb.connect(_db_path)
        logger.debug("DuckDB: opened new connection for thread %s", threading.current_thread().name)
    return _thread_local.conn


def init_duckdb(path: Optional[str] = None) -> duckdb.DuckDBPyConnection:
    global _db_path
    cfg = get_config()
    _db_path = path or cfg.database.analytics_path
    # Apply schema on the calling thread's connection
    conn = get_conn()
    _apply_schema(conn)
    logger.info("DuckDB initialized at %s", _db_path)
    return conn


def _apply_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("""
        CREATE SEQUENCE IF NOT EXISTS seq_requests START 1;
        CREATE SEQUENCE IF NOT EXISTS seq_security_events START 1;

        CREATE TABLE IF NOT EXISTS requests (
            id              BIGINT DEFAULT nextval('seq_requests'),
            ts              TIMESTAMP NOT NULL,
            host            VARCHAR NOT NULL,
            remote_ip       VARCHAR NOT NULL,
            method          VARCHAR(10),
            uri             VARCHAR,
            path            VARCHAR,
            query           VARCHAR,
            protocol        VARCHAR(10),
            status          SMALLINT,
            status_class    VARCHAR(3),
            response_bytes  BIGINT,
            request_bytes   BIGINT,
            duration_ms     INTEGER,
            user_agent      VARCHAR,
            ua_browser      VARCHAR,
            ua_os           VARCHAR,
            ua_device       VARCHAR,
            referer         VARCHAR,
            referer_domain  VARCHAR,
            tls_version     VARCHAR(10),
            tls_cipher      VARCHAR,
            tls_alpn        VARCHAR(10),
            tls_resumed     BOOLEAN,
            tls_ech         BOOLEAN,
            http_proto      VARCHAR(10),
            logger_id       VARCHAR(20),
            country_code    VARCHAR(2),
            country_name    VARCHAR,
            city            VARCHAR,
            latitude        DOUBLE,
            longitude       DOUBLE,
            asn             INTEGER,
            org             VARCHAR,
            is_bot          BOOLEAN DEFAULT FALSE,
            threat_score    SMALLINT DEFAULT 0,
            log_source      VARCHAR,
            logger_name     VARCHAR,
            PRIMARY KEY (id)
        );

        CREATE TABLE IF NOT EXISTS parse_errors (
            id          BIGINT DEFAULT nextval('seq_requests'),
            ts          TIMESTAMP NOT NULL,
            raw_line    VARCHAR,
            error_msg   VARCHAR,
            log_source  VARCHAR,
            PRIMARY KEY (id)
        );

        CREATE TABLE IF NOT EXISTS stats_minutely (
            ts           TIMESTAMP,
            host         VARCHAR,
            req_count    INTEGER,
            req_2xx      INTEGER,
            req_3xx      INTEGER,
            req_4xx      INTEGER,
            req_5xx      INTEGER,
            bytes_out    BIGINT,
            bytes_in     BIGINT,
            duration_p50 INTEGER,
            duration_p95 INTEGER,
            duration_p99 INTEGER,
            unique_ips   INTEGER,
            PRIMARY KEY (ts, host)
        );

        CREATE TABLE IF NOT EXISTS stats_hourly (
            ts           TIMESTAMP,
            host         VARCHAR,
            req_count    INTEGER,
            req_2xx      INTEGER,
            req_3xx      INTEGER,
            req_4xx      INTEGER,
            req_5xx      INTEGER,
            bytes_out    BIGINT,
            bytes_in     BIGINT,
            duration_p50 INTEGER,
            duration_p95 INTEGER,
            duration_p99 INTEGER,
            unique_ips   INTEGER,
            PRIMARY KEY (ts, host)
        );

        CREATE TABLE IF NOT EXISTS security_events (
            id          BIGINT DEFAULT nextval('seq_security_events'),
            ts          TIMESTAMP NOT NULL,
            event_type  VARCHAR(50) NOT NULL,
            severity    VARCHAR(10),
            remote_ip   VARCHAR,
            host        VARCHAR,
            uri         VARCHAR,
            details     JSON,
            alert_sent  BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (id)
        );

        CREATE TABLE IF NOT EXISTS top_paths_hourly (
            ts        TIMESTAMP,
            host      VARCHAR,
            path      VARCHAR,
            req_count INTEGER,
            PRIMARY KEY (ts, host, path)
        );

        CREATE TABLE IF NOT EXISTS top_ips_hourly (
            ts        TIMESTAMP,
            host      VARCHAR,
            remote_ip VARCHAR,
            req_count INTEGER,
            PRIMARY KEY (ts, host, remote_ip)
        );
    """)

    # Indexes for common query patterns
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests (ts);
        CREATE INDEX IF NOT EXISTS idx_requests_host ON requests (host);
        CREATE INDEX IF NOT EXISTS idx_requests_remote_ip ON requests (remote_ip);
        CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);
        CREATE INDEX IF NOT EXISTS idx_security_events_ts ON security_events (ts);
        CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (event_type);
    """)


def insert_request(row: dict[str, Any]) -> None:
    conn = get_conn()
    cols = [
        "ts", "host", "remote_ip", "method", "uri", "path", "query",
        "protocol", "status", "status_class", "response_bytes", "request_bytes",
        "duration_ms", "user_agent", "ua_browser", "ua_os", "ua_device",
        "referer", "referer_domain", "tls_version", "tls_cipher", "tls_alpn",
        "tls_resumed", "tls_ech", "http_proto", "logger_id",
        "country_code", "country_name", "city", "latitude", "longitude",
        "asn", "org", "is_bot", "threat_score", "log_source", "logger_name",
    ]
    values = [row.get(c) for c in cols]
    placeholders = ", ".join(["?" for _ in cols])
    conn.execute(
        f"INSERT INTO requests ({', '.join(cols)}) VALUES ({placeholders})",
        values,
    )


def insert_parse_error(raw_line: str, error_msg: str, log_source: str = "") -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO parse_errors (ts, raw_line, error_msg, log_source) VALUES (?, ?, ?, ?)",
        [datetime.now(timezone.utc), raw_line[:4096], error_msg[:1024], log_source],
    )


def insert_security_event(event: dict[str, Any]) -> None:
    conn = get_conn()
    import json
    conn.execute(
        """INSERT INTO security_events (ts, event_type, severity, remote_ip, host, uri, details)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [
            event.get("ts", datetime.now(timezone.utc)),
            event["event_type"],
            event.get("severity", "info"),
            event.get("remote_ip"),
            event.get("host"),
            event.get("uri"),
            json.dumps(event.get("details", {})),
        ],
    )


# ── Analytics query helpers ────────────────────────────────────────────────────

@dataclass
class RequestFilter:
    host: Optional[str] = None
    remote_ip: Optional[str] = None
    method: Optional[str] = None
    status_class: Optional[str] = None
    path: Optional[str] = None
    country_code: Optional[str] = None


def build_where(from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None) -> tuple[str, list]:
    """Return (WHERE clause string, params list) for analytics queries."""
    conditions = ["ts BETWEEN ? AND ?"]
    params: list[Any] = [from_ts, to_ts]
    if f:
        if f.host:         conditions.append("host = ?");         params.append(f.host)
        if f.remote_ip:    conditions.append("remote_ip = ?");    params.append(f.remote_ip)
        if f.method:       conditions.append("method = ?");       params.append(f.method.upper())
        if f.status_class: conditions.append("status_class = ?"); params.append(f.status_class)
        if f.path:         conditions.append("path LIKE ?");      params.append(f"%{f.path}%")
        if f.country_code: conditions.append("country_code = ?"); params.append(f.country_code.upper())
    return " AND ".join(conditions), params


def query_overview(from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None) -> dict:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)

    row = conn.execute(f"""
        SELECT
            COUNT(*) as total_requests,
            COUNT(DISTINCT remote_ip) as unique_ips,
            SUM(COALESCE(response_bytes, 0)) as bytes_out,
            SUM(COALESCE(request_bytes, 0)) as bytes_in,
            AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate,
            MEDIAN(duration_ms) as p50_ms,
            COUNT(CASE WHEN status >= 200 AND status < 300 THEN 1 END) as req_2xx,
            COUNT(CASE WHEN status >= 300 AND status < 400 THEN 1 END) as req_3xx,
            COUNT(CASE WHEN status >= 400 AND status < 500 THEN 1 END) as req_4xx,
            COUNT(CASE WHEN status >= 500 THEN 1 END) as req_5xx
        FROM requests
        WHERE {where}
    """, params).fetchone()

    return {
        "total_requests": row[0] or 0,
        "unique_ips": row[1] or 0,
        "bytes_out": row[2] or 0,
        "bytes_in": row[3] or 0,
        "error_rate": round(float(row[4] or 0), 4),
        "p50_ms": int(row[5] or 0),
        "req_2xx": row[6] or 0,
        "req_3xx": row[7] or 0,
        "req_4xx": row[8] or 0,
        "req_5xx": row[9] or 0,
    }


def query_timeseries(
    from_ts: datetime,
    to_ts: datetime,
    bucket: str = "1 hour",
    f: Optional[RequestFilter] = None,
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)

    rows = conn.execute(f"""
        SELECT
            time_bucket(INTERVAL '{bucket}', ts) as b,
            COUNT(*) as req_count,
            SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as req_2xx,
            SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END) as req_3xx,
            SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as req_4xx,
            SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as req_5xx,
            SUM(COALESCE(response_bytes, 0)) as bytes_out,
            SUM(COALESCE(request_bytes, 0)) as bytes_in,
            MEDIAN(duration_ms) as p50_ms,
            COUNT(DISTINCT remote_ip) as unique_ips
        FROM requests
        WHERE {where}
        GROUP BY b
        ORDER BY b
    """, params).fetchall()

    return [
        {
            "ts": row[0].isoformat() if row[0] else None,
            "req_count": row[1], "req_2xx": row[2], "req_3xx": row[3],
            "req_4xx": row[4], "req_5xx": row[5],
            "bytes_out": row[6], "bytes_in": row[7], "p50_ms": int(row[8] or 0),
            "unique_ips": row[9] or 0,
        }
        for row in rows
    ]


def query_top_paths(
    from_ts: datetime, to_ts: datetime, limit: int = 20, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT path, COUNT(*) as req_count,
               AVG(duration_ms) as avg_ms,
               SUM(COALESCE(response_bytes, 0)) as bytes_out
        FROM requests
        WHERE {where}
          AND path IS NOT NULL
        GROUP BY path
        ORDER BY req_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [{"path": r[0], "req_count": r[1], "avg_ms": round(r[2] or 0), "bytes_out": r[3]} for r in rows]


def query_top_ips(
    from_ts: datetime, to_ts: datetime, limit: int = 20, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT remote_ip,
               COUNT(*) as req_count,
               AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate,
               MAX(threat_score) as threat_score,
               MAX(country_code) as country_code,
               MAX(country_name) as country_name,
               MAX(ts) as last_seen
        FROM requests
        WHERE {where}
        GROUP BY remote_ip
        ORDER BY req_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [
        {
            "remote_ip": r[0], "req_count": r[1],
            "error_rate": round(float(r[2] or 0), 3),
            "threat_score": r[3] or 0,
            "country_code": r[4],
            "country_name": r[5],
            "last_seen": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


def query_top_countries(
    from_ts: datetime, to_ts: datetime, limit: int = 20, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT country_code, country_name,
               COUNT(*) as req_count,
               COUNT(DISTINCT remote_ip) as unique_ips,
               AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate,
               SUM(COALESCE(response_bytes, 0)) as bytes_out
        FROM requests
        WHERE {where}
          AND country_code IS NOT NULL
        GROUP BY country_code, country_name
        ORDER BY req_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [
        {
            "country_code": r[0], "country_name": r[1],
            "req_count": r[2], "unique_ips": r[3],
            "error_rate": round(float(r[4] or 0), 3), "bytes_out": r[5],
        }
        for r in rows
    ]


def query_top_cities(
    from_ts: datetime, to_ts: datetime, limit: int = 30, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT
            city,
            COALESCE(country_name, country_code, 'Unknown') as country_name,
            COALESCE(country_code, '') as country_code,
            COUNT(*) as req_count,
            COUNT(DISTINCT remote_ip) as unique_ips
        FROM requests
        WHERE {where}
          AND city IS NOT NULL AND city != ''
        GROUP BY city, country_name, country_code
        ORDER BY req_count DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [
        {
            "city": r[0], "country_name": r[1], "country_code": r[2],
            "req_count": r[3], "unique_ips": r[4],
        }
        for r in rows
    ]


def query_distinct_countries(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, replace(f, country_code=None) if f else None)
    rows = conn.execute(f"""
        SELECT DISTINCT country_code, COALESCE(country_name, country_code) as country_name
        FROM requests
        WHERE {where} AND country_code IS NOT NULL AND country_code != ''
        ORDER BY country_name
    """, params).fetchall()
    return [{"code": r[0], "name": r[1]} for r in rows]


def query_status_codes(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT status, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND status IS NOT NULL
        GROUP BY status
        ORDER BY req_count DESC
    """, params).fetchall()
    return [{"status": r[0], "req_count": r[1]} for r in rows]


def query_performance(
    from_ts: datetime, to_ts: datetime, bucket: str = "1 hour", f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT
            time_bucket(INTERVAL '{bucket}', ts) as b,
            MEDIAN(duration_ms) as p50,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY duration_ms) as p75,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY duration_ms) as p90,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99
        FROM requests
        WHERE {where}
          AND duration_ms IS NOT NULL
        GROUP BY b
        ORDER BY b
    """, params).fetchall()
    return [
        {
            "ts": r[0].isoformat() if r[0] else None,
            "p50": int(r[1] or 0), "p75": int(r[2] or 0), "p90": int(r[3] or 0),
            "p95": int(r[4] or 0), "p99": int(r[5] or 0),
        }
        for r in rows
    ]


def query_browsers(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT ua_browser, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND ua_browser IS NOT NULL
        GROUP BY ua_browser ORDER BY req_count DESC LIMIT 20
    """, params).fetchall()
    return [{"browser": r[0], "req_count": r[1]} for r in rows]


def query_devices(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT ua_device, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND ua_device IS NOT NULL
        GROUP BY ua_device ORDER BY req_count DESC
    """, params).fetchall()
    return [{"device": r[0], "req_count": r[1]} for r in rows]


def query_os(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT ua_os, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND ua_os IS NOT NULL AND ua_os != ''
        GROUP BY ua_os ORDER BY req_count DESC LIMIT 20
    """, params).fetchall()
    return [{"os": r[0], "req_count": r[1]} for r in rows]


def query_referers(
    from_ts: datetime, to_ts: datetime, limit: int = 20, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT referer_domain, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND referer_domain IS NOT NULL AND referer_domain != ''
        GROUP BY referer_domain ORDER BY req_count DESC LIMIT ?
    """, params + [limit]).fetchall()
    return [{"domain": r[0], "req_count": r[1]} for r in rows]


def query_hosts_summary(from_ts: datetime, to_ts: datetime) -> list[dict]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            host,
            COUNT(*) as req_count,
            COUNT(DISTINCT remote_ip) as unique_ips,
            AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate,
            MEDIAN(duration_ms) as p50_ms,
            SUM(COALESCE(response_bytes, 0)) as bytes_out,
            MAX(ts) as last_seen
        FROM requests
        WHERE ts BETWEEN ? AND ?
        GROUP BY host
        ORDER BY req_count DESC
    """, [from_ts, to_ts]).fetchall()
    return [
        {
            "host": r[0], "req_count": r[1], "unique_ips": r[2],
            "error_rate": round(float(r[3] or 0), 3), "p50_ms": int(r[4] or 0),
            "bytes_out": r[5], "last_seen": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


def query_geo_map(
    from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT country_code, country_name, latitude, longitude,
               COUNT(*) as req_count,
               COUNT(DISTINCT remote_ip) as unique_ips
        FROM requests
        WHERE {where}
          AND country_code IS NOT NULL AND latitude IS NOT NULL
        GROUP BY country_code, country_name, latitude, longitude
    """, params).fetchall()
    return [
        {
            "country_code": r[0], "country_name": r[1],
            "lat": r[2], "lon": r[3],
            "req_count": r[4], "unique_ips": r[5],
        }
        for r in rows
    ]


def query_requests_page(
    from_ts: datetime,
    to_ts: datetime,
    f: Optional[RequestFilter] = None,
    offset: int = 0,
    limit: int = 100,
    sort_by: str = "ts",
    sort_dir: str = "desc",
) -> tuple[list[dict], int]:
    conn = get_conn()

    allowed_sort = {
        "ts", "host", "remote_ip", "method", "status", "duration_ms",
        "response_bytes", "country_code",
    }
    sort_col = sort_by if sort_by in allowed_sort else "ts"
    sort_order = "DESC" if sort_dir.lower() == "desc" else "ASC"

    where, params = build_where(from_ts, to_ts, f)

    total = conn.execute(f"SELECT COUNT(*) FROM requests WHERE {where}", params).fetchone()[0]

    rows = conn.execute(f"""
        SELECT id, ts, host, remote_ip, method, uri, path, status, duration_ms,
               response_bytes, request_bytes, user_agent, ua_browser, ua_os, ua_device,
               country_code, country_name, city, referer, tls_version, http_proto,
               is_bot, threat_score
        FROM requests WHERE {where}
        ORDER BY {sort_col} {sort_order}
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()

    cols = [
        "id", "ts", "host", "remote_ip", "method", "uri", "path", "status",
        "duration_ms", "response_bytes", "request_bytes", "user_agent",
        "ua_browser", "ua_os", "ua_device", "country_code", "country_name",
        "city", "referer", "tls_version", "http_proto", "is_bot", "threat_score",
    ]
    result = []
    for row in rows:
        d = dict(zip(cols, row))
        if d.get("ts"):
            d["ts"] = d["ts"].isoformat()
        result.append(d)

    return result, total


def query_request_by_id(request_id: int) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM requests WHERE id = ?", [request_id]).fetchone()
    if not row:
        return None
    cols = [desc[0] for desc in conn.description]
    d = dict(zip(cols, row))
    if d.get("ts"):
        d["ts"] = d["ts"].isoformat()
    return d


def query_security_events(
    from_ts: datetime,
    to_ts: datetime,
    host: Optional[str] = None,
    remote_ip: Optional[str] = None,
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    conn = get_conn()
    clauses = ["ts BETWEEN ? AND ?"]
    params: list[Any] = [from_ts, to_ts]
    if host:
        clauses.append("host = ?")
        params.append(host)
    if remote_ip:
        clauses.append("remote_ip = ?")
        params.append(remote_ip)
    if event_type:
        clauses.append("event_type = ?")
        params.append(event_type)
    if severity:
        clauses.append("severity = ?")
        params.append(severity)

    where = "WHERE " + " AND ".join(clauses)
    total = conn.execute(f"SELECT COUNT(*) FROM security_events {where}", params).fetchone()[0]
    rows = conn.execute(f"""
        SELECT id, ts, event_type, severity, remote_ip, host, uri, details, alert_sent
        FROM security_events {where}
        ORDER BY ts DESC LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()

    import json
    result = []
    for r in rows:
        result.append({
            "id": r[0], "ts": r[1].isoformat() if r[1] else None,
            "event_type": r[2], "severity": r[3], "remote_ip": r[4],
            "host": r[5], "uri": r[6],
            "details": json.loads(r[7]) if r[7] else {},
            "alert_sent": r[8],
        })
    return result, total


def query_top_threats(from_ts: datetime, to_ts: datetime, limit: int = 20) -> list[dict]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT remote_ip,
               COUNT(*) as event_count,
               MAX(threat_score) as max_score,
               MAX(country_code) as country_code,
               MIN(ts) as first_seen,
               MAX(ts) as last_seen
        FROM requests
        WHERE ts BETWEEN ? AND ?
          AND threat_score > 0
        GROUP BY remote_ip
        ORDER BY max_score DESC, event_count DESC
        LIMIT ?
    """, [from_ts, to_ts, limit]).fetchall()
    return [
        {
            "remote_ip": r[0], "event_count": r[1], "max_score": r[2],
            "country_code": r[3],
            "first_seen": r[4].isoformat() if r[4] else None,
            "last_seen": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def query_ip_profile(ip: str, from_ts: datetime, to_ts: datetime) -> dict:
    conn = get_conn()
    row = conn.execute("""
        SELECT
            COUNT(*) as req_count,
            COUNT(DISTINCT host) as hosts_count,
            AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate,
            MAX(threat_score) as max_threat,
            MAX(country_code) as country_code,
            MAX(country_name) as country_name,
            MAX(org) as org,
            MAX(asn) as asn,
            MIN(ts) as first_seen,
            MAX(ts) as last_seen,
            MAX(ua_browser) as browser,
            MAX(ua_os) as os
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
    """, [ip, from_ts, to_ts]).fetchone()

    paths = conn.execute("""
        SELECT path, COUNT(*) as n FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 10
    """, [ip, from_ts, to_ts]).fetchall()

    return {
        "remote_ip": ip,
        "req_count": row[0] or 0,
        "hosts_count": row[1] or 0,
        "error_rate": round(float(row[2] or 0), 3),
        "max_threat": row[3] or 0,
        "country_code": row[4],
        "country_name": row[5],
        "org": row[6],
        "asn": row[7],
        "first_seen": row[8].isoformat() if row[8] else None,
        "last_seen": row[9].isoformat() if row[9] else None,
        "browser": row[10],
        "os": row[11],
        "top_paths": [{"path": p[0], "count": p[1]} for p in paths],
    }


def query_ip_detail(ip: str, from_ts: datetime, to_ts: datetime) -> dict:
    conn = get_conn()

    hosts_rows = conn.execute("""
        SELECT host,
               COUNT(*) as req_count,
               AVG(CASE WHEN status >= 400 THEN 1.0 ELSE 0.0 END) as error_rate
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND host IS NOT NULL
        GROUP BY host
        ORDER BY req_count DESC
        LIMIT 20
    """, [ip, from_ts, to_ts]).fetchall()

    timeline_rows = conn.execute("""
        SELECT date_trunc('hour', ts) as bucket,
               COUNT(*) as req_count,
               SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) as req_2xx,
               SUM(CASE WHEN status BETWEEN 300 AND 399 THEN 1 ELSE 0 END) as req_3xx,
               SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) as req_4xx,
               SUM(CASE WHEN status BETWEEN 500 AND 599 THEN 1 ELSE 0 END) as req_5xx,
               SUM(COALESCE(response_bytes, 0)) as bytes_out,
               SUM(COALESCE(request_bytes, 0)) as bytes_in,
               CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS INTEGER) as p50_ms
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
        GROUP BY bucket
        ORDER BY bucket
    """, [ip, from_ts, to_ts]).fetchall()

    method_rows = conn.execute("""
        SELECT method, COUNT(*) as n
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND method IS NOT NULL
        GROUP BY method
        ORDER BY n DESC
    """, [ip, from_ts, to_ts]).fetchall()

    status_rows = conn.execute("""
        SELECT status, COUNT(*) as n
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND status IS NOT NULL
        GROUP BY status
        ORDER BY n DESC
    """, [ip, from_ts, to_ts]).fetchall()

    busy_rows = conn.execute("""
        SELECT CAST(EXTRACT(hour FROM ts) AS INTEGER) as hour,
               COUNT(*) as req_count,
               SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as err_count
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
        GROUP BY hour
        ORDER BY hour
    """, [ip, from_ts, to_ts]).fetchall()

    browser_row = conn.execute("""
        SELECT ua_browser FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ? AND ua_browser IS NOT NULL
        GROUP BY ua_browser ORDER BY COUNT(*) DESC LIMIT 1
    """, [ip, from_ts, to_ts]).fetchone()

    os_row = conn.execute("""
        SELECT ua_os FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ? AND ua_os IS NOT NULL
        GROUP BY ua_os ORDER BY COUNT(*) DESC LIMIT 1
    """, [ip, from_ts, to_ts]).fetchone()

    tls_row = conn.execute("""
        SELECT tls_version FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ? AND tls_version IS NOT NULL
        GROUP BY tls_version ORDER BY COUNT(*) DESC LIMIT 1
    """, [ip, from_ts, to_ts]).fetchone()

    proto_row = conn.execute("""
        SELECT http_proto FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND http_proto IS NOT NULL AND http_proto != ''
        GROUP BY http_proto ORDER BY COUNT(*) DESC LIMIT 1
    """, [ip, from_ts, to_ts]).fetchone()

    misc_row = conn.execute("""
        SELECT
            AVG(CASE WHEN is_bot THEN 1.0 ELSE 0.0 END) as is_bot_pct,
            AVG(CASE WHEN tls_resumed IS TRUE THEN 1.0
                     WHEN tls_version IS NOT NULL THEN 0.0
                     ELSE NULL END) as tls_resumed_pct,
            SUM(COALESCE(request_bytes, 0)) as total_bytes_in,
            SUM(COALESCE(response_bytes, 0)) as total_bytes_out
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
    """, [ip, from_ts, to_ts]).fetchone()

    resp_row = conn.execute("""
        SELECT
            CAST(AVG(duration_ms) AS INTEGER) as avg_ms,
            CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS INTEGER) as p95_ms
        FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ? AND duration_ms IS NOT NULL
    """, [ip, from_ts, to_ts]).fetchone()

    ua_sample = conn.execute("""
        SELECT user_agent FROM requests
        WHERE remote_ip = ? AND ts BETWEEN ? AND ?
          AND user_agent IS NOT NULL AND user_agent != ''
        LIMIT 1
    """, [ip, from_ts, to_ts]).fetchone()

    return {
        "hosts_accessed": [
            {"host": r[0], "req_count": r[1], "error_rate": round(float(r[2] or 0), 3)}
            for r in hosts_rows
        ],
        "timeline": [
            {
                "ts": r[0].isoformat(),
                "req_count": r[1], "req_2xx": r[2], "req_3xx": r[3],
                "req_4xx": r[4], "req_5xx": r[5],
                "bytes_out": r[6], "bytes_in": r[7], "p50_ms": r[8] or 0,
            }
            for r in timeline_rows
        ],
        "methods": [{"method": r[0], "count": r[1]} for r in method_rows],
        "status_codes": [{"status": r[0], "req_count": r[1]} for r in status_rows],
        "busy_hours": [
            {"hour": r[0], "req_count": r[1], "err_count": r[2]}
            for r in busy_rows
        ],
        "ua_summary": {
            "browser": browser_row[0] if browser_row else None,
            "os": os_row[0] if os_row else None,
            "tls_version": tls_row[0] if tls_row else None,
            "http_proto": proto_row[0] if proto_row else None,
            "is_bot_pct": round(float(misc_row[0] or 0) * 100, 1) if misc_row else 0.0,
            "tls_resumed_pct": (
                round(float(misc_row[1]) * 100, 1)
                if misc_row and misc_row[1] is not None else None
            ),
            "sample_ua": ua_sample[0] if ua_sample else None,
        },
        "response_summary": {
            "avg_ms": resp_row[0] or 0 if resp_row else 0,
            "p95_ms": resp_row[1] or 0 if resp_row else 0,
            "total_bytes_in": misc_row[2] or 0 if misc_row else 0,
            "total_bytes_out": misc_row[3] or 0 if misc_row else 0,
        },
    }


def query_paths_by_status(
    from_ts: datetime,
    to_ts: datetime,
    f: Optional[RequestFilter] = None,
    limit: int = 30,
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT path,
               COUNT(*) as total,
               SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) as req_2xx,
               SUM(CASE WHEN status BETWEEN 300 AND 399 THEN 1 ELSE 0 END) as req_3xx,
               SUM(CASE WHEN status BETWEEN 400 AND 499 THEN 1 ELSE 0 END) as req_4xx,
               SUM(CASE WHEN status BETWEEN 500 AND 599 THEN 1 ELSE 0 END) as req_5xx,
               AVG(duration_ms) as avg_ms,
               SUM(COALESCE(response_bytes, 0)) as bytes_out
        FROM requests
        WHERE {where}
          AND path IS NOT NULL
        GROUP BY path
        ORDER BY total DESC
        LIMIT ?
    """, params + [limit]).fetchall()

    return [
        {
            "path": r[0], "total": r[1],
            "req_2xx": r[2], "req_3xx": r[3], "req_4xx": r[4], "req_5xx": r[5],
            "avg_ms": round(float(r[6] or 0)),
            "bytes_out": r[7] or 0,
        }
        for r in rows
    ]


def query_host_patterns(from_ts: datetime, to_ts: datetime, f: Optional[RequestFilter] = None) -> dict:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)

    heatmap_rows = conn.execute(f"""
        SELECT
            CAST(EXTRACT(hour FROM ts) AS INTEGER) as hour,
            CAST(EXTRACT(dow  FROM ts) AS INTEGER) as dow,
            COUNT(*) as req_count
        FROM requests
        WHERE {where}
        GROUP BY hour, dow
        ORDER BY dow, hour
    """, params).fetchall()

    proto_rows = conn.execute(f"""
        SELECT
            COALESCE(NULLIF(http_proto, ''), 'Unknown') as protocol,
            COUNT(*) as req_count
        FROM requests
        WHERE {where}
        GROUP BY COALESCE(NULLIF(http_proto, ''), 'Unknown')
        ORDER BY req_count DESC
    """, params).fetchall()

    bot_row = conn.execute(f"""
        SELECT
            AVG(CASE WHEN is_bot THEN 1.0 ELSE 0.0 END) as bot_pct,
            SUM(CASE WHEN is_bot THEN 1 ELSE 0 END) as bot_count
        FROM requests
        WHERE {where}
    """, params).fetchone()

    referer_rows = conn.execute(f"""
        SELECT referer_domain, COUNT(*) as req_count
        FROM requests
        WHERE {where}
          AND referer_domain IS NOT NULL AND referer_domain != ''
        GROUP BY referer_domain
        ORDER BY req_count DESC
        LIMIT 15
    """, params).fetchall()

    return {
        "busy_hours": [
            {"hour": r[0], "dow": r[1], "req_count": r[2]}
            for r in heatmap_rows
        ],
        "protocol_breakdown": [
            {"protocol": r[0], "req_count": r[1]}
            for r in proto_rows
        ],
        "bot_pct": round(float(bot_row[0] or 0) * 100, 1) if bot_row else 0.0,
        "bot_count": bot_row[1] or 0 if bot_row else 0,
        "top_referers": [
            {"domain": r[0], "req_count": r[1]}
            for r in referer_rows
        ],
    }


def query_slowest_paths(
    from_ts: datetime, to_ts: datetime, limit: int = 20, f: Optional[RequestFilter] = None
) -> list[dict]:
    conn = get_conn()
    where, params = build_where(from_ts, to_ts, f)
    rows = conn.execute(f"""
        SELECT
            path,
            COUNT(*) as req_count,
            CAST(MEDIAN(duration_ms) AS INTEGER) as p50_ms,
            CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS INTEGER) as p95_ms,
            CAST(AVG(duration_ms) AS INTEGER) as avg_ms
        FROM requests
        WHERE {where}
          AND path IS NOT NULL
          AND duration_ms IS NOT NULL
        GROUP BY path
        HAVING COUNT(*) >= 3
        ORDER BY p95_ms DESC NULLS LAST
        LIMIT ?
    """, params + [limit]).fetchall()
    return [
        {
            "path": r[0], "req_count": r[1],
            "p50_ms": r[2] or 0, "p95_ms": r[3] or 0, "avg_ms": r[4] or 0,
        }
        for r in rows
    ]


def aggregate_minutely(host: Optional[str] = None) -> None:
    """Run minutely aggregation — called by scheduler every minute."""
    conn = get_conn()
    from datetime import timedelta
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    bucket = now - timedelta(minutes=1)

    host_filter = "AND host = ?" if host else ""
    params: list[Any] = [bucket, now] + ([host] if host else [])

    conn.execute(f"""
        INSERT OR REPLACE INTO stats_minutely
        SELECT
            date_trunc('minute', ts) as ts,
            host,
            COUNT(*) as req_count,
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
        WHERE ts >= ? AND ts < ? {host_filter}
        GROUP BY date_trunc('minute', ts), host
    """, params)


def purge_old_data(retention_days: int, aggregation_retention_days: int) -> None:
    conn = get_conn()
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    raw_cutoff = now - timedelta(days=retention_days)
    agg_cutoff = now - timedelta(days=aggregation_retention_days)

    conn.execute("DELETE FROM requests WHERE ts < ?", [raw_cutoff])
    conn.execute("DELETE FROM security_events WHERE ts < ?", [raw_cutoff])
    conn.execute("DELETE FROM stats_minutely WHERE ts < ?", [agg_cutoff])
    conn.execute("DELETE FROM stats_hourly WHERE ts < ?", [agg_cutoff])
    conn.execute("DELETE FROM parse_errors WHERE ts < ?", [raw_cutoff])
    logger.info("Purged data older than %d days", retention_days)
