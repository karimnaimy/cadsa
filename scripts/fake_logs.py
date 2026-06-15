#!/usr/bin/env python3
"""
Fake Caddy log generator for cadsa development.

Usage:
    uv run scripts/fake_logs.py                          # stdout, 10 req/s
    uv run scripts/fake_logs.py --rate 50                # 50 req/s
    uv run scripts/fake_logs.py --output /tmp/access.log # write to file
    uv run scripts/fake_logs.py --attack                 # inject scanner/attack traffic
    uv run scripts/fake_logs.py --hosts site1.com,site2.com

Produces JSON lines exactly matching real Caddy v2.11.4 log format.
"""

import argparse
import json
import math
import random
import sys
import time
from datetime import datetime, timezone

# ── Realistic data pools ───────────────────────────────────────────────────────

DEFAULT_HOSTS = [
    "app.example.com",
    "api.example.com",
    "blog.example.com",
    "shop.example.com",
]

# Real Caddy TLS integer codes
TLS_VERSIONS = [772, 772, 772, 771]  # mostly TLS 1.3
TLS_CIPHERS = {
    772: [4865, 4866, 4867],          # TLS 1.3 ciphers
    771: [49199, 49200, 52392],        # TLS 1.2 ciphers
}
TLS_ALPN = ["h2", "h2", "h2", "http/1.1"]
HTTP_PROTOS = ["HTTP/2.0", "HTTP/2.0", "HTTP/2.0", "HTTP/1.1"]

USER_AGENTS = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"],
    ["Googlebot/2.1 (+http://www.google.com/bot.html)"],
    ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
]

SCANNER_AGENTS = [
    ["sqlmap/1.8.4#stable (https://sqlmap.org)"],
    ["Nikto/2.1.6"],
    ["Mozilla/5.0 (compatible; Nessus; http://www.nessus.org)"],
    ["masscan/1.3 (https://github.com/robertdavidgraham/masscan)"],
    ["python-requests/2.31.0"],
    ["curl/8.5.0"],
]

