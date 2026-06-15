"""
Unit tests for core/log_parser.py.

- TLS integer decoding (version + cipher)
- Host resolution 5-level chain
- clean_host / clean_ip normalization
- Duration seconds → milliseconds
- Header extraction (list format)
- Missing/null fields handled gracefully
- Non-access-log lines skipped
- Malformed JSON raises ValueError
"""
import json
from datetime import timezone

import pytest

from core.log_parser import (
    clean_host,
    clean_ip,
    decode_tls_cipher,
    decode_tls_version,
    deep_get,
    extract_path_and_query,
    get_status_class,
    parse_line,
    resolve_host,
)

# ── The exact real-world Caddy v2.11.4 log entry ────────────

REAL_WORLD_LINE = json.dumps({
    "level": "info",
    "ts": 1781339575.9193668,
    "logger": "http.log.access.log8",
    "msg": "handled request",
    "request": {
        "remote_ip": "103.215.211.240",
        "remote_port": "62387",
        "client_ip": "103.215.211.240",
        "proto": "HTTP/2.0",
        "method": "GET",
        "host": "finovate.yakja.co",
        "uri": "/api/status",
        "headers": {
            "User-Agent": ["Mozilla/5.0 (compatible)"],
            "Accept": ["application/json"],
        },
        "tls": {
            "resumed": True,
            "version": 772,
            "cipher_suite": 4865,
            "proto": "h2",
            "server_name": "finovate.yakja.co",
            "ech": False,
        },
    },
    "bytes_read": 0,
    "user_id": "",
    "duration": 0.009408015,
    "size": 92,
    "status": 200,
    "resp_headers": {
        "Content-Type": ["application/json"],
        "Via": ["0.0 Caddy"],
    },
})


class TestDecoding:
    def test_tls_version_tls13(self):
        assert decode_tls_version(772) == "TLS 1.3"

    def test_tls_version_tls12(self):
        assert decode_tls_version(771) == "TLS 1.2"

    def test_tls_version_tls11(self):
        assert decode_tls_version(770) == "TLS 1.1"

    def test_tls_version_tls10(self):
        assert decode_tls_version(769) == "TLS 1.0"

    def test_tls_version_unknown_integer(self):
        assert decode_tls_version(9999) == "UNKNOWN(9999)"

    def test_tls_version_none(self):
        assert decode_tls_version(None) is None

    def test_tls_version_string_passthrough(self):
        # Old Caddy logs that already have a string
        assert decode_tls_version("TLS 1.3") == "TLS 1.3"

    def test_tls_cipher_tls13_aes128(self):
        assert decode_tls_cipher(4865) == "TLS_AES_128_GCM_SHA256"

    def test_tls_cipher_tls13_aes256(self):
        assert decode_tls_cipher(4866) == "TLS_AES_256_GCM_SHA384"

    def test_tls_cipher_tls13_chacha(self):
        assert decode_tls_cipher(4867) == "TLS_CHACHA20_POLY1305_SHA256"

    def test_tls_cipher_tls12_ecdhe_rsa_aes128(self):
        assert decode_tls_cipher(
            49199) == "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"

    def test_tls_cipher_tls12_chacha(self):
        assert decode_tls_cipher(
            52392) == "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305"

    def test_tls_cipher_unknown(self):
        assert decode_tls_cipher(1234) == "UNKNOWN(1234)"

    def test_tls_cipher_none(self):
        assert decode_tls_cipher(None) is None


class TestDeepGet:
    def test_nested_access(self):
        d = {"a": {"b": {"c": 42}}}
        assert deep_get(d, "a", "b", "c") == 42

    def test_missing_key_returns_none(self):
        d = {"a": {"b": 1}}
        assert deep_get(d, "a", "x", "y") is None

    def test_none_input_returns_none(self):
        assert deep_get(None, "a") is None

    def test_list_index(self):
        d = {"headers": {"UA": ["chrome"]}}
        assert deep_get(d, "headers", "UA", 0) == "chrome"

    def test_list_out_of_bounds(self):
        d = {"h": []}
        assert deep_get(d, "h", 0) is None


