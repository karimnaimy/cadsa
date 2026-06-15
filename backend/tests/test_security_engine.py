"""
Unit tests for core/security_engine.py.

Tests every detection rule in _evaluate() in isolation.
The engine is pure-Python (no DB calls in unit tests — we test _evaluate directly).
"""
from collections import deque
from datetime import datetime, timezone

import pytest

import core.security_engine as engine
from core.security_engine import _evaluate, _SQLI, _XSS, _PATH_TRAVERSAL, _SCANNER_UA, _BAD_BOT_UA


def _make_row(**overrides) -> dict:
    base = {
        "remote_ip": "10.0.0.1",
        "host": "example.com",
        "uri": "/api/test",
        "path": "/api/test",
        "method": "GET",
        "status": 200,
        "user_agent": "Mozilla/5.0 TestBrowser",
        "duration_ms": 50,
    }
    base.update(overrides)
    return base


def _clear_ip_state(ip: str) -> None:
    """Reset in-memory sliding windows for an IP between tests."""
    engine._ip_req_window.pop(ip, None)
    engine._ip_404_paths.pop(ip, None)
    engine._ip_login_posts.pop(ip, None)


# ── Regex pattern unit tests ───────────────────────────────────────────────────

class TestPatternMatching:
    def test_sqli_union_select(self):
        assert _SQLI.search("?id=1 UNION SELECT username,password FROM users")

    def test_sqli_or_true(self):
        assert _SQLI.search("' OR '1'='1")

    def test_sqli_drop_table(self):
        assert _SQLI.search("?x=1;DROP TABLE users--")

    def test_sqli_xp_cmdshell(self):
        assert _SQLI.search("/exec?cmd=xp_cmdshell('whoami')")

    def test_sqli_no_false_positive_normal_path(self):
        assert not _SQLI.search("/api/v1/users/123")

    def test_xss_script_tag(self):
        assert _XSS.search("<script>alert(1)</script>")

    def test_xss_javascript_proto(self):
        assert _XSS.search("javascript:void(0)")

    def test_xss_event_handler(self):
        assert _XSS.search("?x=<img onload=alert(1)>")

    def test_xss_eval(self):
        assert _XSS.search("?x=eval(atob('dGVzdA=='))")

    def test_xss_no_false_positive(self):
        assert not _XSS.search("/api/search?q=hello+world")

    def test_path_traversal_dotdot(self):
        assert _PATH_TRAVERSAL.search("/../../../etc/passwd")

    def test_path_traversal_encoded(self):
        assert _PATH_TRAVERSAL.search("/%2e%2e/%2e%2e/etc/shadow")

    def test_path_traversal_double_encoded(self):
        assert _PATH_TRAVERSAL.search("/%252e%252e/")

    def test_path_traversal_null_byte(self):
        assert _PATH_TRAVERSAL.search("/etc/passwd\x00.jpg")

    def test_scanner_nikto(self):
        assert _SCANNER_UA.search("Nikto/2.1.6")

    def test_scanner_sqlmap(self):
        assert _SCANNER_UA.search("sqlmap/1.8.4#stable")

    def test_scanner_nuclei(self):
        assert _SCANNER_UA.search("nuclei - Open Source")

    def test_scanner_no_false_positive(self):
        assert not _SCANNER_UA.search("Mozilla/5.0 Chrome/131.0")

    def test_bad_bot_ahrefs(self):
        assert _BAD_BOT_UA.search("Mozilla/5.0 (compatible; AhrefsBot/7.0)")

    def test_bad_bot_semrush(self):
        assert _BAD_BOT_UA.search("SemrushBot/7~bl")

    def test_bad_bot_no_false_positive(self):
        assert not _BAD_BOT_UA.search("Googlebot/2.1")


# ── _evaluate() detection rule tests ──────────────────────────────────────────

