#!/bin/bash
# W15 wave check. The near-sandbox binary is downloaded once into
# infra/compose/.local/near/bin/ and reused. Needs Postgres only if a later
# step starts the API; parity, the headless flow and the attack demo do not.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

indexer_pid=""
stop_indexer() {
  if [ -n "$indexer_pid" ]; then
    kill "$indexer_pid" 2>/dev/null || true
    wait "$indexer_pid" 2>/dev/null || true
    indexer_pid=""
  fi
}
cleanup() {
  stop_indexer
  npm run near:local -- down || true
}
trap cleanup EXIT

npm run near:local -- up
npm run near:local -- seed

node infra/near-local/indexer.mjs &
indexer_pid=$!
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf -m 2 http://127.0.0.1:3031/v1/account/alice.test.near >/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done
[ "$ready" = 1 ] || { echo "indexer did not answer on 3031" >&2; exit 1; }

npm run test:intake -- parity
flow_log="$(mktemp)"
set +e
node --test tests/e2e/near-local/flow.test.mjs | tee "$flow_log"
flow_status=${PIPESTATUS[0]}
set -e
if [ "$flow_status" -ne 0 ]; then
  rm -f "$flow_log"
  exit "$flow_status"
fi
if grep -q 'skipped' "$flow_log" && grep -q 'pass 0' "$flow_log"; then
  echo "headless flow did not run. Set DATABASE_URL to a Postgres you can create a database on." >&2
  rm -f "$flow_log"
  exit 1
fi
rm -f "$flow_log"
node packages/guard/demo/attack/run.mjs
node packages/guard/demo/attack/run.mjs --sandbox