# IP pools with rough geo distribution
IPS_BY_COUNTRY = {
    "US": ["104.18.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(20)],
    "DE": ["185.220.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(10)],
    "CN": ["103.215.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(15)],
    "GB": ["81.2.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(8)],
    "FR": ["92.184.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(8)],
    "RU": ["95.213.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(10)],
    "BR": ["177.71.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(6)],
    "IN": ["49.36.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(8)],
    "NL": ["45.146.{}.{}".format(random.randint(0,255), random.randint(1,254)) for _ in range(6)],
}

ALL_IPS = [ip for ips in IPS_BY_COUNTRY.values() for ip in ips]

PATHS_AND_METHODS = [
    # Normal app traffic (weight, method, path_template, status_weights)
    (30, "GET",  "/",                       {200: 95, 304: 5}),
    (20, "GET",  "/api/status",             {200: 99, 503: 1}),
    (15, "GET",  "/api/v1/users",           {200: 85, 401: 10, 403: 5}),
    (10, "POST", "/api/v1/login",           {200: 70, 401: 25, 429: 5}),
    (10, "GET",  "/static/bundle.{}.js",    {200: 98, 304: 2}),
    ( 8, "GET",  "/blog/{}",                {200: 90, 404: 10}),
    ( 8, "GET",  "/api/v1/products",        {200: 95, 500: 5}),
    ( 5, "POST", "/api/v1/checkout",        {200: 80, 400: 15, 500: 5}),
    ( 5, "GET",  "/favicon.ico",            {200: 80, 404: 20}),
    ( 3, "GET",  "/robots.txt",             {200: 90, 404: 10}),
    ( 3, "GET",  "/sitemap.xml",            {200: 85, 404: 15}),
    ( 2, "PUT",  "/api/v1/users/{}",        {200: 90, 400: 5, 401: 5}),
    ( 2, "DELETE","/api/v1/sessions/{}",    {200: 95, 401: 5}),
    ( 1, "GET",  "/.well-known/acme-challenge/{}", {200: 100}),
]

ATTACK_PATHS = [
    ("GET",  "/../../../etc/passwd"),
    ("GET",  "/wp-admin/"),
    ("GET",  "/phpmyadmin/"),
    ("GET",  "/admin/"),
    ("POST", "/xmlrpc.php"),
    ("GET",  "/.env"),
    ("GET",  "/.git/config"),
    ("GET",  "/api/v1/users?id=1 OR 1=1--"),
    ("GET",  "/search?q=<script>alert(1)</script>"),
    ("GET",  "/api/v1/products?id=1;DROP TABLE users--"),
    ("GET",  "/cgi-bin/test.cgi"),
    ("GET",  "/etc/shadow"),
    ("GET",  "/proc/self/environ"),
    ("OPTIONS", "/"),
    ("TRACE", "/"),
]

REFERERS = [
    "",
    "",
    "",
    "https://www.google.com/",
    "https://www.google.com/",
    "https://t.co/abc123",
    "https://news.ycombinator.com/item?id=12345",
    "https://reddit.com/r/selfhosted/",
    "https://github.com/",
    "https://example.com/",
]

# Logger IDs → host mapping (mirrors real Caddy format)
_LOGGER_COUNTER = 1


def _make_logger_map(hosts: list[str]) -> dict[str, str]:
    """Map logger IDs to hosts, matching real Caddy naming."""
    return {f"log{i+1}": host for i, host in enumerate(hosts)}


def _weighted_choice(items: list[tuple]) -> tuple:
    weights = [item[0] for item in items]
    total = sum(weights)
    r = random.random() * total
    acc = 0
    for item in items:
        acc += item[0]
        if r <= acc:
            return item
    return items[-1]


def _status_from_weights(weights: dict[int, int]) -> int:
    total = sum(weights.values())
    r = random.random() * total
    acc = 0
    for status, w in weights.items():
        acc += w
        if r <= acc:
            return status
    return 200


def _random_path(template: str) -> str:
    placeholders = template.count("{}")
    slug_words = ["post", "article", "page", "product", "user", "item", "category"]
    replacements = []
    for _ in range(placeholders):
        if "." in template:
            replacements.append(str(random.randint(10000, 99999)))
        else:
            replacements.append(random.choice(slug_words) + "-" + str(random.randint(1, 999)))
    result = template
    for r in replacements:
        result = result.replace("{}", r, 1)
    return result


def _response_size(status: int, path: str) -> int:
    if status == 304:
        return 0
    if "/static/" in path:
        return random.randint(10_000, 500_000)
    if status >= 500:
        return random.randint(100, 500)
    if status == 404:
        return random.randint(200, 1500)
    if "/api/" in path:
        return random.randint(50, 5000)
    return random.randint(1000, 50_000)


def _duration(status: int, path: str) -> float:
    """Return duration in seconds (stored as float in Caddy)."""
    if "/api/v1/checkout" in path:
        return random.gauss(0.35, 0.15)
    if "/api/" in path:
        return random.gauss(0.025, 0.015)
    if "/static/" in path:
        return random.gauss(0.003, 0.002)
    if status >= 500:
        return random.gauss(2.5, 1.0)
    return random.gauss(0.05, 0.03)


def make_normal_entry(host: str, logger_id: str) -> dict:
    _, method, path_tpl, status_weights = _weighted_choice(PATHS_AND_METHODS)
    path = _random_path(path_tpl)
    status = _status_from_weights(status_weights)
    ip = random.choice(ALL_IPS)
    tls_ver = random.choice(TLS_VERSIONS)
    duration = max(0.0001, _duration(status, path))
    ua = random.choice(USER_AGENTS)
    referer = random.choice(REFERERS)

    entry: dict = {
        "level": "info",
        "ts": time.time() + random.gauss(0, 0.001),
        "logger": f"http.log.access.{logger_id}",
        "msg": "handled request",
        "request": {
            "remote_ip": ip,
            "remote_port": str(random.randint(10000, 65535)),
            "client_ip": ip,
            "proto": random.choice(HTTP_PROTOS),
            "method": method,
            "host": host,
            "uri": path,
            "headers": {
                "User-Agent": ua,
                "Accept": ["application/json" if "/api/" in path else "text/html,application/xhtml+xml"],
            },
            "tls": {
                "resumed": random.random() < 0.4,
                "version": tls_ver,
                "cipher_suite": random.choice(TLS_CIPHERS[tls_ver]),
                "proto": random.choice(TLS_ALPN),
                "server_name": host,
                "ech": False,
            },
        },
        "bytes_read": random.randint(0, 2048) if method in ("POST", "PUT") else 0,
        "user_id": "",
        "duration": duration,
        "size": _response_size(status, path),
        "status": status,
        "resp_headers": {
            "Content-Type": ["application/json; charset=utf-8" if "/api/" in path else "text/html; charset=utf-8"],
            "Via": ["0.0 Caddy"],
        },
    }

    if referer:
        entry["request"]["headers"]["Referer"] = [referer]

    return entry


def make_attack_entry(host: str, logger_id: str, attacker_ip: str) -> dict:
    method, path = random.choice(ATTACK_PATHS)
    tls_ver = random.choice(TLS_VERSIONS)
    ua = random.choice(SCANNER_AGENTS + USER_AGENTS[:3])

    return {
        "level": "info",
        "ts": time.time(),
        "logger": f"http.log.access.{logger_id}",
        "msg": "handled request",
        "request": {
            "remote_ip": attacker_ip,
            "remote_port": str(random.randint(10000, 65535)),
            "client_ip": attacker_ip,
            "proto": "HTTP/1.1",
            "method": method,
            "host": host,
            "uri": path,
            "headers": {
                "User-Agent": ua,
                "Accept": ["*/*"],
            },
            "tls": {
                "resumed": False,
                "version": tls_ver,
                "cipher_suite": random.choice(TLS_CIPHERS[tls_ver]),
                "proto": "http/1.1",
                "server_name": host,
                "ech": False,
            },
        },
        "bytes_read": 0,
        "user_id": "",
        "duration": random.uniform(0.001, 0.05),
        "size": random.randint(100, 800),
        "status": random.choice([400, 403, 404, 404, 404, 500]),
        "resp_headers": {
            "Content-Type": ["text/html; charset=utf-8"],
        },
    }


def make_rate_limit_burst(host: str, logger_id: str, attacker_ip: str, n: int) -> list[dict]:
    entries = []
    for _ in range(n):
        entry = make_normal_entry(host, logger_id)
        entry["request"]["remote_ip"] = attacker_ip
        entry["request"]["client_ip"] = attacker_ip
        entry["status"] = 429
        entries.append(entry)
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Fake Caddy log generator for cadsa dev")
    parser.add_argument("--rate", type=float, default=10.0,
                        help="Requests per second (default: 10)")
    parser.add_argument("--output", type=str, default="-",
                        help="Output file path (default: stdout)")
    parser.add_argument("--attack", action="store_true",
                        help="Inject attack/scanner traffic (~5%% of requests)")
    parser.add_argument("--hosts", type=str, default="",
                        help="Comma-separated hostnames (default: built-in demo hosts)")
    parser.add_argument("--burst-interval", type=float, default=30.0,
                        help="Seconds between rate-limit bursts when --attack is set (default: 30)")
    parser.add_argument("--duration", type=float, default=0,
                        help="Stop after N seconds (default: 0 = run forever)")
    args = parser.parse_args()

    hosts = [h.strip() for h in args.hosts.split(",") if h.strip()] or DEFAULT_HOSTS
    logger_map = _make_logger_map(hosts)   # {logger_id: host}
    host_to_logger = {v: k for k, v in logger_map.items()}

    out = sys.stdout if args.output == "-" else open(args.output, "a", buffering=1)

    interval = 1.0 / args.rate
    attacker_ip = "45.155.205.{}".format(random.randint(1, 254))
    next_burst = time.time() + args.burst_interval

    start = time.time()
    count = 0

    try:
        while True:
            now = time.time()

            if args.duration > 0 and (now - start) >= args.duration:
                break

            host = random.choice(hosts)
            logger_id = host_to_logger[host]

            # Attack traffic injection
            if args.attack and random.random() < 0.05:
                entry = make_attack_entry(host, logger_id, attacker_ip)
            elif args.attack and now >= next_burst:
                burst = make_rate_limit_burst(host, logger_id, attacker_ip, random.randint(20, 60))
                for e in burst:
                    out.write(json.dumps(e, separators=(",", ":")) + "\n")
                count += len(burst)
                next_burst = now + args.burst_interval + random.uniform(-5, 5)
                attacker_ip = "45.155.205.{}".format(random.randint(1, 254))
                continue
            else:
                entry = make_normal_entry(host, logger_id)

            out.write(json.dumps(entry, separators=(",", ":")) + "\n")
            count += 1

            elapsed = time.time() - now
            sleep_time = interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    except KeyboardInterrupt:
        total = time.time() - start
        rate = count / total if total > 0 else 0
        sys.stderr.write(f"\nGenerated {count} entries in {total:.1f}s ({rate:.1f} req/s)\n")
    finally:
        if out is not sys.stdout:
            out.close()


if __name__ == "__main__":
    main()
