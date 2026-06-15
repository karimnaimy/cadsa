"""
Ingestion pipeline: read new log lines → parse → enrich → store in DuckDB
→ broadcast to WebSocket clients → evaluate security rules.
"""
import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from core.enrichment import enrich
from core.log_parser import parse_line
from db.duckdb_manager import insert_parse_error, insert_request

logger = logging.getLogger(__name__)

# In-memory ring buffer for real-time WebSocket replay (10k entries)
_ring_buffer: deque[dict] = deque(maxlen=10_000)

# Registered broadcast callbacks (set by realtime WebSocket handler)
_broadcast_callbacks: list[Callable[[dict], None]] = []

# Discovery state (set during startup)
_logger_to_hosts: dict[str, list[str]] = {}
_source_labels: dict[str, str] = {}


def set_discovery_state(logger_to_hosts: dict, source_labels: dict | None = None) -> None:
    global _logger_to_hosts, _source_labels
    _logger_to_hosts = logger_to_hosts
    _source_labels = source_labels or {}


def register_broadcast(callback: Callable[[dict], None]) -> None:
    _broadcast_callbacks.append(callback)


def unregister_broadcast(callback: Callable[[dict], None]) -> None:
    try:
        _broadcast_callbacks.remove(callback)
    except ValueError:
        pass


def get_ring_buffer() -> list[dict]:
    return list(_ring_buffer)


def process_line(raw_line: str, log_source: str = "") -> Optional[dict]:
    """
    Synchronous part of the pipeline — called from the file watcher thread.
    Returns the enriched row if successful, None otherwise.
    """
    label = _source_labels.get(log_source, "")
    try:
        row = parse_line(raw_line, _logger_to_hosts, label, log_source)
    except Exception as e:
        try:
            insert_parse_error(raw_line, str(e), log_source)
        except Exception:
            pass
        logger.debug("Parse error for line from %s: %s", log_source, e)
        return None

    if row is None:
        return None

    row = enrich(row)
    return row


async def ingest_line_async(raw_line: str, log_source: str = "") -> None:
    """Full async pipeline — parse, store, broadcast."""
    loop = asyncio.get_event_loop()
    row = await loop.run_in_executor(None, process_line, raw_line, log_source)
    if row is None:
        return

    # Store in DuckDB
    try:
        await loop.run_in_executor(None, insert_request, row)
    except Exception as e:
        logger.error("DuckDB insert failed: %s", e)
        return

    # Add to ring buffer (serializable copy)
    ring_entry = _make_serializable(row)
    _ring_buffer.append(ring_entry)

    # Update rolling live-metrics window
    update_live_counters(row)

    # Broadcast to WebSocket clients
    if _broadcast_callbacks:
        msg = {"type": "new_request", "data": ring_entry}
        for cb in list(_broadcast_callbacks):
            try:
                cb(msg)
            except Exception:
                pass

    # Evaluate security rules (import here to avoid circular)
    try:
        from core.security_engine import evaluate_async
        await evaluate_async(row)
    except Exception as e:
        logger.debug("Security engine error: %s", e)


def _make_serializable(row: dict) -> dict:
    result: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            result[k] = v.isoformat()
        elif isinstance(v, (bool, int, float, str)) or v is None:
            result[k] = v
        else:
            result[k] = str(v)
    return result


# ── Live metrics — rolling 30-second event window ─────────────────────────────
#
# Each entry: (monotonic_timestamp, status_class, duration_ms, bytes_out, bytes_in, remote_ip)
# Old entries are evicted lazily inside get_live_metrics().
# This gives true per-second rates rather than cumulative totals.

_LIVE_WINDOW: float = 30.0  # seconds — how far back to look for RPS/rate computation

# deque is unbounded here; eviction happens in get_live_metrics
_event_window: deque[dict] = deque()


def update_live_counters(row: dict) -> None:
    _event_window.append({
        "t":  time.monotonic(),
        "sc": row.get("status_class") or "",
        "d":  row.get("duration_ms"),
        "bo": row.get("response_bytes") or 0,
        "bi": row.get("request_bytes") or 0,
        "ip": row.get("remote_ip") or "",
    })


def get_live_metrics() -> dict:
    now = time.monotonic()
    cutoff = now - _LIVE_WINDOW

    # Evict events older than the window
    while _event_window and _event_window[0]["t"] < cutoff:
        _event_window.popleft()

    events = list(_event_window)
    n = len(events)

    # Elapsed time: span of actual events, min 1 s, max LIVE_WINDOW
    if n >= 2:
        elapsed = max(events[-1]["t"] - events[0]["t"], 0.5)
    else:
        elapsed = _LIVE_WINDOW

    # Per-status counts
    c2 = sum(1 for e in events if e["sc"] == "2xx")
    c3 = sum(1 for e in events if e["sc"] == "3xx")
    c4 = sum(1 for e in events if e["sc"] == "4xx")
    c5 = sum(1 for e in events if e["sc"] == "5xx")

    rps      = round(n  / elapsed, 2)
    rps_2xx  = round(c2 / elapsed, 2)
    rps_3xx  = round(c3 / elapsed, 2)
    rps_4xx  = round(c4 / elapsed, 2)
    rps_5xx  = round(c5 / elapsed, 2)
    error_rate = round((c4 + c5) / max(n, 1), 4)

    # P50 latency
    durs = sorted(e["d"] for e in events if e["d"] is not None)
    p50 = durs[len(durs) // 2] if durs else 0

    # Unique IPs in window
    unique_ips = len({e["ip"] for e in events if e["ip"]})

    # Bandwidth (total bytes in rolling window)
    bytes_out = sum(e["bo"] for e in events)
    bytes_in  = sum(e["bi"] for e in events)

    return {
        "req_count":  n,
        "rps":        rps,
        "rps_2xx":    rps_2xx,
        "rps_3xx":    rps_3xx,
        "rps_4xx":    rps_4xx,
        "rps_5xx":    rps_5xx,
        "error_rate": error_rate,
        "unique_ips": unique_ips,
        "p50_ms":     p50,
        "bytes_out":  bytes_out,
        "bytes_in":   bytes_in,
        # Absolute counts for KPI tiles
        "req_2xx": c2,
        "req_3xx": c3,
        "req_4xx": c4,
        "req_5xx": c5,
    }


def reset_live_counters() -> None:
    # No-op with rolling window — window self-expires; kept for API compatibility.
    pass