class TestCleanHost:
    def test_strips_port(self):
        assert clean_host("example.com:443") == "example.com"

    def test_strips_http_port(self):
        assert clean_host("example.com:80") == "example.com"

    def test_lowercase(self):
        assert clean_host("EXAMPLE.COM") == "example.com"

    def test_strips_trailing_dot(self):
        assert clean_host("example.com.") == "example.com"

    def test_ipv6_bracket(self):
        assert clean_host("[::1]:8080") == "::1"

    def test_ipv6_no_port(self):
        assert clean_host("[::1]") == "::1"

    def test_plain_hostname(self):
        assert clean_host("api.example.com") == "api.example.com"

    def test_empty_string(self):
        assert clean_host("") == ""


class TestCleanIP:
    def test_plain_ipv4(self):
        assert clean_ip("1.2.3.4") == "1.2.3.4"

    def test_ipv6_with_brackets_and_port(self):
        assert clean_ip("[::1]:8080") == "::1"

    def test_ipv6_zone_id(self):
        assert clean_ip("fe80::1%eth0") == "fe80::1"

    def test_ipv6_full(self):
        assert clean_ip("[fe80::1%eth0]") == "fe80::1"

    def test_empty(self):
        assert clean_ip("") == ""


class TestStatusClass:
    def test_2xx(self):
        assert get_status_class(200) == "2xx"
        assert get_status_class(204) == "2xx"

    def test_3xx(self):
        assert get_status_class(301) == "3xx"
        assert get_status_class(304) == "3xx"

    def test_4xx(self):
        assert get_status_class(404) == "4xx"
        assert get_status_class(429) == "4xx"

    def test_5xx(self):
        assert get_status_class(500) == "5xx"
        assert get_status_class(503) == "5xx"

    def test_none(self):
        assert get_status_class(None) is None


class TestExtractPathAndQuery:
    def test_no_query(self):
        path, query = extract_path_and_query("/api/v1/users")
        assert path == "/api/v1/users"
        assert query == ""

    def test_with_query(self):
        path, query = extract_path_and_query("/search?q=hello&page=2")
        assert path == "/search"
        assert query == "q=hello&page=2"

    def test_empty(self):
        path, query = extract_path_and_query("")
        assert path == ""
        assert query == ""


class TestResolveHost:
    def test_uses_request_host_first(self):
        entry = {"request": {"host": "app.example.com"}}
        assert resolve_host(entry, {}) == "app.example.com"

    def test_falls_back_to_sni(self):
        entry = {
            "request": {"host": "", "tls": {"server_name": "sni.example.com"}},
        }
        assert resolve_host(entry, {}) == "sni.example.com"

    def test_falls_back_to_host_header(self):
        entry = {
            "request": {
                "host": "",
                "tls": {},
                "headers": {"Host": ["header.example.com"]},
            }
        }
        assert resolve_host(entry, {}) == "header.example.com"

    def test_falls_back_to_logger_mapping(self):
        entry = {"logger": "http.log.access.log8", "request": {"host": ""}}
        mapping = {"log8": ["mapped.example.com"]}
        assert resolve_host(entry, mapping) == "mapped.example.com"

    def test_falls_back_to_source_label(self):
        entry = {"logger": "unknown_logger", "request": {}}
        assert resolve_host(
            entry, {}, source_label="fallback.example.com") == "fallback.example.com"

    def test_returns_unknown_as_last_resort(self):
        entry = {"request": {}}
        assert resolve_host(entry, {}) == "unknown"

    def test_logger_id_extracted_from_dotted_name(self):
        # "http.log.access.log8" → "log8"
        entry = {"logger": "http.log.access.log8", "request": {}}
        mapping = {"log8": ["site.com"]}
        assert resolve_host(entry, mapping) == "site.com"


