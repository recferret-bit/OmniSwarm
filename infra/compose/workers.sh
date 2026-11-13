#!/bin/bash
# Two host review workers for the local stack. Each takes one job. Together
# they run two reviews at once. They use the host Docker daemon for the
# sandbox, so they are not API containers and they do not receive the socket
# inside a container.
#   workers.sh start <env-file> <state-dir>
#   workers.sh stop  <state-dir>
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$INFRA/.." && pwd)"
cmd="${1:?usage: workers.sh start <env-file> <state-dir> | stop <state-dir>}"

stop_workers() {
  local state="$1" pid
  if [ -d "$state/workers" ]; then
    for pid in "$state"/workers/*.pid; do
      [ -f "$pid" ] || continue
      kill "$(cat "$pid")" 2>/dev/null || true
      rm -f "$pid"
    done
  fi
}

case "$cmd" in
  stop) stop_workers "${2:?state dir}"; exit 0 ;;
  start) ;;
  *) echo "usage: workers.sh start <env-file> <state-dir> | stop <state-dir>" >&2; exit 64 ;;
esac

env_file="${2:?env file}"
state="${3:?state dir}"
# An absent key is an empty value (grep exits 1 on no match, which set -e + pipefail would turn into a silent exit).
value() { { grep -E "^$1=" "$env_file" || true; } | tail -n 1 | cut -d= -f2-; }
mkdir -p "$state/workers" "$state/runs" "$state/secrets"
stop_workers "$state"
for n in 1 2; do
  (
    database_url="postgres://omniswarm:$(value POSTGRES_PASSWORD)@127.0.0.1:$(value OMNI_PG_PORT)/omniswarm"
    session_secret="$(value SESSION_SECRET)"
    reports_base_url="http://$(value OMNI_REPORTS_DOMAIN):$(value OMNI_HTTP_PORT)"
    export NODE_ENV=development WORKER_CONCURRENCY=1
    # Dashboard jobs are account-nearai and carry their own run config. Without a root
    # omniswarm.config.json the example config is used.
    if [ -z "${ENGINE_CONFIG:-}" ] && [ ! -f "$ROOT/omniswarm.config.json" ]; then
      export ENGINE_CONFIG="$ROOT/engine/omniswarm.config.example.json"
    fi
    export WORKER_ID="worker-$n" ENGINE_ROOT="$ROOT" DATABASE_URL="$database_url"
    # Accounts' own NEAR AI keys are sealed under ACCOUNT_KEYS_SECRET when the stack env sets it
    # (the api container gets the same value), else under SESSION_SECRET outside production.
    export SESSION_SECRET="$session_secret"
    keys_secret="$(value ACCOUNT_KEYS_SECRET)"
    if [ -n "$keys_secret" ]; then export ACCOUNT_KEYS_SECRET="$keys_secret"; else unset ACCOUNT_KEYS_SECRET; fi
    export REPORTS_ROOT="$state/reports" REPORTS_BASE_URL="$reports_base_url" RUNS_ROOT="$state/runs"
    export GITHUB_ADAPTER=live
    # OMNI_LIVE=1 runs the real engine (CLI panel and the account's own NEAR AI Cloud key).
    # Otherwise the mock engine returns a recorded report with no model call, so the
    # home-page review finishes without keys. Set in the shell that runs `npm run stack:local`.
    if [ "${OMNI_LIVE:-0}" = 1 ]; then
      export ENGINE_RUNNER=cli OMNI_LIVE=1
    else
      export ENGINE_RUNNER=mock
      unset OMNI_LIVE
    fi
    cd "$ROOT"
    exec npm run worker -w @omniswarm/api
  ) > "$state/workers/worker-$n.log" 2>&1 &
  echo $! > "$state/workers/worker-$n.pid"
done
echo "workers: worker-1 and worker-2 (one job each)"
