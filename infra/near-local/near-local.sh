#!/bin/bash
# Local near-sandbox for the stack (W15-02).
# RPC is 0.0.0.0:3030, not 127.0.0.1: a Linux container cannot reach a
# loopback bind (docs/spec/LOCAL_NEAR.md). P2P stays on 127.0.0.1.
# Host tools use http://127.0.0.1:3030. The binary cache and the home
# directory live under infra/compose/.local/near/ (gitignored).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NEAR_ROOT="$ROOT/infra/compose/.local/near"
NEAR_BIN="$NEAR_ROOT/bin/near-sandbox"
NEAR_HOME="$NEAR_ROOT/home"
NEAR_PID="$NEAR_ROOT/near-sandbox.pid"
NEAR_LOG="$NEAR_ROOT/near-sandbox.log"

NEAR_SANDBOX_VERSION=2.14.0
# NEAR_LOCAL_RPC_PORT / NEAR_LOCAL_NET_PORT let two local nodes run at once.
RPC_PORT="${NEAR_LOCAL_RPC_PORT:-3030}"
NETWORK_PORT="${NEAR_LOCAL_NET_PORT:-24567}"
RPC_ADDR="0.0.0.0:${RPC_PORT}"
NETWORK_ADDR="127.0.0.1:${NETWORK_PORT}"
RPC_URL="http://127.0.0.1:${RPC_PORT}/status"

subs=(up down status reset seed view call redeploy)

usage() {
  printf 'usage: near:local <subcommand>\n'
  printf 'subcommands: %s\n' "${subs[*]}"
}

sandbox_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}-${arch}" in
    Darwin-arm64|Darwin-aarch64) printf '%s\n' 'Darwin-arm64' ;;
    Linux-x86_64) printf '%s\n' 'Linux-x86_64' ;;
    Linux-aarch64|Linux-arm64) printf '%s\n' 'Linux-aarch64' ;;
    *)
      printf 'near-sandbox: unsupported platform %s-%s\n' "$os" "$arch" >&2
      exit 1
      ;;
  esac
}

clear_quarantine() {
  local bin="$1"
  if [ "$(uname -s)" != Darwin ]; then
    return 0
  fi
  if ! command -v xattr >/dev/null 2>&1; then
    return 0
  fi
  xattr -d com.apple.quarantine "$bin" 2>/dev/null || true
}

fetch_sandbox() {
  local platform url tmp archive extracted
  platform="$(sandbox_platform)"
  url="https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform}/${NEAR_SANDBOX_VERSION}/near-sandbox.tar.gz"
  printf 'near-sandbox: downloading %s\n' "$url" >&2
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/near-sandbox.XXXXXX")"
  archive="$tmp/near-sandbox.tar.gz"
  if ! curl -fsSL -o "$archive" "$url"; then
    rm -rf "$tmp"
    printf 'near-sandbox: download failed: %s\n' "$url" >&2
    exit 1
  fi
  if ! tar -xzf "$archive" -C "$tmp"; then
    rm -rf "$tmp"
    printf 'near-sandbox: extract failed: %s\n' "$archive" >&2
    exit 1
  fi
  extracted="$tmp/${platform}/near-sandbox"
  if [ ! -s "$extracted" ]; then
    rm -rf "$tmp"
    printf 'near-sandbox: archive has no %s/near-sandbox\n' "$platform" >&2
    exit 1
  fi
  mkdir -p "$NEAR_ROOT/bin"
  chmod 755 "$extracted"
  cp "$extracted" "$NEAR_BIN.new"
  chmod 755 "$NEAR_BIN.new"
  mv -f "$NEAR_BIN.new" "$NEAR_BIN"
  rm -rf "$tmp"
  clear_quarantine "$NEAR_BIN"
  printf 'near-sandbox: cached %s\n' "$NEAR_BIN" >&2
}

# Prints the executable path on stdout. Status lines go to stderr so a
# command substitution does not swallow them. An existing cache file, or
# NEAR_SANDBOX_BIN_PATH, skips the download.
resolve_bin() {
  if [ -n "${NEAR_SANDBOX_BIN_PATH:-}" ]; then
    if [ ! -f "$NEAR_SANDBOX_BIN_PATH" ] || [ ! -x "$NEAR_SANDBOX_BIN_PATH" ]; then
      printf 'near-sandbox: NEAR_SANDBOX_BIN_PATH is not an executable file: %s\n' "$NEAR_SANDBOX_BIN_PATH" >&2
      exit 1
    fi
    clear_quarantine "$NEAR_SANDBOX_BIN_PATH"
    printf 'near-sandbox: using NEAR_SANDBOX_BIN_PATH %s\n' "$NEAR_SANDBOX_BIN_PATH" >&2
    printf '%s\n' "$NEAR_SANDBOX_BIN_PATH"
    return 0
  fi
  if [ -f "$NEAR_BIN" ]; then
    if [ ! -x "$NEAR_BIN" ]; then
      chmod 755 "$NEAR_BIN"
    fi
    clear_quarantine "$NEAR_BIN"
    printf 'near-sandbox: reusing cached binary %s\n' "$NEAR_BIN" >&2
    printf '%s\n' "$NEAR_BIN"
    return 0
  fi
  fetch_sandbox
  printf '%s\n' "$NEAR_BIN"
}

