"""
Real-time log file watcher using watchdog (cross-platform) + inotify on Linux.
Tails log files and feeds new lines into the ingestion pipeline.
"""
import asyncio
import logging
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from watchdog.events import FileModifiedEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

_observer: Optional[Observer] = None
_loop: Optional[asyncio.AbstractEventLoop] = None

# Fast regex to extract the Unix timestamp from a Caddy JSON log line
_TS_RE = re.compile(rb'"ts"\s*:\s*([0-9]+(?:\.[0-9]+)?)')


def _extract_ts(line_bytes: bytes) -> Optional[datetime]:
    """Extract the 'ts' Unix-float field from a raw log line."""
    m = _TS_RE.search(line_bytes)
    if not m:
        return None
    try:
        return datetime.fromtimestamp(float(m.group(1)), tz=timezone.utc)
    except (ValueError, OSError):
        return None


class LogFileHandler(FileSystemEventHandler):
    def __init__(
        self,
        filepath: str,
        loop: asyncio.AbstractEventLoop,
        ingest_fn,
    ) -> None:
        super().__init__()
        self.filepath = os.path.abspath(filepath)
        self.loop = loop
        self.ingest_fn = ingest_fn
        self._pos = 0
        self._lock = threading.Lock()
        # Start at end of file (only watch new lines)
        try:
            self._pos = os.path.getsize(self.filepath)
        except OSError:
            self._pos = 0

    def on_modified(self, event: FileModifiedEvent) -> None:
        if os.path.abspath(event.src_path) != self.filepath:
            return
        self._read_new_lines()

    def _read_new_lines(self) -> None:
        with self._lock:
            try:
                current_size = os.path.getsize(self.filepath)
                if current_size < self._pos:
                    # Log rotated — reset position
                    self._pos = 0

                with open(self.filepath, "rb") as f:
                    f.seek(self._pos)
                    new_data = f.read()
                    self._pos = f.tell()

                lines = new_data.decode("utf-8", errors="replace").splitlines()
                for line in lines:
                    line = line.strip()
                    if line:
                        asyncio.run_coroutine_threadsafe(
                            self.ingest_fn(line, self.filepath),
                            self.loop,
                        )
            except Exception as e:
                logger.error("Error reading %s: %s", self.filepath, e)

    def backfill(self, cutoff_ts: datetime, last_ts: Optional[datetime] = None) -> None:
        """
        Scan the entire file and ingest lines within the retention window.
        cutoff_ts: oldest line to accept (now - backfill_days)
        last_ts:   newest ts already stored for this source — skip anything at or before it
        """
        with self._lock:
            try:
                ingested = skipped_old = skipped_dup = 0
                with open(self.filepath, "rb") as f:
                    for raw in f:
                        raw = raw.rstrip()
                        if not raw:
                            continue
                        ts = _extract_ts(raw)
                        if ts is None:
                            continue
                        if ts < cutoff_ts:
                            skipped_old += 1
                            continue
                        if last_ts is not None and ts <= last_ts:
                            skipped_dup += 1
                            continue
                        asyncio.run_coroutine_threadsafe(
                            self.ingest_fn(raw.decode("utf-8", errors="replace"), self.filepath),
                            self.loop,
                        )
                        ingested += 1
                    self._pos = f.tell()

                logger.info(
                    "Backfill %s: ingested=%d skipped_old=%d skipped_dup=%d",
                    self.filepath, ingested, skipped_old, skipped_dup,
                )
            except Exception as e:
                logger.error("Backfill error for %s: %s", self.filepath, e)


def start_watching(
    log_files: list[str],
    loop: asyncio.AbstractEventLoop,
    ingest_fn,
    backfill_days: int = 0,
    get_last_ts: Optional[Callable[[str], Optional[datetime]]] = None,
) -> None:
    """
    Start watching the given log files.
    backfill_days: how many days of history to ingest on startup (0 = disabled).
    get_last_ts:   callable(filepath) → newest ts already stored for that source.
    """
    global _observer, _loop
    _loop = loop

    if _observer is not None:
        _observer.stop()
        _observer.join()

    _observer = Observer()
    handlers: dict[str, LogFileHandler] = {}

    cutoff_ts = (
        datetime.now(timezone.utc) - timedelta(days=backfill_days)
        if backfill_days > 0 else None
    )

    for filepath in log_files:
        if not os.path.exists(filepath):
            logger.warning("Log file not found, will retry when it appears: %s", filepath)
            continue

        handler = LogFileHandler(filepath, loop, ingest_fn)

        if cutoff_ts is not None:
            last_ts = get_last_ts(filepath) if get_last_ts else None
            try:
                handler.backfill(cutoff_ts, last_ts)
            except Exception as e:
                logger.warning("Could not backfill %s: %s", filepath, e)

        watch_dir = str(Path(filepath).parent)
        _observer.schedule(handler, watch_dir, recursive=False)
        handlers[filepath] = handler
        logger.info("Watching log file: %s", filepath)

    _observer.start()
    logger.info("Log watcher started for %d file(s)", len(handlers))


def stop_watching() -> None:
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None
        logger.info("Log watcher stopped")
