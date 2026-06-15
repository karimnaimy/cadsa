#!/bin/sh
# cadsa — Caddy Server Analytics
# curl -fsSL https://raw.githubusercontent.com/karimnaimy/cadsa/main/update.sh | sudo sh
#
# Updates the application in-place. Preserves /etc/cadsa/ and /var/lib/cadsa/.
set -e

REPO="karimnaimy/cadsa"
REPO_URL="https://github.com/${REPO}"
RELEASES_API="https://api.github.com/repos/${REPO}/releases/latest"
INSTALL_DIR="/opt/cadsa"
SERVICE_NAME="cadsa"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; }
success() { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn()    { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
error()   { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error "Must run as root: sudo sh update.sh"
[ -d "$INSTALL_DIR" ]  || error "cadsa is not installed at $INSTALL_DIR. Run install.sh first."

# ── uv ────────────────────────────────────────────────────────────────────────

if command -v uv >/dev/null 2>&1; then
    UV_BIN=$(command -v uv)
else
    UV_BIN="/usr/local/bin/uv"
    if [ ! -x "$UV_BIN" ]; then
        info "Installing uv..."
        curl -fsSL https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh
        [ -x "$UV_BIN" ] || error "uv installation failed"
    fi
fi

# ── Version check ──────────────────────────────────────────────────────────────

CURRENT_VERSION="unknown"
[ -f "$INSTALL_DIR/.cadsa-version" ] && CURRENT_VERSION=$(cat "$INSTALL_DIR/.cadsa-version")
info "Installed: $CURRENT_VERSION"

info "Checking latest release..."
VERSION=$(curl -fsSL "$RELEASES_API" \
    | grep '"tag_name"' | head -1 \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
[ -n "$VERSION" ] || error "Could not determine latest version."

if [ "$VERSION" = "$CURRENT_VERSION" ]; then
    success "Already on the latest version ($VERSION) — nothing to do."
    exit 0
fi
info "Updating: $CURRENT_VERSION → $VERSION"

# ── Download ───────────────────────────────────────────────────────────────────

TARBALL_NAME="cadsa-${VERSION}.tar.gz"
TARBALL_URL="${REPO_URL}/releases/download/${VERSION}/${TARBALL_NAME}"
TARBALL_TMP="/tmp/${TARBALL_NAME}"

info "Downloading ${TARBALL_NAME}..."
curl -fsSL --progress-bar -o "$TARBALL_TMP" "$TARBALL_URL" \
    || error "Download failed: $TARBALL_URL"
success "Download complete"

# ── Stop, extract, rebuild venv ────────────────────────────────────────────────

info "Stopping $SERVICE_NAME..."
systemctl stop "$SERVICE_NAME" || true

info "Clearing analytics database (will be rebuilt from logs on startup)..."
rm -f /var/lib/cadsa/analytics.duckdb
success "Analytics DB cleared"

info "Extracting..."
rm -rf "$INSTALL_DIR/backend" "$INSTALL_DIR/cadsa.service" "$INSTALL_DIR/config"
tar -xzf "$TARBALL_TMP" -C "$INSTALL_DIR"
rm -f "$TARBALL_TMP"
success "Extracted"

info "Updating dependencies..."
cd "$INSTALL_DIR/backend"
UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python "$UV_BIN" sync --frozen --no-dev
cd /
success "Dependencies updated"

# ── Ownership + service ────────────────────────────────────────────────────────

chown -R root:cadsa "$INSTALL_DIR"
cp "$INSTALL_DIR/cadsa.service" /etc/systemd/system/"$SERVICE_NAME".service
systemctl daemon-reload

echo "$VERSION" > "$INSTALL_DIR/.cadsa-version"

systemctl start "$SERVICE_NAME"
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "cadsa $VERSION is running"
else
    warn "Service may not have started. Check: journalctl -u $SERVICE_NAME -n 50"
fi

printf "\n"
printf "${GREEN}Updated cadsa: %s → %s${NC}\n" "$CURRENT_VERSION" "$VERSION"
printf "  journalctl -u %s -f\n\n" "$SERVICE_NAME"
