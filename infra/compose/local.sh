#!/bin/bash
# Local stack with the real apps (W12-20; the lead wires it to
# `npm run stack:local` / `stack:local:down`).
#   local.sh up            build + start on http://omniswarm.localhost:<OMNI_HTTP_PORT>
#   local.sh down          stop containers, the indexer and the sandbox (home kept)
#   local.sh down --reset  down, and remove the sandbox home
#   local.sh reset         stop, remove containers, the database volume and the sandbox home
# NEAR_LOCAL=0 keeps the mock chain. Unset defaults to 1 on this path.
# check:infra does not call this script; dev.env.example stays NEAR_LOCAL=0.
# State (random secrets, self-signed cert, reports dir) lives in
# infra/compose/.local/ (gitignored). The worker is not containerized.
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$INFRA/.." && pwd)"
STATE="$INFRA/compose/.local"
env_file="$(bash "$INFRA/compose/dev-env.sh" "$STATE")"
export OMNI_PROJECT=omniswarm-local OMNI_PROFILE=dev OMNI_ENV_FILE="$env_file" OMNI_SRV="$STATE/srv"
# shellcheck source=infra/deploy/lib.sh
. "$INFRA/deploy/lib.sh"

# These names exist only in dev.env.example. The env contract requires each one
# to be read here. The shell variable NEAR_LOCAL, not the example's 0, picks the mode.
omni_env_value NEAR_LOCAL >/dev/null
omni_env_value NEAR_NETWORK >/dev/null
omni_env_value NEXT_PUBLIC_WALLET >/dev/null
omni_env_value GUARD_ACCOUNT_AGE_URL >/dev/null
omni_env_value DEV_WALLET_URL >/dev/null
omni_env_value ENGINE_RUNNER >/dev/null || true
if [ -z "${NEAR_LOCAL:-}" ]; then
  NEAR_LOCAL=1
fi
case "$NEAR_LOCAL" in
  0|1) ;;
  *) printf 'NEAR_LOCAL must be 0 or 1\n' >&2; exit 64 ;;
esac
export NEAR_LOCAL

SANDBOX_PID="$ROOT/infra/compose/.local/near/near-sandbox.pid"
INDEXER_PID="$STATE/indexer.pid"
INDEXER_LOG="$STATE/indexer.log"
NEAR_OVERLAY="$STATE/near.yml"

near_on() { [ "$NEAR_LOCAL" = 1 ]; }

near_local_cmd() {
  ( cd "$ROOT" && npm run near:local -- "$@" )
}

on_up_err() {
  status="$1"
  trap - ERR
  printf 'stack up failed\n' >&2
  stop_near keep || true
  exit "$status"
}

port_answers() {
  curl -s -o /dev/null --max-time 1 "$1"
}

# Shell exports override the env file for compose interpolation. The overlay
# passes NEXT_PUBLIC_WALLET, which compose.yml does not interpolate (it is not
# in stack.env.example). Containers get the host gateway RPC; workers do not.
# The API image runs as uid 1000 and cannot read a mode-600 host key.
# Copy bob's key into the secrets dir and run the API as the user who owns it.
install_sandbox_payer() {
  local src dest
  src="$ROOT/infra/compose/.local/near/keys/bob.json"
  dest="$STATE/secrets/bob.json"
  if [ ! -f "$src" ]; then
    printf 'sandbox payer key is missing\n' >&2
    return 1
  fi
  mkdir -p "$STATE/secrets"
  install -m 600 "$src" "$dest"
}

apply_near_env() {
  near_on || return 0
  local uid gid
  uid="$(id -u)"
  gid="$(id -g)"
  install_sandbox_payer
  export NETWORK=sandbox NEAR_NETWORK=sandbox CHAIN_ADAPTER=near
  export CONTRACT_ID=registry.test.near INTAKE_RECIPIENT=treasury.test.near
  export RPC_URLS=http://host.docker.internal:3030
  export NEXT_PUBLIC_NETWORK=sandbox
  export NEXT_PUBLIC_CONTRACT_ID=registry.test.near
  export NEXT_PUBLIC_INTAKE_RECIPIENT=treasury.test.near
  export NEXT_PUBLIC_RPC_URL=http://127.0.0.1:3030
  export NEXT_PUBLIC_EXPLORER_URL=http://127.0.0.1:3031
  cat > "$NEAR_OVERLAY" <<EOF
services:
  web:
    build:
      args:
        NEXT_PUBLIC_WALLET: local
        NEXT_PUBLIC_NETWORK: sandbox
        NEXT_PUBLIC_CONTRACT_ID: registry.test.near
        NEXT_PUBLIC_INTAKE_RECIPIENT: treasury.test.near
        NEXT_PUBLIC_RPC_URL: http://127.0.0.1:3030
        NEXT_PUBLIC_EXPLORER_URL: http://127.0.0.1:3031
  api:
    user: "${uid}:${gid}"
    environment:
      NEAR_NETWORK: sandbox
      NETWORK: sandbox
      CONTRACT_ID: registry.test.near
      INTAKE_RECIPIENT: treasury.test.near
      RPC_URLS: http://host.docker.internal:3030
      CHAIN_ADAPTER: near
      GUARD_ACCOUNT_AGE_URL: http://host.docker.internal:3031
      SANDBOX_PAYER_KEY_FILE: /secrets/bob.json
EOF
  if [ -n "${OMNI_COMPOSE_EXTRA:-}" ]; then
    OMNI_COMPOSE_EXTRA="$OMNI_COMPOSE_EXTRA $NEAR_OVERLAY"
  else
    OMNI_COMPOSE_EXTRA="$NEAR_OVERLAY"
  fi
  export OMNI_COMPOSE_EXTRA
}

