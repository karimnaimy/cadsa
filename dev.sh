#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEV_DIR="$ROOT/.dev"
CONFIG="$DEV_DIR/cadsa.dev.yaml"
KEY_PRIV="$DEV_DIR/jwt_private.pem"
KEY_PUB="$DEV_DIR/jwt_public.pem"
LOG_FILE="/tmp/cadsa-access.log"
GEOIP_PATH="$DEV_DIR/GeoLite2-City.mmdb"
GEOIP_URL="https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"

mkdir -p "$DEV_DIR"

# ── RSA keys ──────────────────────────────────────────────────────────────────
if [ ! -f "$KEY_PRIV" ]; then
  echo "[dev] Generating RSA key pair..."
  openssl genrsa -out "$KEY_PRIV" 2048 2>/dev/null
  openssl rsa -in "$KEY_PRIV" -pubout -out "$KEY_PUB" 2>/dev/null
fi

# ── Download GeoIP database ────────────────────────────────────────────────────
if [ ! -f "$GEOIP_PATH" ]; then
    if curl -fsSL -o "$GEOIP_PATH.tmp" "$GEOIP_URL" 2>/dev/null; then
        mv "$GEOIP_PATH.tmp" "$GEOIP_PATH"
    else
        rm -f "$GEOIP_PATH.tmp"
    fi
fi

# ── Dev config ────────────────────────────────────────────────────────────────
if [ ! -f "$CONFIG" ]; then
  echo "[dev] Creating dev config at $CONFIG"
  cat > "$CONFIG" <<YAML
server:
  secret_key: "dev-secret-not-for-production"
  jwt_private_key_path: "$KEY_PRIV"
  jwt_public_key_path: "$KEY_PUB"

database:
  analytics_path: "$DEV_DIR/analytics.duckdb"
  app_path: "$DEV_DIR/app.sqlite"

geoip:
  enabled: true
  db_path: "${GEOIP_PATH}"

logs:
  auto_discover: false
  sources:
    - path: $LOG_FILE
      format: json
      label: dev
YAML
fi

# ── Cleanup on exit ───────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  echo "[dev] Stopping..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "[dev] Done."
}
trap cleanup EXIT INT TERM

# ── Start fake log generator ──────────────────────────────────────────────────
echo "[dev] Starting fake log generator → $LOG_FILE"
touch "$LOG_FILE"
uv run "$ROOT/scripts/fake_logs.py" --rate 0.2 --output "$LOG_FILE" &
PIDS+=($!)

# ── Start backend ─────────────────────────────────────────────────────────────
echo "[dev] Starting backend on http://localhost:8000"
(
  cd "$ROOT/backend"
  CADSA_CONFIG_PATH="$CONFIG" CADSA_DEV_MODE=1 \
    uv run uvicorn main:app --reload --port 8000 --host 127.0.0.1
) &
PIDS+=($!)

# ── Start frontend ────────────────────────────────────────────────────────────
echo "[dev] Starting frontend on http://localhost:5173"
(
  cd "$ROOT/frontend"
  yarn dev
) &
PIDS+=($!)

echo ""
echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:5173"
echo ""
echo "  Press Ctrl+C to stop all processes."
echo ""

wait
