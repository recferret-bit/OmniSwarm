#!/bin/bash
# Local stack with the real apps (W12-20; the lead wires it to
# `npm run stack:local` / `stack:local:down`).
#   local.sh up            build + start on http://omniswarm.localhost:<OMNI_HTTP_PORT>
#   local.sh down          stop the workers and the containers (data kept)
#   local.sh reset         stop, remove containers and the database volume
# OMNI_LIVE=1 runs real models in the host workers; unset keeps the mock engine.
# check:infra does not call this script.
# State (random secrets, self-signed cert, reports dir) lives in
# infra/compose/.local/ (gitignored). The worker is not containerized.
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$INFRA/compose/.local"
env_file="$(bash "$INFRA/compose/dev-env.sh" "$STATE")"
export OMNI_PROJECT=omniswarm-local OMNI_PROFILE=dev OMNI_ENV_FILE="$env_file" OMNI_SRV="$STATE/srv"
# shellcheck source=infra/deploy/lib.sh
. "$INFRA/deploy/lib.sh"

# These names exist only in dev.env.example. The env contract requires each one
# to be read here.
omni_env_value ENGINE_RUNNER >/dev/null || true

# Shell exports override the env file for compose interpolation. Reviews run on
# the engine the workers pick: the mock engine by default, the real engine with
# OMNI_LIVE=1 (see workers.sh). The API image runs as uid 1000 and the host
# workers as the invoking user; both share $STATE/secrets and $STATE/runs.

usage() { printf 'usage: local.sh up|down|reset\n' >&2; }

case "${1:-}" in
  up)
    omni_compose up -d --build --wait || { printf 'stack up failed\n' >&2; exit 1; }
    bash "$INFRA/compose/workers.sh" start "$env_file" "$STATE"
    port="$(omni_env_value OMNI_HTTP_PORT)"
    if [ "${OMNI_LIVE:-0}" = 1 ]; then
      engine_line="engine:  real models (OMNI_LIVE=1)"
    else
      engine_line="engine:  mock (recorded report, no model call); OMNI_LIVE=1 runs real models"
    fi
    cat <<EOF
stack up: http://$(omni_env_value OMNI_DOMAIN):$port/
account: http://$(omni_env_value OMNI_DOMAIN):$port/dashboard  (Google, X, or a NEAR wallet)
admin:   http://$(omni_env_value OMNI_DOMAIN):$port/admin      (nginx asks: user admin, password is ADMIN_BASIC_PASSWORD in $env_file)
$engine_line
local:   ./bin/audit local [--repo <dir> | --github owner/repo]
workers: two host workers are running (one job each). Logs: $STATE/workers/
EOF
    ;;
  down)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --remove-orphans
    ;;
  reset)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --volumes --remove-orphans
    ;;
  *) usage; exit 64 ;;
esac