start_indexer() {
  near_on || return 0
  local pid i
  mkdir -p "$STATE"
  if [ -f "$INDEXER_PID" ]; then
    pid="$(tr -d '[:space:]' < "$INDEXER_PID")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      printf 'indexer: already up (pid %s)\n' "$pid"
      return 0
    fi
    rm -f "$INDEXER_PID"
  fi
  if port_answers "http://127.0.0.1:3031/"; then
    printf 'indexer: port 3031 is already in use\n' >&2
    return 1
  fi
  nohup node "$INFRA/near-local/indexer.mjs" >"$INDEXER_LOG" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" > "$INDEXER_PID"
  i=0
  while [ "$i" -lt 50 ]; do
    if port_answers "http://127.0.0.1:3031/"; then
      printf 'indexer: listening on 0.0.0.0:3031 (account age: http://host.docker.internal:3031)\n'
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      printf 'indexer: exited before it listened\n' >&2
      tail -n 30 "$INDEXER_LOG" >&2 || true
      return 1
    fi
    i=$((i + 1))
    sleep 0.1
  done
  printf 'indexer: timed out waiting for port 3031\n' >&2
  tail -n 30 "$INDEXER_LOG" >&2 || true
  return 1
}

stop_indexer() {
  local pid i
  [ -f "$INDEXER_PID" ] || return 0
  pid="$(tr -d '[:space:]' < "$INDEXER_PID")"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    i=0
    while [ "$i" -lt 30 ] && kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1))
      sleep 0.1
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$INDEXER_PID"
  printf 'indexer: down\n'
}

# keep: near:local down (home stays). reset: near:local reset (home removed).
# A foreign process on 3030 is left alone when this stack has no pid file.
stop_sandbox() {
  local mode="$1"
  if [ "$mode" = keep ] && [ ! -f "$SANDBOX_PID" ] && ! near_on; then
    return 0
  fi
  if [ ! -f "$SANDBOX_PID" ] && port_answers "http://127.0.0.1:3030/status"; then
    printf 'near-sandbox: port 3030 is in use and this stack has no pid file; not stopping it\n' >&2
    [ "$mode" = keep ] || exit 1
    return 0
  fi
  if [ "$mode" = reset ]; then
    near_local_cmd reset
  else
    near_local_cmd down
  fi
}

start_near() {
  near_on || return 0
  near_local_cmd up
  near_local_cmd seed
  start_indexer
}

stop_near() {
  stop_indexer || true
  stop_sandbox "$1" || true
}

usage() { printf 'usage: local.sh up|down [--reset]|reset\n' >&2; }

case "${1:-}" in
  up)
    # A failure inside omni_compose does not fire ERR unless errtrace is on.
    start_near || on_up_err $?
    apply_near_env
    omni_compose up -d --build --wait || on_up_err $?
    bash "$INFRA/compose/workers.sh" start "$env_file" "$STATE"
    port="$(omni_env_value OMNI_HTTP_PORT)"
    if near_on; then
      near_line="near:    sandbox http://127.0.0.1:3030  indexer http://127.0.0.1:3031  contract registry.test.near"
    else
      near_line="near:    mock chain (NEAR_LOCAL=0)"
    fi
    cat <<EOF
stack up: http://$(omni_env_value OMNI_DOMAIN):$port/
account: http://$(omni_env_value OMNI_DOMAIN):$port/dashboard  (Google, X, or a NEAR wallet)
admin:   http://$(omni_env_value OMNI_DOMAIN):$port/admin      (nginx asks: user admin, password is ADMIN_BASIC_PASSWORD in $env_file)
$near_line
local:   ./bin/audit local [--repo <dir> | --github owner/repo]
workers: two host workers are running (one job each). Logs: $STATE/workers/
EOF
    ;;
  down)
    case "${2:-}" in
      '') sandbox_mode=keep ;;
      --reset) sandbox_mode=reset ;;
      *) usage; exit 64 ;;
    esac
    [ "$#" -le 2 ] || { usage; exit 64; }
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --remove-orphans
    stop_indexer || true
    stop_sandbox "$sandbox_mode"
    ;;
  reset)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    bash "$INFRA/compose/workers.sh" stop "$STATE" || true
    omni_compose down --volumes --remove-orphans
    stop_indexer || true
    stop_sandbox reset
    ;;
  *) usage; exit 64 ;;
esac
