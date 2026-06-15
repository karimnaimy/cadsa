#!/bin/sh
# cadsa — Caddy Server Analytics
# curl -fsSL https://raw.githubusercontent.com/karimnaimy/cadsa/main/install.sh | sudo sh
#
# Requirements: curl, openssl — nothing else.
# uv is installed automatically and manages Python 3.11+.
set -e

# ── Configuration ──────────────────────────────────────────────────────────────

REPO="karimnaimy/cadsa"
REPO_URL="https://github.com/${REPO}"
RELEASES_API="https://api.github.com/repos/${REPO}/releases/latest"

INSTALL_DIR="/opt/cadsa"
CONFIG_DIR="/etc/cadsa"
DATA_DIR="/var/lib/cadsa"
LOG_DIR="/var/log/cadsa"
SERVICE_USER="cadsa"
SERVICE_NAME="cadsa"
INSTALL_LOG="/var/log/cadsa-install.log"
GEOIP_URL="https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"

# ── Logging ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

_log()    { printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$INSTALL_LOG" 2>/dev/null || true; }
info()    { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; _log "INFO: $1"; }
success() { printf "${GREEN}[OK]${NC}    %s\n" "$1"; _log "OK: $1"; }
warn()    { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; _log "WARN: $1"; }
error()   { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; _log "ERROR: $1"; exit 1; }

# ── Pre-flight ─────────────────────────────────────────────────────────────────

[ "$(id -u)" -eq 0 ] || error "Must run as root: sudo sh install.sh"

mkdir -p "$(dirname "$INSTALL_LOG")"
touch "$INSTALL_LOG" 2>/dev/null || true
info "Starting cadsa installation"
_log "Started on $(uname -a)"

# ── uv ────────────────────────────────────────────────────────────────────────

if command -v uv >/dev/null 2>&1; then
    UV_BIN=$(command -v uv)
    info "uv already installed: $(uv --version)"
else
    info "Installing uv..."
    curl -fsSL https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh
    UV_BIN="/usr/local/bin/uv"
    [ -x "$UV_BIN" ] || error "uv installation failed"
    success "uv installed: $($UV_BIN --version)"
fi

# ── Latest release ─────────────────────────────────────────────────────────────

info "Fetching latest release..."
VERSION=$(curl -fsSL "$RELEASES_API" \
    | grep '"tag_name"' | head -1 \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
[ -n "$VERSION" ] || error "Could not determine latest release. Check your internet connection."
info "Version: $VERSION"

# ── Download tarball ───────────────────────────────────────────────────────────

TARBALL_NAME="cadsa-${VERSION}.tar.gz"
TARBALL_URL="${REPO_URL}/releases/download/${VERSION}/${TARBALL_NAME}"
TARBALL_TMP="/tmp/${TARBALL_NAME}"

info "Downloading ${TARBALL_NAME}..."
curl -fsSL --progress-bar -o "$TARBALL_TMP" "$TARBALL_URL" \
    || error "Download failed: $TARBALL_URL"
success "Download complete"

# ── System user and directories ────────────────────────────────────────────────

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    info "Creating system user: $SERVICE_USER"
    useradd -r -s /sbin/nologin -d "$INSTALL_DIR" -c "cadsa service" "$SERVICE_USER"
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"
chown root:"$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR"
chown "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR" "$LOG_DIR"
chmod 755 "$INSTALL_DIR"
chmod 750 "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"
success "Directories ready"

# ── Extract ────────────────────────────────────────────────────────────────────

info "Extracting to $INSTALL_DIR..."
tar -xzf "$TARBALL_TMP" -C "$INSTALL_DIR"
rm -f "$TARBALL_TMP"
success "Extracted"

# ── Build Python virtualenv ────────────────────────────────────────────────────

info "Installing Python dependencies (this may take a moment)..."
cd "$INSTALL_DIR/backend"
# UV_PYTHON_INSTALL_DIR puts any downloaded Python under /usr/local so the
# cadsa service user (ProtectHome=yes) can access it — not /root/.local/
UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python "$UV_BIN" sync --frozen --no-dev
cd /
success "Dependencies installed"

# ── GeoIP database ─────────────────────────────────────────────────────────────

GEOIP_PATH="$DATA_DIR/GeoLite2-City.mmdb"
if [ ! -f "$GEOIP_PATH" ]; then
    info "Downloading GeoIP database..."
    if curl -fsSL -o "$GEOIP_PATH.tmp" "$GEOIP_URL" 2>/dev/null; then
        mv "$GEOIP_PATH.tmp" "$GEOIP_PATH"
        chown "$SERVICE_USER":"$SERVICE_USER" "$GEOIP_PATH"
        success "GeoIP database ready ($(du -sh "$GEOIP_PATH" | cut -f1))"
    else
        warn "GeoIP download failed — geo features disabled until manually updated"
        rm -f "$GEOIP_PATH.tmp"
    fi
else
    success "GeoIP database already present"
fi

# ── Generate secrets and write config ─────────────────────────────────────────

PRIVATE_KEY_PATH="$CONFIG_DIR/jwt_private.pem"
PUBLIC_KEY_PATH="$CONFIG_DIR/jwt_public.pem"

if [ -f "$CONFIG_DIR/cadsa.yaml" ]; then
    info "Config already exists — preserving it"
else
    info "Generating secrets..."

    command -v openssl >/dev/null 2>&1 || error "openssl is required. Install it and re-run."

    SECRET_KEY=$("$INSTALL_DIR/backend/.venv/bin/python" -c "import secrets; print(secrets.token_hex(32))")
    openssl genrsa -out "$PRIVATE_KEY_PATH" 4096 2>/dev/null
    openssl rsa -in "$PRIVATE_KEY_PATH" -pubout -out "$PUBLIC_KEY_PATH" 2>/dev/null
    chmod 640 "$PRIVATE_KEY_PATH" "$PUBLIC_KEY_PATH"
    chown root:"$SERVICE_USER" "$PRIVATE_KEY_PATH" "$PUBLIC_KEY_PATH"
    success "RSA-4096 key pair generated"

    cat > "$CONFIG_DIR/cadsa.yaml" << YAML
# cadsa configuration — generated $(date '+%Y-%m-%d')
# Docs: ${REPO_URL}#configuration

server:
  host: "127.0.0.1"
  port: 3131
  secret_key: "${SECRET_KEY}"
  jwt_private_key_path: "${PRIVATE_KEY_PATH}"
  jwt_public_key_path: "${PUBLIC_KEY_PATH}"

caddy:
  admin_api_url: "http://localhost:2019"
  admin_api_enabled: true
  caddyfile_path: ""

logs:
  auto_discover: true
  initial_backfill_hours: 24

database:
  analytics_path: "${DATA_DIR}/analytics.duckdb"
  app_path: "${DATA_DIR}/app.sqlite"
  retention_days: 90
  aggregation_retention_days: 365

geoip:
  enabled: true
  db_path: "${GEOIP_PATH}"
  auto_update: true

security:
  rate_limit_threshold: 300
  error_rate_threshold: 0.20
  slow_request_threshold_ms: 2000

alerts:
  email:
    enabled: false
    smtp_host: ""
    smtp_port: 587
    smtp_user: ""
    smtp_password: ""
    from: ""
    to: []
  webhook:
    enabled: false
    url: ""
    secret: ""

threat_intel:
  abuseipdb:
    enabled: false
    api_key: ""
    cache_hours: 24
YAML

    chmod 640 "$CONFIG_DIR/cadsa.yaml"
    chown root:"$SERVICE_USER" "$CONFIG_DIR/cadsa.yaml"
    success "Config written to $CONFIG_DIR/cadsa.yaml"
fi

# ── Ownership ──────────────────────────────────────────────────────────────────

chown -R root:"$SERVICE_USER" "$INSTALL_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR" "$LOG_DIR"

# ── systemd service ────────────────────────────────────────────────────────────

cp "$INSTALL_DIR/cadsa.service" /etc/systemd/system/"$SERVICE_NAME".service
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
success "Service installed and started"

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "cadsa is running"
else
    warn "Service may not have started. Check: journalctl -u $SERVICE_NAME -n 50"
fi

# ── Block direct port access ───────────────────────────────────────────────────

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw deny 3131 comment "cadsa — internal only" >/dev/null 2>&1 || true
    info "UFW: blocked port 3131 from public access"
elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-rich-rule='rule port port="3131" protocol="tcp" reject' >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    info "firewalld: blocked port 3131 from public access"
fi

# ── Done ───────────────────────────────────────────────────────────────────────

printf "\n"
printf "${GREEN}══════════════════════════════════════════════════════${NC}\n"
printf "${GREEN}  cadsa %s installed successfully!${NC}\n" "$VERSION"
printf "${GREEN}══════════════════════════════════════════════════════${NC}\n"
printf "\n"
printf "  Login at your domain with:\n"
printf "    Username : admin\n"
printf "    Password : admin\n"
printf "  You will be prompted to change your password and set up 2FA on first login.\n"
printf "\n"
printf "  Service commands:\n"
printf "    systemctl status %s\n" "$SERVICE_NAME"
printf "    journalctl -u %s -f\n" "$SERVICE_NAME"
printf "\n"
printf "  Update:  curl -fsSL ${REPO_URL}/raw/main/update.sh | sudo sh\n"
printf "  Config:  %s/cadsa.yaml\n" "$CONFIG_DIR"
printf "\n"
printf "  ${BLUE}Caddyfile snippet to expose cadsa:${NC}\n"
printf "    cadsa.yourdomain.com {\n"
printf "      reverse_proxy 127.0.0.1:3131\n"
printf "    }\n"
printf "\n"
