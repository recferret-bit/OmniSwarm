#!/bin/bash
# W15 wave check. The near-sandbox binary is downloaded once into
# infra/compose/.local/near/bin/ and reused. When DATABASE_URL is unset, a
# throwaway Postgres listens on 127.0.0.1 and is removed on the way out.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PG_IMAGE="postgres:16.15-alpine3.24@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab"

indexer_pid=""
pg_name=""
stop_indexer() {
  if [ -n "$indexer_pid" ]; then
    kill "$indexer_pid" 2>/dev/null || true
    wait "$indexer_pid" 2>/dev/null || true
    indexer_pid=""
  fi
}
stop_pg() {
  if [ -n "$pg_name" ]; then
    docker rm -f "$pg_name" >/dev/null 2>&1 || true
    pg_name=""
  fi
}
cleanup() {
  stop_indexer
  stop_pg
  npm run near:local -- down || true
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  pg_port=55432
  while lsof -nP -iTCP:"$pg_port" -sTCP:LISTEN >/dev/null 2>&1; do
    pg_port=$((pg_port + 1))
  done
  pg_name="omniswarm-w15-pg-$$"
  docker rm -f "$pg_name" >/dev/null 2>&1 || true
  docker run -d --name "$pg_name" \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p "127.0.0.1:${pg_port}:5432" \
    "$PG_IMAGE" >/dev/null
  ready_pg=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if docker exec "$pg_name" pg_isready -U postgres >/dev/null 2>&1; then
      ready_pg=1
      break
    fi
    sleep 0.5
  done
  [ "$ready_pg" = 1 ] || { echo "throwaway postgres did not become ready" >&2; exit 1; }
  export DATABASE_URL="postgres://postgres@127.0.0.1:${pg_port}/postgres"
fi

node --test infra/near-local/indexer.test.mjs infra/near-local/ops.test.mjs

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

( cd apps/api && node --test --test-concurrency=1 test/parity/chain-parity.test.ts )
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
  echo "headless flow did not run. The test log above is the skip reason." >&2
  rm -f "$flow_log"
  exit 1
fi
rm -f "$flow_log"
node packages/guard/demo/attack/run.mjs
node packages/guard/demo/attack/run.mjs --sandbox
