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
value() { grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2-; }
mkdir -p "$state/workers" "$state/runs" "$state/secrets"
stop_workers "$state"
for n in 1 2; do
  (
    database_url="postgres://omniswarm:$(value POSTGRES_PASSWORD)@127.0.0.1:$(value OMNI_PG_PORT)/omniswarm"
    session_secret="$(value SESSION_SECRET)"
    reports_base_url="http://$(value OMNI_REPORTS_DOMAIN):$(value OMNI_HTTP_PORT)"
    contract_id="$(value CONTRACT_ID)"
    network="$(value NETWORK)"
    recipient="$(value INTAKE_RECIPIENT)"
    export NODE_ENV=development HOSTED_PRESET=panel WORKER_CONCURRENCY=1
    export WORKER_ID="worker-$n" ENGINE_ROOT="$ROOT" DATABASE_URL="$database_url"
    export SESSION_SECRET="$session_secret" PROVIDER_SECRETS_FILE="$state/secrets/providers.json"
    export REPORTS_ROOT="$state/reports" REPORTS_BASE_URL="$reports_base_url" RUNS_ROOT="$state/runs"
    export GITHUB_ADAPTER=live
    # NEAR_LOCAL=1: the home-page quote is the scripted preset. The cli runner
    # refuses that preset, so the local sandbox demo uses the mock engine and
    # still attests on the sandbox registry. The host worker uses 127.0.0.1:3030
    # and the operator key. Do not pass host.docker.internal; that name is for
    # the API container only.
    if [ "${NEAR_LOCAL:-0}" = 1 ]; then
      export ENGINE_RUNNER=mock
      export NEAR_NETWORK=sandbox NETWORK=sandbox CHAIN_ADAPTER=near
      export CONTRACT_ID=registry.test.near INTAKE_RECIPIENT=treasury.test.near
      unset RPC_URLS
    else
      export ENGINE_RUNNER=cli
      unset NEAR_NETWORK RPC_URLS
      export CHAIN_ADAPTER=mock CONTRACT_ID="$contract_id" NETWORK="$network"
      export INTAKE_RECIPIENT="$recipient"
    fi
    cd "$ROOT"
    exec npm run worker -w @omniswarm/api
  ) > "$state/workers/worker-$n.log" 2>&1 &
  echo $! > "$state/workers/worker-$n.pid"
done
echo "workers: worker-1 and worker-2 (one job each)"
