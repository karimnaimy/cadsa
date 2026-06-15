# CADSA — Caddy Server Analytics

Real-time analytics and security monitoring for [Caddy](https://caddyserver.com/) web servers. Parses your Caddy access logs live, enriches every request with GeoIP and user-agent data, detects security threats, and presents everything in a fast web dashboard.

> **Phase 1** — Full monitoring and analytics. Caddy configuration management comes in Phase 2.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Install](#quick-install)
- [Manual Installation](#manual-installation)
- [First Login](#first-login)
- [Configuration Reference](#configuration-reference)
- [Log Discovery](#log-discovery)
- [Alerts](#alerts)
- [Updating](#updating)
- [Development Setup](#development-setup)
- [Caddy Configuration](#caddy-configuration)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## Features

**Dashboard & Analytics**
- Real-time request stream with live metrics (req/s, error rate, unique IPs)
- Traffic charts by HTTP status class (2xx / 3xx / 4xx / 5xx)
- Unique visitors chart (per time window)
- Bandwidth in/out over time
- Response time percentiles (P50, P75, P95, P99)
- Top endpoints, top IPs, top countries, top referrers
- HTTP method and device-type breakdowns
- Browser and OS fingerprinting
- Busy-hour heatmap (requests by day × hour UTC)
- Per-host drill-down with all analytics scoped to a single virtual host
- Per-IP profile with full activity history, paths accessed, and security events

**Geographic Analytics**
- World choropleth map (request count or error rate)
- Country and city-level tables with unique IP counts
- Click-to-filter directly from the map

**Security**
- Automatic threat detection: rate-limit triggers, SQL injection attempts, XSS, path traversal, port scans, known scanners, bad bots, repeated auth failures, HTTP method abuse, and more
- Per-IP threat scoring (0–100)
- Optional AbuseIPDB integration for real-time threat intelligence
- IP blocklist and whitelist management
- Security event timeline with severity levels

**Alerts**
- Configurable alert rules (threshold / anomaly / pattern)
- Email (SMTP) and webhook notifications
- Per-rule cooldown periods
- Alert history

**Authentication**
- Mandatory 2FA (TOTP — Google Authenticator compatible) — cannot be skipped
- JWT with RS256 (asymmetric keys generated on install)
- Server-side refresh token revocation
- Account lockout after 10 failed login attempts

---

## Requirements

**Server**
- Linux — Ubuntu 20.04+, Debian 11+, CentOS/RHEL 8+, Fedora 36+, or Arch
- x86\_64 or aarch64
- Python 3.11 or newer (managed automatically by uv if not present)
- Caddy v2.x with JSON access logging enabled (see [Caddy Configuration](#caddy-configuration))
- Root (or sudo) for installation

**Network**
- The port cadsa listens on (default `3131`) must **not** be exposed publicly — Caddy proxies to it over localhost
- Caddy Admin API at `localhost:2019` (enabled by default in Caddy) is used for automatic log discovery

---

## Quick Install

```sh
curl -fsSL https://raw.githubusercontent.com/karimnaimy/cadsa/main/install.sh | sudo sh
```

The script:
1. Verifies Python 3.11+ is available
2. Creates the `cadsa` system user
3. Downloads and installs the application to `/opt/cadsa/`
4. Downloads the GeoLite2-City database for IP geolocation
5. Generates a 4096-bit RSA key pair and a random secret key
6. Creates `/etc/cadsa/cadsa.yaml` with all secrets pre-filled
7. Installs and starts the `cadsa` systemd service
8. Prints your one-time admin password — **save it now**

After install, cadsa listens on `http://127.0.0.1:3131`. Set up a Caddy reverse proxy (see [Caddy Configuration](#caddy-configuration)) to expose the dashboard over HTTPS.

---

## Manual Installation

If you prefer to install without the script (e.g. in a custom environment):

```sh
# 1. Create system user
useradd -r -s /sbin/nologin -d /opt/cadsa cadsa

# 2. Create directories
mkdir -p /opt/cadsa /etc/cadsa /var/lib/cadsa /var/log/cadsa
chown cadsa:cadsa /var/lib/cadsa /var/log/cadsa

# 3. Clone repository
git clone https://github.com/karimnaimy/cadsa /opt/cadsa
cd /opt/cadsa

# 4. Install Python dependencies (using uv)
curl -LsSf https://astral.sh/uv/install.sh | sh
cd backend && uv sync --frozen

# 5. Copy and edit the config file
cp config/cadsa.yaml.example /etc/cadsa/cadsa.yaml
chmod 640 /etc/cadsa/cadsa.yaml
chown root:cadsa /etc/cadsa/cadsa.yaml

# 6. Generate secrets
SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
sed -i "s/secret_key: \"\"/secret_key: \"$SECRET\"/" /etc/cadsa/cadsa.yaml

openssl genrsa -out /etc/cadsa/jwt_private.pem 4096
openssl rsa -in /etc/cadsa/jwt_private.pem -pubout -out /etc/cadsa/jwt_public.pem
chmod 640 /etc/cadsa/jwt_private.pem /etc/cadsa/jwt_public.pem
chown root:cadsa /etc/cadsa/jwt_private.pem /etc/cadsa/jwt_public.pem

# 7. Download GeoIP database
curl -L -o /var/lib/cadsa/GeoLite2-City.mmdb \
  https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb

# 8. Install and start the service
cp cadsa.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cadsa
```

---

## First Login

1. Open the dashboard URL in your browser (e.g. `https://cadsa.yourdomain.com`)
2. Log in with the default credentials:
   - **Username:** `admin`
   - **Password:** `admin`
3. **You will be forced to change your password** — this cannot be skipped
4. **You will be forced to set up 2FA** — scan the QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code to confirm it works
5. Eight single-use backup codes are generated and shown once — store them securely

Every subsequent login requires username + password + 6-digit TOTP code.

---

## Configuration Reference

The configuration file lives at `/etc/cadsa/cadsa.yaml`. The install script creates it with secrets pre-filled. Below is the full reference.

```yaml
server:
  host: "127.0.0.1"        # bind address — never 0.0.0.0 in production
  port: 3131               # port cadsa listens on
  secret_key: ""           # 32-byte hex — auto-generated on install
  jwt_private_key_path: "/etc/cadsa/jwt_private.pem"
  jwt_public_key_path:  "/etc/cadsa/jwt_public.pem"

caddy:
  admin_api_url: "http://localhost:2019"  # Caddy Admin API for log discovery
  admin_api_enabled: true
  caddyfile_path: ""       # leave empty for automatic detection

logs:
  auto_discover: true      # discover log files via Caddy Admin API (recommended)

  # Manual override — only needed if auto-discovery fails
  # sources:
  #   - path: "/var/log/caddy/access.log"
  #     format: "json"     # json | auto
  #     label: "global"    # label shown in UI for requests with no host field

  initial_backfill_hours: 24  # how many hours of history to load on startup
                               # set to 0 to tail only new lines

database:
  analytics_path: "/var/lib/cadsa/analytics.duckdb"  # request data (DuckDB)
  app_path:       "/var/lib/cadsa/app.sqlite"         # users, sessions, alerts (SQLite)
  retention_days: 90            # raw request retention (days)
  aggregation_retention_days: 365  # hourly aggregations retention (days)

geoip:
  enabled: true
  db_path: "/var/lib/cadsa/GeoLite2-City.mmdb"
  auto_update: true        # download updated database weekly

security:
  rate_limit_threshold: 300        # requests/minute from a single IP = alert
  error_rate_threshold: 0.20       # 20% 4xx+5xx rate over 5 min = alert
  slow_request_threshold_ms: 2000  # P95 above this for 5 min = alert

alerts:
  email:
    enabled: false
    smtp_host: "smtp.example.com"
    smtp_port: 587
    smtp_user: "cadsa@example.com"
    smtp_password: "yourpassword"
    from: "cadsa@example.com"
    to: ["admin@example.com"]

  webhook:
    enabled: false
    url: "https://hooks.example.com/cadsa"
    secret: "hmac-signing-secret"  # HMAC-SHA256 signature sent in X-Cadsa-Signature header

threat_intel:
  abuseipdb:
    enabled: false
    api_key: ""             # get a free key at https://www.abuseipdb.com
    cache_hours: 24         # cache lookup results to avoid hitting rate limits
```

Restart cadsa after any config change:

```sh
systemctl restart cadsa
```

---

## Log Discovery

cadsa automatically finds your Caddy log files using a three-step fallback:

**Step 1 — Caddy Admin API (recommended)**
Queries `http://localhost:2019/config/` to read the live Caddy configuration. This gives the exact log file paths, which virtual hosts map to which logger, and which hosts are excluded from logging. No manual configuration needed.

The Caddy Admin API is enabled by default. If you have disabled it, add this to the top of your Caddyfile and reload Caddy:
```
{
    admin localhost:2019
}
```

**Step 2 — Caddyfile parsing**
If the Admin API is unreachable, cadsa parses the Caddyfile directly to extract `output file` paths from `log { }` blocks. It searches process arguments and common paths (`/etc/caddy/Caddyfile`, etc.).

**Step 3 — Filesystem scan**
Scans `/var/log/caddy/`, `/var/log/`, and other common locations for files matching `access*.log`, `caddy*.log`.

**Manual override**
If auto-discovery fails, specify log sources directly in the config:

```yaml
logs:
  auto_discover: false
  sources:
    - path: "/var/log/caddy/access.log"
      format: "json"
      label: "production"
```

**Caddy must log in JSON format.** If your Caddyfile doesn't already have structured logging, add the following snippet and import it in each site block:

```caddyfile
(access) {
    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb
            roll_keep 10
        }
        format json
    }
}

yourdomain.com {
    import access
    reverse_proxy localhost:8080
}
```

---

## Alerts

Alerts are configured through the web UI at `/alerts`.

**Creating a rule:**
1. Click **New Rule**
2. Choose a metric: `request_rate`, `error_rate`, `latency_p95`, `bandwidth`, or `security_event`
3. Set a threshold and time window
4. Choose scope: global or per-host
5. Set a cooldown period (minimum time between repeated alerts)
6. Choose notifiers: email and/or webhook

**Email setup:**
Configure SMTP in `/etc/cadsa/cadsa.yaml` under `alerts.email`, restart cadsa, then use the **Test** button in Settings → Alerts to verify delivery.

**Webhook payload:**
```json
{
  "rule": "High error rate",
  "metric": "error_rate",
  "value": 0.34,
  "threshold": 0.20,
  "host": "example.com",
  "triggered_at": "2025-06-14T18:30:00Z"
}
```

The `X-Cadsa-Signature` header contains `sha256=HMAC(secret, body)` for payload verification.

---

## Updating

```sh
curl -fsSL https://raw.githubusercontent.com/karimnaimy/cadsa/main/update.sh | sudo sh
```

Or manually:

```sh
cd /opt/cadsa
git pull
cd backend && uv sync --frozen
systemctl restart cadsa
```

The update script never touches `/etc/cadsa/cadsa.yaml` or the databases.

---

## Development Setup

You need Python 3.11+, Node.js 18+, `uv`, and `corepack`/`yarn` on your machine.

**Backend:**
```sh
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000 --host 127.0.0.1
```

The backend reads config from `/etc/cadsa/cadsa.yaml` by default. Override with the `CADSA_CONFIG_PATH` environment variable:

```sh
CADSA_DEV_MODE=1 CADSA_CONFIG_PATH=./dev.yaml uv run uvicorn main:app --reload --port 8000
```

`CADSA_DEV_MODE=1` enables CORS for the Vite dev server and relaxes cookie security.

**Frontend:**
```sh
cd frontend
yarn install
yarn dev        # starts on http://localhost:5173 — proxies /api and /ws to :8000
```

**Running tests:**
```sh
cd backend
uv run pytest           # 136 tests — parser, DB, auth, security engine
uv run pytest -v        # verbose output
```

**Generating fake log data (for development):**
```sh
cd scripts
uv run fake_logs.py --rate 10 --output /tmp/fake-access.log
# then point cadsa at /tmp/fake-access.log in your dev config
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `CADSA_CONFIG_PATH` | `/etc/cadsa/cadsa.yaml` | Path to config file |
| `CADSA_SERVER_PORT` | (from config) | Override listen port |
| `CADSA_LOG_LEVEL` | `info` | `debug` / `info` / `warning` / `error` |
| `CADSA_DEV_MODE` | `0` | `1` enables CORS for localhost:5173 |

---

## Caddy Configuration

cadsa itself does **not** handle TLS. Caddy proxies to it and provides HTTPS. Add a site block like this to your Caddyfile:

```caddyfile
cadsa.yourdomain.com {
    reverse_proxy 127.0.0.1:3131

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;"
        -Server
    }
}
```

Then reload Caddy:
```sh
systemctl reload caddy
```

---

## Security Notes

- cadsa's port (`3131`) is bound to `127.0.0.1` only and should never be opened externally. The install script does not open firewall rules.
- The JWT private key and config file (containing the secret key) are `root:cadsa 640` — readable by the `cadsa` service user only.
- The `cadsa` service user has no shell, no home directory, and runs with `NoNewPrivileges`, `PrivateTmp`, and `ProtectSystem=strict`.
- 2FA cannot be disabled after setup. If you lose both your TOTP device and backup codes, reset via the server:

```sh
# Reset 2FA for the admin account (run as root on the server)
sqlite3 /var/lib/cadsa/app.sqlite \
  "UPDATE users SET totp_secret=NULL, totp_confirmed=0, must_change_password=1 WHERE username='admin';"
systemctl restart cadsa
```

---

## Troubleshooting

**cadsa won't start**
```sh
systemctl status cadsa
journalctl -u cadsa -n 100 --no-pager
```

**No data in the dashboard**
1. Check that Caddy is writing JSON logs: `tail -f /var/log/caddy/access.log | python3 -m json.tool`
2. Verify the Caddy Admin API is reachable: `curl http://localhost:2019/config/`
3. Check cadsa can read the log file: `ls -la /var/log/caddy/access.log`
4. Check the cadsa log for parse errors: `journalctl -u cadsa | grep ERROR`

**"Connection refused" on the dashboard**
cadsa is not running or failed to start. Check `systemctl status cadsa`.

**"No log files detected" warning in the UI**
Auto-discovery failed. Either enable the Caddy Admin API (see [Log Discovery](#log-discovery)) or set manual sources in `/etc/cadsa/cadsa.yaml`.

**GeoIP not working (all locations show as Unknown)**
The GeoLite2 database may be missing or stale. Trigger a manual update from Settings → GeoIP, or:
```sh
curl -L -o /var/lib/cadsa/GeoLite2-City.mmdb \
  https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb
systemctl restart cadsa
```

**Forgot 2FA device**
Use a backup code on the login screen. If backup codes are also lost, see the reset command in [Security Notes](#security-notes).

**Disk usage**
Raw request data is retained for 90 days by default, hourly aggregations for 1 year. Adjust `retention_days` and `aggregation_retention_days` in the config. Current database sizes are shown in Settings → System.

---

## File Locations

| Path | Contents |
|---|---|
| `/opt/cadsa/` | Application code |
| `/etc/cadsa/cadsa.yaml` | Configuration file |
| `/etc/cadsa/jwt_private.pem` | JWT signing key (keep secret) |
| `/etc/cadsa/jwt_public.pem` | JWT verification key |
| `/var/lib/cadsa/analytics.duckdb` | Request analytics database |
| `/var/lib/cadsa/app.sqlite` | Users, sessions, alerts, settings |
| `/var/lib/cadsa/GeoLite2-City.mmdb` | GeoIP database |
| `/var/log/cadsa/` | cadsa own log output |
| `/var/log/cadsa-install.log` | Install script log |

---

## License

MIT — see `LICENSE`.