read_pid() {
  if [ ! -f "$NEAR_PID" ]; then
    return 1
  fi
  tr -d '[:space:]' < "$NEAR_PID"
}

pid_alive() {
  local pid="$1"
  case "$pid" in
    ''|*[!0-9]*|0) return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null
}

pid_is_sandbox() {
  local pid="$1"
  local cmd
  pid_alive "$pid" || return 1
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  case "$cmd" in
    *near-sandbox*) return 0 ;;
  esac
  return 1
}

tcp_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .; then
      return 0
    fi
    return 1
  fi
  if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

extract_chain_id() {
  tr -d '[:space:]' | awk '
    BEGIN { key = "\"chain_id\":\"" }
    {
      i = index($0, key)
      if (i == 0) exit 0
      rest = substr($0, i + length(key))
      q = index(rest, "\"")
      if (q == 0) exit 0
      print substr(rest, 1, q - 1)
      exit 0
    }
  '
}

file_chain_id() {
  extract_chain_id < "$1"
}

show_log_tail() {
  if [ -f "$NEAR_LOG" ]; then
    printf 'near-sandbox: log %s\n' "$NEAR_LOG" >&2
    tail -n 30 "$NEAR_LOG" >&2 || true
  fi
}

wait_for_status() {
  local pid="$1"
  local i body cid
  i=0
  while [ "$i" -lt 120 ]; do
    if ! pid_alive "$pid"; then
      printf 'near-sandbox: process %s exited before /status was ready\n' "$pid" >&2
      show_log_tail
      rm -f "$NEAR_PID"
      exit 1
    fi
    body="$(curl -sf --max-time 2 "$RPC_URL" 2>/dev/null || true)"
    cid="$(printf '%s' "$body" | extract_chain_id || true)"
    if [ "$cid" = sandbox ]; then
      printf 'near-sandbox: up\n'
      printf 'chain_id: sandbox\n'
      printf 'rpc: http://127.0.0.1:%s\n' "$RPC_PORT"
      return 0
    fi
    i=$((i + 1))
    sleep 0.5
  done
  printf 'near-sandbox: timed out waiting for chain_id sandbox\n' >&2
  show_log_tail
  exit 1
}

start_sandbox() {
  local bin="$1"
  local pid
  mkdir -p "$NEAR_ROOT"
  : > "$NEAR_LOG"
  # Own process group: down can signal the group, and the node keeps
  # running after this script (and npm) exits.
  set -m
  "$bin" --home "$NEAR_HOME" run \
    --rpc-addr "$RPC_ADDR" \
    --network-addr "$NETWORK_ADDR" \
    >>"$NEAR_LOG" 2>&1 < /dev/null &
  pid=$!
  disown "$pid" 2>/dev/null || true
  set +m
  printf '%s\n' "$pid" > "$NEAR_PID"
  printf 'near-sandbox: starting pid %s\n' "$pid"
}

stop_pid() {
  local pid="$1"
  local pgid i
  if ! pid_alive "$pid"; then
    return 0
  fi
  pgid="$(ps -p "$pid" -o pgid= 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi
  i=0
  while [ "$i" -lt 50 ]; do
    if ! pid_alive "$pid"; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.1
  done
  if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
    kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  else
    kill -KILL "$pid" 2>/dev/null || true
  fi
  sleep 0.2
}

wait_ports_closed() {
  local i
  i=0
  while [ "$i" -lt 50 ]; do
    if ! tcp_listening "$RPC_PORT" && ! tcp_listening "$NETWORK_PORT"; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.1
  done
  return 1
}

ensure_home() {
  local bin="$1"
  local cid
  mkdir -p "$NEAR_ROOT"
  if [ ! -f "$NEAR_HOME/genesis.json" ]; then
    mkdir -p "$NEAR_HOME"
    printf 'near-sandbox: init --fast --chain-id sandbox\n'
    if ! "$bin" --home "$NEAR_HOME" init --fast --chain-id sandbox >>"$NEAR_LOG" 2>&1; then
      printf 'near-sandbox: init failed\n' >&2
      show_log_tail
      exit 1
    fi
  fi
  cid="$(file_chain_id "$NEAR_HOME/genesis.json")"
  if [ "$cid" != sandbox ]; then
    printf 'near-sandbox: home chain_id is %s, want sandbox (near:local reset)\n' "${cid:-missing}" >&2
    exit 1
  fi
}

