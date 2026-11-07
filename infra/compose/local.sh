#!/bin/bash
# Local stack with the real apps (W12-20; the lead wires it to
# `npm run stack:local` / `stack:local:down`).
#   local.sh up     build + start on http://omniswarm.localhost:<OMNI_HTTP_PORT>
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
    # dev.env.example declares ENGINE_RUNNER. The host workers run the cli engine.
    omni_env_value ENGINE_RUNNER >/dev/null || true
    bash "$INFRA/compose/workers.sh" start "$env_file" "$STATE"
    port="$(omni_env_value OMNI_HTTP_PORT)"
    cat <<EOF
stack up: http://$(omni_env_value OMNI_DOMAIN):$port/
account: http://$(omni_env_value OMNI_DOMAIN):$port/dashboard  (operator / operator)
admin:   http://$(omni_env_value OMNI_DOMAIN):$port/admin      (nginx asks: user admin, password is ADMIN_BASIC_PASSWORD in $env_file)
local:   ./bin/audit local [--repo <dir> | --github owner/repo]
workers: two host workers are running (one job each). Logs: $STATE/workers/
EOF
    ;;
  down)
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --remove-orphans
    ;;
  reset)
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --volumes --remove-orphans
    ;;
  *) echo "usage: local.sh up|down|reset" >&2; exit 64 ;;
esac
