"""
Smart Caddy log file discovery — Admin API → Caddyfile → filesystem scan.
"""
import asyncio
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

SCAN_DIRECTORIES = ["/var/log/caddy/", "/var/log/", "/tmp/", "/home/"]
LOG_FILENAME_PATTERNS = ["access.log",
                         "access*.log", "caddy*.log", "*.access.log"]


@dataclass
class DiscoveryResult:
    success: bool
    log_files: list[str] = field(default_factory=list)
    logger_to_hosts: dict[str, list[str]] = field(default_factory=dict)
    logger_to_file: dict[str, str] = field(default_factory=dict)
    skip_hosts: set[str] = field(default_factory=set)
    source: str = ""
    failures: list[str] = field(default_factory=list)

    @classmethod
    def failure(cls, reason: str, suggestions: list[str] | None = None) -> "DiscoveryResult":
        return cls(success=False, failures=[reason] + (suggestions or []))


def deep_get(d: object, *keys: str) -> object:
    current = d
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)  # type: ignore[union-attr]
    return current


async def try_caddy_admin_api(base_url: str) -> DiscoveryResult:
    import aiohttp

    url = base_url.rstrip("/") + "/config/"
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return DiscoveryResult.failure(
                        f"Caddy Admin API at {url} returned HTTP {resp.status}"
                    )
                config = await resp.json(content_type=None)
    except Exception as e:
        return DiscoveryResult.failure(f"Caddy Admin API at {url} — {e}")

    logger_to_hosts: dict[str, list[str]] = {}
    skip_hosts: set[str] = set()
    logger_to_file: dict[str, str] = {}

    servers = deep_get(config, "apps", "http", "servers") or {}
    if isinstance(servers, dict):
        for server in servers.values():
            if not isinstance(server, dict):
                continue
            logs_cfg = server.get("logs") or {}
            s_skip = set(logs_cfg.get("skip_hosts") or [])
            skip_hosts.update(s_skip)
            logger_names = logs_cfg.get("logger_names") or {}
            if isinstance(logger_names, dict):
                for hostname, logger_ids in logger_names.items():
                    if hostname in s_skip:
                        continue
                    if isinstance(logger_ids, list):
                        for lid in logger_ids:
                            logger_to_hosts.setdefault(
                                str(lid), []).append(hostname)
                    elif logger_ids:
                        logger_to_hosts.setdefault(
                            str(logger_ids), []).append(hostname)

    log_configs = deep_get(config, "logging", "logs") or {}
    if isinstance(log_configs, dict):
        for log_id, log_cfg in log_configs.items():
            if log_id == "default":
                continue
            if not isinstance(log_cfg, dict):
                continue
            filename = deep_get(log_cfg, "writer", "filename")
            if filename:
                logger_to_file[log_id] = str(filename)

    log_files = list(set(logger_to_file.values()))

    # Also grab default logger file
    system_log = deep_get(log_configs, "default", "writer",
                          "filename") if isinstance(log_configs, dict) else None
    if system_log and str(system_log) not in log_files:
        log_files.append(str(system_log))

    if not log_files:
        return DiscoveryResult.failure(
            f"Caddy Admin API at {url} succeeded but no log file paths found in config"
        )

    return DiscoveryResult(
        success=True,
        log_files=log_files,
        logger_to_hosts=logger_to_hosts,
        logger_to_file=logger_to_file,
        skip_hosts=skip_hosts,
        source="caddy_admin_api",
    )


def find_caddyfile() -> Optional[str]:
    """Locate Caddyfile from process args or common paths."""
    try:
        import psutil
        for proc in psutil.process_iter(["cmdline"]):
            cmdline = proc.info.get("cmdline") or []
            if not cmdline:
                continue
            if "caddy" in (cmdline[0] or "").lower():
                for i, arg in enumerate(cmdline):
                    if arg in ("--config", "-config") and i + 1 < len(cmdline):
                        return cmdline[i + 1]
    except Exception:
        pass

    candidates = [
        "/etc/caddy/Caddyfile",
        "/etc/caddy/caddy.conf",
        "/usr/local/etc/caddy/Caddyfile",
        "/opt/caddy/Caddyfile",
        os.path.expanduser("~/.config/caddy/Caddyfile"),
    ]
    return next((p for p in candidates if os.path.isfile(p)), None)


def parse_caddyfile_for_logs(path: str) -> DiscoveryResult:
    """Simple Caddyfile parser — extract log file paths from output file directives."""
    log_files: list[str] = []
    try:
        with open(path) as f:
            content = f.read()

        import re
        # Match: output file /path/to/file
        matches = re.findall(r"output\s+file\s+([^\s\n{]+)", content)
        log_files = [m.strip('"\'') for m in matches if m]
    except Exception as e:
        return DiscoveryResult.failure(f"Could not read Caddyfile at {path}: {e}")

    if not log_files:
        return DiscoveryResult.failure(f"No log file directives found in {path}")

    return DiscoveryResult(
        success=True,
        log_files=log_files,
        source="caddyfile",
    )


def scan_common_log_locations() -> DiscoveryResult:
    """Filesystem scan for Caddy log files."""
    import fnmatch

    found: list[str] = []
    for directory in SCAN_DIRECTORIES:
        if not os.path.isdir(directory):
            continue
        try:
            for entry in os.scandir(directory):
                if not entry.is_file():
                    continue
                for pattern in LOG_FILENAME_PATTERNS:
                    if fnmatch.fnmatch(entry.name, pattern):
                        if _looks_like_caddy_log(entry.path):
                            found.append(entry.path)
                        break
        except PermissionError:
            continue

    if not found:
        return DiscoveryResult.failure("Filesystem scan found no matching log files")

    return DiscoveryResult(success=True, log_files=found, source="filesystem_scan")


def _looks_like_caddy_log(path: str) -> bool:
    """Quick heuristic: peek at first line and check for Caddy-specific fields."""
    try:
        import json
        with open(path) as f:
            for _ in range(5):
                line = f.readline()
                if not line:
                    break
                try:
                    obj = json.loads(line)
                    if "msg" in obj and "request" in obj:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


async def discover_caddy_logs(
    admin_api_url: str,
    admin_api_enabled: bool,
    caddyfile_path: str,
    manual_sources: list[dict] | None = None,
) -> tuple[DiscoveryResult, list[str]]:
    """
    Returns (result, diagnostic_steps) where diagnostic_steps records what was tried.
    """
    tried: list[str] = []

    # Manual override always wins
    if manual_sources:
        files = [s["path"] for s in manual_sources if "path" in s]
        if files:
            labels = {s["path"]: s.get("label", "") for s in manual_sources}
            return DiscoveryResult(success=True, log_files=files, source="manual_config"), tried

    # Step 1: Admin API
    if admin_api_enabled:
        result = await try_caddy_admin_api(admin_api_url)
        tried.append(
            f"Caddy Admin API at {admin_api_url} — {'OK' if result.success else result.failures[0]}")
        if result.success:
            return result, tried

    # Step 2: Caddyfile
    cf_path = caddyfile_path or find_caddyfile()
    if cf_path:
        result = parse_caddyfile_for_logs(cf_path)
        tried.append(
            f"Caddyfile at {cf_path} — {'OK' if result.success else result.failures[0]}")
        if result.success:
            return result, tried
    else:
        tried.append(
            "Caddyfile — not found (checked process args and common paths)")

    # Step 3: Filesystem scan
    result = scan_common_log_locations()
    tried.append(
        f"Filesystem scan — {'OK' if result.success else result.failures[0]}")
    if result.success:
        return result, tried

    return DiscoveryResult.failure("Could not find any Caddy log files"), tried