class TestParseLine:
    def test_real_world_entry(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["host"] == "finovate.yakja.co"
        assert row["remote_ip"] == "103.215.211.240"
        assert row["method"] == "GET"
        assert row["uri"] == "/api/status"
        assert row["status"] == 200
        assert row["status_class"] == "2xx"
        assert row["protocol"] == "HTTP/2.0"
        assert row["http_proto"] == "HTTP/2.0"

    def test_tls_integers_decoded(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["tls_version"] == "TLS 1.3"
        assert row["tls_cipher"] == "TLS_AES_128_GCM_SHA256"
        assert row["tls_alpn"] == "h2"
        assert row["tls_resumed"] is True
        assert row["tls_ech"] is False

    def test_duration_converted_to_ms(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        # 0.009408015 seconds * 1000 = ~9 ms
        assert row["duration_ms"] == 9

    def test_timestamp_is_utc_datetime(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["ts"].tzinfo == timezone.utc

    def test_user_agent_extracted_from_list(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["user_agent"] == "Mozilla/5.0 (compatible)"

    def test_geoip_fields_are_none(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["country_code"] is None
        assert row["city"] is None

    def test_non_access_log_returns_none(self):
        line = json.dumps({"level": "info", "ts": 1.0,
                          "msg": "starting", "logger": "core"})
        assert parse_line(line, {}) is None

    def test_empty_line_returns_none(self):
        assert parse_line("", {}) is None
        assert parse_line("   ", {}) is None

    def test_malformed_json_raises(self):
        with pytest.raises((ValueError, json.JSONDecodeError)):
            parse_line("{not valid json", {})

    def test_missing_tls_block(self):
        entry = {
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.log1", "msg": "handled request",
            "request": {"remote_ip": "1.2.3.4", "client_ip": "1.2.3.4",
                        "proto": "HTTP/1.1", "method": "GET",
                        "host": "plain.example.com", "uri": "/",
                        "headers": {}},
            "duration": 0.01, "size": 100, "status": 200,
        }
        row = parse_line(json.dumps(entry), {})
        assert row is not None
        assert row["tls_version"] is None
        assert row["tls_cipher"] is None
        assert row["tls_ech"] is None

    def test_empty_proto_field(self):
        entry = {
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.log1", "msg": "handled request",
            "request": {"remote_ip": "1.2.3.4", "client_ip": "1.2.3.4",
                        "proto": "", "method": "GET",
                        "host": "plain.example.com", "uri": "/",
                        "headers": {}},
            "duration": 0.05, "size": 500, "status": 200,
        }
        row = parse_line(json.dumps(entry), {})
        assert row is not None
        # empty string → None after truncation guard
        assert row["protocol"] is None

    def test_client_ip_preferred_over_remote_ip(self):
        entry = {
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.log1", "msg": "handled request",
            "request": {
                "remote_ip": "10.0.0.1",
                "client_ip": "203.0.113.99",
                "proto": "HTTP/2.0", "method": "GET",
                "host": "example.com", "uri": "/",
                "headers": {}
            },
            "duration": 0.01, "size": 0, "status": 204,
        }
        row = parse_line(json.dumps(entry), {})
        assert row is not None
        assert row["remote_ip"] == "203.0.113.99"

    def test_path_and_query_split(self):
        entry = {
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.log1", "msg": "handled request",
            "request": {
                "remote_ip": "1.1.1.1", "client_ip": "1.1.1.1",
                "proto": "HTTP/2.0", "method": "GET",
                "host": "example.com", "uri": "/search?q=test&page=2",
                "headers": {}
            },
            "duration": 0.01, "size": 1024, "status": 200,
        }
        row = parse_line(json.dumps(entry), {})
        assert row is not None
        assert row["path"] == "/search"
        assert row["query"] == "q=test&page=2"

    def test_logger_id_extracted(self):
        row = parse_line(REAL_WORLD_LINE, {})
        assert row is not None
        assert row["logger_id"] == "log8"
        assert "http.log.access.log8" in row["logger_name"]

    def test_ech_absent_on_old_caddy(self):
        entry = {
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.log1", "msg": "handled request",
            "request": {
                "remote_ip": "1.1.1.1", "client_ip": "1.1.1.1",
                "proto": "HTTP/2.0", "method": "GET",
                "host": "example.com", "uri": "/",
                "headers": {},
                "tls": {
                    "resumed": False,
                    "version": 771,
                    "cipher_suite": 49199,
                    "proto": "http/1.1",
                    "server_name": "example.com",
                    # no "ech" key — old Caddy
                },
            },
            "duration": 0.01, "size": 200, "status": 200,
        }
        row = parse_line(json.dumps(entry), {})
        assert row is not None
        assert row["tls_ech"] is None

    def test_logger_id_to_host_mapping(self):
        line = json.dumps({
            "level": "info", "ts": 1_700_000_000.0,
            "logger": "http.log.access.logX", "msg": "handled request",
            "request": {
                "remote_ip": "5.5.5.5", "client_ip": "5.5.5.5",
                "proto": "HTTP/2.0", "method": "GET",
                # NO host field at all
                "uri": "/", "headers": {},
            },
            "duration": 0.01, "size": 100, "status": 200,
        })
        mapping = {"logX": ["mapped-via-logger.com"]}
        row = parse_line(line, mapping)
        assert row is not None
        assert row["host"] == "mapped-via-logger.com"
