#!/bin/bash
# Local stack with the real apps (W12-20; the lead wires it to
# `npm run stack:local` / `stack:local:down`).
#   local.sh up     build + start on https://omniswarm.localhost:<OMNI_HTTPS_PORT>
#   local.sh down   stop and remove containers (keeps the database volume)
#   local.sh reset  stop, remove containers and the database volume
# State (random secrets, self-signed cert, reports dir) lives in
# infra/compose/.local/ (gitignored). The worker is not containerized; run it
# in the foreground with the command `up` prints.
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$INFRA/compose/.local"
env_file="$(bash "$INFRA/compose/dev-env.sh" "$STATE")"
export OMNI_PROJECT=omniswarm-local OMNI_PROFILE=dev OMNI_ENV_FILE="$env_file" OMNI_SRV="$STATE/srv"
# shellcheck source=infra/deploy/lib.sh
. "$INFRA/deploy/lib.sh"

case "${1:-}" in
  up)
    omni_compose up -d --build --wait
    port="$(omni_env_value OMNI_HTTPS_PORT)"
    cat <<EOF
stack up: https://$(omni_env_value OMNI_DOMAIN):$port/  (CA: $STATE/tls/live/$(omni_env_value OMNI_DOMAIN)/fullchain.pem)
worker (foreground, from the repo root):
  DATABASE_URL=postgres://omniswarm:\$(grep ^POSTGRES_PASSWORD= $env_file | cut -d= -f2)@127.0.0.1:$(omni_env_value OMNI_PG_PORT)/omniswarm \\
  REPORTS_ROOT=$STATE/reports REPORTS_BASE_URL=https://$(omni_env_value OMNI_REPORTS_DOMAIN):$port ENGINE_ROOT=$(cd "$INFRA/.." && pwd) \\
  CONTRACT_ID=$(omni_env_value CONTRACT_ID) HOSTED_PRESET=$(omni_env_value HOSTED_PRESET) \\
  CHAIN_ADAPTER=$(omni_env_value CHAIN_ADAPTER) GITHUB_ADAPTER=$(omni_env_value GITHUB_ADAPTER) ENGINE_RUNNER=$(omni_env_value ENGINE_RUNNER) \\
  npm run worker -w @omniswarm/api
EOF
    ;;
  down) omni_compose down --remove-orphans ;;
  reset) omni_compose down --volumes --remove-orphans ;;
  *) echo "usage: local.sh up|down|reset" >&2; exit 64 ;;
esac