cmd_up() {
  local pid bin
  pid="$(read_pid || true)"
  if [ -n "$pid" ] && pid_is_sandbox "$pid"; then
    printf 'near-sandbox: already up (pid %s); not starting another process; not downloading\n' "$pid"
    wait_for_status "$pid"
    return 0
  fi
  if [ -n "$pid" ] && pid_alive "$pid"; then
    printf 'near-sandbox: pid %s is not near-sandbox; ignoring stale pid file\n' "$pid" >&2
  fi
  rm -f "$NEAR_PID"
  if tcp_listening "$RPC_PORT"; then
    printf 'near-sandbox: port %s is already in use\n' "$RPC_PORT" >&2
    exit 1
  fi
  if tcp_listening "$NETWORK_PORT"; then
    printf 'near-sandbox: port %s is already in use\n' "$NETWORK_PORT" >&2
    exit 1
  fi
  bin="$(resolve_bin)"
  ensure_home "$bin"
  start_sandbox "$bin"
  pid="$(read_pid || true)"
  wait_for_status "$pid"
}

cmd_down() {
  local pid
  pid="$(read_pid || true)"
  if [ -n "$pid" ] && pid_is_sandbox "$pid"; then
    stop_pid "$pid"
  elif [ -n "$pid" ] && pid_alive "$pid"; then
    printf 'near-sandbox: not killing pid %s; it is not near-sandbox\n' "$pid" >&2
  fi
  rm -f "$NEAR_PID"
  if ! wait_ports_closed; then
    printf 'near-sandbox: port %s or %s is still open\n' "$RPC_PORT" "$NETWORK_PORT" >&2
    exit 1
  fi
  printf 'near-sandbox: down\n'
  printf 'port %s: closed\n' "$RPC_PORT"
}

cmd_status() {
  local pid body cid
  pid="$(read_pid || true)"
  if [ -n "$pid" ] && pid_is_sandbox "$pid"; then
    body="$(curl -sf --max-time 2 "$RPC_URL" 2>/dev/null || true)"
    cid="$(printf '%s' "$body" | extract_chain_id || true)"
    if [ -n "$cid" ]; then
      printf 'near-sandbox: up\n'
      printf 'chain_id: %s\n' "$cid"
      printf 'pid: %s\n' "$pid"
      return 0
    fi
    printf 'near-sandbox: process %s is up but /status has no chain_id\n' "$pid" >&2
    exit 1
  fi
  printf 'near-sandbox: down\n'
  if [ -f "$NEAR_HOME/genesis.json" ]; then
    cid="$(file_chain_id "$NEAR_HOME/genesis.json")"
    if [ -n "$cid" ]; then
      printf 'chain_id: %s\n' "$cid"
    fi
  fi
}

cmd_reset() {
  cmd_down
  if [ -L "$NEAR_HOME" ]; then
    printf 'near-sandbox: home is a symlink; not removing %s\n' "$NEAR_HOME" >&2
    exit 1
  fi
  if [ -d "$NEAR_HOME" ]; then
    rm -rf "$NEAR_HOME"
  fi
  printf 'near-sandbox: home removed\n'
}

on_signal() {
  printf '\nnear-sandbox: interrupted\n' >&2
  cmd_down || true
  exit 130
}

# Later issues drop a file next to this script. The verb is not passed to
# seed.mjs or redeploy.mjs. view and call share ops.mjs, so the verb is
# the first argument there.
dispatch_later() {
  local sub="$1"
  local rel="$2"
  local file
  shift 2
  file="$HERE/$rel"
  if [ -f "$file" ]; then
    exec node "$file" "$@"
  fi
  printf 'near:local %s: reserved\n' "$sub"
  exit 0
}

if [ "$#" -eq 0 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

case "$1" in
  up|down|status|reset)
    if [ "$#" -ne 1 ]; then
      usage >&2
      exit 2
    fi
    ;;
esac

trap on_signal INT TERM

case "$1" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  reset) cmd_reset ;;
  seed)
    shift
    dispatch_later seed seed.mjs "$@"
    ;;
  view|call)
    sub="$1"
    shift
    # ops.mjs (W15-12) owns view and call once it exists. Until then, view is
    # lib/view.mjs so seed can show get_config.
    if [ -f "$HERE/ops.mjs" ]; then
      dispatch_later "$sub" ops.mjs "$sub" "$@"
    elif [ "$sub" = view ] && [ -f "$HERE/lib/view.mjs" ]; then
      dispatch_later "$sub" lib/view.mjs "$sub" "$@"
    else
      dispatch_later "$sub" ops.mjs "$sub" "$@"
    fi
    ;;
  redeploy)
    shift
    dispatch_later redeploy redeploy.mjs "$@"
    ;;
  *)
    printf 'near:local: unknown subcommand: %s\n' "$1" >&2
    usage >&2
    exit 2
    ;;
esac
