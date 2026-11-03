#!/bin/bash
# dev-env.sh <state-dir>
# Builds a self-contained local stack state directory:
#   <state-dir>/stack.env                         stack.env.example + dev.env.example,
#                                                 empty values filled with random hex
#   <state-dir>/tls/live/<domain>/{fullchain,privkey}.pem   self-signed, both hostnames
#   <state-dir>/acme/  <state-dir>/reports/sample/report.html
# Existing secrets and certificates are kept, so a re-run is a no-op.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${1:?usage: dev-env.sh <state-dir>}"
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd)"
ENV_FILE="$STATE/stack.env"

render_env() {
  local key value override
  while IFS= read -r line; do
    case "$line" in
      '' | '#'*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    override="$(grep -E "^${key}=" "$INFRA/env/dev.env.example" | tail -n 1 || true)"
    case "$key" in
      OMNI_TLS_DIR) value="$STATE/tls" ;;
      OMNI_ACME_DIR) value="$STATE/acme" ;;
      OMNI_REPORTS_DIR) value="$STATE/reports" ;;
      OMNI_NGINX_DIR) value="$INFRA/nginx" ;;
      *)
        if [ -n "$override" ]; then
          value="${override#*=}" # dev value, kept even when empty
        elif [ -z "$value" ]; then
          value="$(openssl rand -hex 24)" # a secret the owner would set
        fi
        ;;
    esac
    printf '%s=%s\n' "$key" "$value"
  done < "$INFRA/env/stack.env.example"
  # dev-only keys (ports) that stack.env.example does not carry
  grep -E '^[A-Z0-9_]+=' "$INFRA/env/dev.env.example" | while IFS= read -r line; do
    grep -qE "^${line%%=*}=" "$INFRA/env/stack.env.example" || printf '%s\n' "$line"
  done
  printf 'OMNI_RELEASE=dev\n'
}

if [ ! -s "$ENV_FILE" ]; then
  umask 077
  render_env > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  umask 022
fi

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }
DOMAIN="$(env_value OMNI_DOMAIN)"
REPORTS_DOMAIN="$(env_value OMNI_REPORTS_DOMAIN)"

CERT_DIR="$STATE/tls/live/$DOMAIN"
if [ ! -s "$CERT_DIR/fullchain.pem" ]; then
  mkdir -p "$CERT_DIR"
  cat > "$STATE/tls/openssl.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $DOMAIN
[ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = DNS:$DOMAIN, DNS:$REPORTS_DOMAIN
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -config "$STATE/tls/openssl.cnf" 2>/dev/null
  chmod 0644 "$CERT_DIR/privkey.pem" # read by nginx's root master in the container only
fi

mkdir -p "$STATE/acme" "$STATE/reports/sample"
if [ ! -f "$STATE/reports/sample/report.html" ]; then
  cat > "$STATE/reports/sample/report.html" <<'EOF'
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>sample report</title></head><body><p>sample report</p></body></html>
EOF
fi
chmod -R a+rX "$STATE/reports" "$STATE/acme"

echo "$ENV_FILE"