class TestEvaluateDetection:
    def setup_method(self):
        # Use unique IPs per test to avoid cross-test state contamination
        import uuid
        self.ip = f"192.168.{abs(hash(str(uuid.uuid4()))) % 256}.{abs(hash(str(uuid.uuid4()))) % 254 + 1}"

    def teardown_method(self):
        _clear_ip_state(self.ip)

    def test_clean_request_generates_no_events(self):
        row = _make_row(remote_ip=self.ip)
        events = _evaluate(row)
        sqli = [e for e in events if e["event_type"] == "sql_injection_attempt"]
        xss = [e for e in events if e["event_type"] == "xss_attempt"]
        assert not sqli
        assert not xss

    def test_sql_injection_detected(self):
        row = _make_row(
            remote_ip=self.ip,
            uri="/search?q=1' UNION SELECT * FROM users--",
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "sql_injection_attempt" in types

    def test_xss_detected(self):
        row = _make_row(
            remote_ip=self.ip,
            uri="/page?x=<script>alert(document.cookie)</script>",
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "xss_attempt" in types

    def test_path_traversal_detected(self):
        row = _make_row(
            remote_ip=self.ip,
            uri="/../../../etc/passwd",
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "path_traversal" in types

    def test_scanner_ua_detected(self):
        row = _make_row(
            remote_ip=self.ip,
            user_agent="sqlmap/1.8 (https://sqlmap.org)",
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "known_scanner" in types

    def test_bad_bot_ua_detected(self):
        row = _make_row(
            remote_ip=self.ip,
            user_agent="AhrefsBot/7.0; +http://ahrefs.com/robot/",
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "bad_bot" in types

    def test_trace_method_abuse(self):
        row = _make_row(remote_ip=self.ip, method="TRACE")
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "http_method_abuse" in types

    def test_connect_method_abuse(self):
        row = _make_row(remote_ip=self.ip, method="CONNECT")
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "http_method_abuse" in types

    def test_rate_limit_trigger(self):
        from config import get_config
        threshold = get_config().security.rate_limit_threshold

        ip = self.ip
        _clear_ip_state(ip)

        # Pre-fill the sliding window just below threshold
        now = datetime.now(timezone.utc)
        window = engine._ip_req_window[ip]
        for _ in range(threshold - 1):
            window.append(now)

        # This request should push it over
        row = _make_row(remote_ip=ip)
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "rate_limit_trigger" in types

    def test_port_scan_detected_after_50_unique_404_paths(self):
        ip = self.ip
        _clear_ip_state(ip)

        # Pre-populate 50 unique 404 paths
        for i in range(50):
            engine._ip_404_paths[ip].add(f"/scan-path-{i}")

        # This 51st 404 triggers the event
        row = _make_row(remote_ip=ip, status=404, uri="/scan-path-99", path="/scan-path-99")
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "port_scan_attempt" in types

    def test_repeated_auth_fail_detected(self):
        ip = self.ip
        _clear_ip_state(ip)

        # Pre-fill login window with 10 attempts
        now = datetime.now(timezone.utc)
        for _ in range(10):
            engine._ip_login_posts[ip].append(now)

        # The 11th triggers the event
        row = _make_row(
            remote_ip=ip, method="POST",
            uri="/api/v1/auth/login", path="/api/v1/auth/login",
            status=401,
        )
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "repeated_auth_fail" in types

    def test_slow_request_spike_detected(self):
        from config import get_config
        threshold = get_config().security.slow_request_threshold_ms

        row = _make_row(remote_ip=self.ip, duration_ms=threshold + 1)
        events = _evaluate(row)
        types = [e["event_type"] for e in events]
        assert "slow_request_spike" in types

    def test_event_has_required_fields(self):
        row = _make_row(
            remote_ip=self.ip,
            uri="/search?q=<script>xss</script>",
        )
        events = _evaluate(row)
        assert events
        for event in events:
            assert "event_type" in event
            assert "severity" in event
            assert "remote_ip" in event
            assert "host" in event
            assert "ts" in event

    def test_severity_values_are_valid(self):
        valid = {"info", "low", "medium", "high", "critical"}
        row = _make_row(remote_ip=self.ip, uri="/xss?x=<script>alert(1)</script>")
        events = _evaluate(row)
        for event in events:
            assert event["severity"] in valid, f"Bad severity: {event['severity']}"


class TestExpireWindow:
    def test_old_entries_expire(self):
        from datetime import timedelta
        from core.security_engine import _expire_window

        now = datetime.now(timezone.utc)
        old = now - timedelta(seconds=120)

        window = deque([old, old, now])
        _expire_window(window, now, seconds=60)
        assert len(window) == 1  # only `now` remains

    def test_empty_window_is_safe(self):
        from core.security_engine import _expire_window
        window = deque()
        _expire_window(window, datetime.now(timezone.utc), seconds=60)
        assert len(window) == 0
