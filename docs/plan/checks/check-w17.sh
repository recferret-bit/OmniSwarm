#!/bin/bash
# W17 wave check. The contract sandbox suite downloads near-sandbox on first run
# (or uses NEAR_SANDBOX_BIN_PATH). `near:local verify` runs only when the local
# node is already up; it does not start one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

npm run check:w10
npm run test:contract:sandbox
npm test -w packages/guard
node packages/guard/demo/attack/run.mjs
node packages/guard/demo/attack/run.mjs --scenario metadata-elsewhere
node --test infra/near-local/verify.test.mjs

status="$(npm run near:local -- status || true)"
if printf '%s\n' "$status" | grep -q 'near-sandbox: up'; then
  npm run near:local -- verify registry
else
  printf 'check:w17: near-sandbox is down; skipped near:local verify\n'
fi
