#!/bin/bash
# Drives the real host-timer scripts (health.sh, prune.sh, log-hygiene.sh) against
# stub curl/docker/systemctl/df/journalctl on PATH and a scratch /srv tree, and
# checks what they decide: repair after N failures, one alert per transition,
# heartbeat only when green, retention dates, and log hits reported by name only.
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/omniswarm-timers.XXXXXX")"
trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL timers: $*" >&2; exit 1; }
S="$T/stub"; mkdir -p "$S/http" "$T/srv/releases" "$T/state" "$T/etc"
calls="$S/calls"; : > "$calls"

# --- stubs ------------------------------------------------------------------
cat > "$S/curl" <<'EOF'
#!/bin/bash
S="$(dirname "$0")"
for a in "$@"; do
  if [ "$a" = -K ]; then read -r line; url="${line#url = \"}"; echo "fetch ${url%\"} $*" >> "$S/calls"; exit 0; fi
done
url="${*: -1}"; f="$S/http/$(printf '%s' "${url#https://*/}" | tr '/' '_')"
if [ -f "$f" ]; then tail -n +2 "$f"; printf '\n%s' "$(head -n 1 "$f")"; else printf 'connection refused\n000'; fi
EOF
cat > "$S/systemctl" <<'EOF'
#!/bin/bash
S="$(dirname "$0")"
case "$1" in
  is-active) [ ! -e "$S/down-${*: -1}" ] ;;
  is-enabled) exit 0 ;;
  list-units) echo 'omniswarm-worker@1.service loaded active running worker' ;;
  *) echo "systemctl $*" >> "$S/calls" ;;
esac
EOF
cat > "$S/docker" <<'EOF'
#!/bin/bash
S="$(dirname "$0")"
case "$1 $2" in
  "info "*) echo /var/lib/docker ;;
  "ps "*) if [[ " $* " == *" -a "* ]]; then echo api-1; elif [[ "$*" == *health=unhealthy* ]]; then cat "$S/unhealthy" 2>/dev/null || true; fi ;;
  "logs "*) cat "$S/logs-${*: -1}" 2>/dev/null || true ;;
  "image ls") cat "$S/images" 2>/dev/null || true ;;
  *) echo "docker $*" >> "$S/calls" ;;
esac
EOF
# shellcheck disable=SC2016 # the stubs' own $0 and $*
printf '#!/bin/bash\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/x 100 1 1 $(cat "$(dirname "$0")/disk" 2>/dev/null || echo 10)%% ${*: -1}"\n' > "$S/df"
# shellcheck disable=SC2016
printf '#!/bin/bash\ncat "$(dirname "$0")/journal" 2>/dev/null || true\n' > "$S/journalctl"
chmod +x "$S"/*
export PATH="$S:$PATH"
printf 'OMNI_DOMAIN=check.example\nOMNI_REPORTS_DOMAIN=reports.check.example\n' > "$T/stack.env"
export OMNI_ENV_FILE="$T/stack.env" OMNI_SRV="$T/srv" OMNI_HEALTH_STATE="$T/state" OMNI_RELEASE=check
export OMNI_ALERT_WEBHOOK_URL=https://alert.invalid/hook-path-is-a-secret OMNI_HEARTBEAT_URL=https://beat.invalid/ping

# --- health.sh ----------------------------------------------------------------
green() {
  printf '200\n{"ok":true,"network":"testnet","queueDepth":0,"workers":1}\n' > "$S/http/api_health"
  printf '200\n{"ok":true,"db":true,"queue":true,"migrations":true}\n' > "$S/http/api_ready"
  rm -f "$S/down-omniswarm-workers.target"; echo 10 > "$S/disk"
}
health() { : > "$calls"; out="$(bash "$INFRA/deploy/health.sh" 2>&1)" && rc=0 || rc=$?; }
count() { grep -c -- "$1" "$calls" || true; }

green; health
[ "$rc" = 0 ] && [ "$(count 'fetch https://beat.invalid/ping')" = 1 ] || { echo "$out"; fail "green run: rc=$rc or no heartbeat"; }
[ "$(count alert.invalid)" = 0 ] || fail "green run alerted"

printf '502\nbad gateway\n' > "$S/http/api_health"
health
[ "$rc" = 1 ] && [ "$(count 'compose')" = 0 ] && [ "$(count alert.invalid)" = 0 ] || fail "1st failure repaired or alerted (rc=$rc)"
[ "$(count beat.invalid)" = 0 ] || fail "heartbeat sent while failing"
echo c1 > "$S/unhealthy"
health
[ "$(count 'docker restart c1')" = 1 ] || fail "2nd failure did not restart the unhealthy container"
[ "$(count 'compose .* up -d --no-deps --no-recreate api web nginx')" = 1 ] || fail "2nd failure did not start missing containers"
[ "$(count 'fetch https://alert.invalid/hook-path-is-a-secret.*api-health')" = 1 ] || fail "2nd failure: want one down alert for api-health"
health
[ "$(count alert.invalid)" = 0 ] && [ "$(count compose)" = 0 ] || fail "3rd failure alerted or repaired again"
printf '%s' "$out" | grep -q 'hook-path-is-a-secret' && fail "health.sh printed the webhook URL"
green; rm -f "$S/unhealthy"; health
[ "$rc" = 0 ] && [ "$(count 'alert.invalid.*recovered')" = 1 ] && [ "$(count beat.invalid)" = 1 ] || fail "recovery: want one recovered alert and a heartbeat"

touch "$S/down-omniswarm-workers.target"; health; health
[ "$(count "systemctl reset-failed omniswarm-worker@\*.service")" = 1 ] && [ "$(count 'systemctl start omniswarm-workers.target')" = 1 ] \
  || fail "workers down twice: want reset-failed + start"
green; printf '200\n{"ok":true,"workers":0}\n' > "$S/http/api_health"; health; health
printf '%s' "$out" | grep -q 'FAIL workers: /api/health counts no live worker' || fail "workers:0 in /api/health not reported"
green; health; echo 85 > "$S/disk"; health; health
[ "$(count 'alert.invalid.*disk')" = 1 ] && [ "$(count compose)" = 0 ] || fail "disk over 80%: want one alert and no repair"
echo "  health.sh: repair + alert on the 2nd failure only, one recovery alert, heartbeat only when green, workers and disk"

# --- prune.sh -----------------------------------------------------------------
runs="$T/srv/work/runs"
mkdir -p "$runs/old-req/1" "$runs/new-req/1" "$runs/mixed-req/1" "$T/srv/work/tmp/stale" "$T/srv/work/tmp/fresh" "$T/srv/releases/check-1"
for d in old-req mixed-req; do touch "$runs/$d/1/worker.log"; done
touch "$runs/new-req/1/worker.log"
touch -t 202501010000 "$runs/old-req/1/worker.log" "$runs/old-req/1" "$runs/old-req" "$runs/mixed-req/1" "$runs/mixed-req" "$T/srv/work/tmp/stale"
printf 'check-1\ngone-1\n<none>\n' > "$S/images"
printf 'RUNS_ROOT=%s\n' "$runs" > "$T/worker.env"
export OMNI_WORKER_ENV_FILE="$T/worker.env"
: > "$calls"
OMNI_PRUNE_NOT_BEFORE=2999-01-01 bash "$INFRA/deploy/prune.sh" 2>/dev/null
[ -d "$runs/old-req" ] || fail "prune removed a run before OMNI_PRUNE_NOT_BEFORE"
[ ! -e "$T/srv/work/tmp/stale" ] && [ -d "$T/srv/work/tmp/fresh" ] || fail "prune: stale staging dir kept or fresh one removed"
[ "$(count 'docker image rm omniswarm/api:gone-1')" = 1 ] && [ "$(count 'image rm omniswarm/api:check-1')" = 0 ] || fail "prune: images of live releases removed, or dead ones kept"
OMNI_PRUNE_NOT_BEFORE=2000-01-01 bash "$INFRA/deploy/prune.sh" 2>/dev/null
[ ! -e "$runs/old-req" ] && [ -d "$runs/new-req" ] && [ -d "$runs/mixed-req" ] || fail "prune: wrong runs removed after the date"
echo "  prune.sh: runs kept until OMNI_PRUNE_NOT_BEFORE, then only dirs with nothing newer than 30 days; stale staging; dead release images"

# --- log-hygiene.sh -------------------------------------------------------------
gh="ghp_$(printf 'Z%.0s' $(seq 1 36))"
nearkey="ed25519:$(printf '3%.0s' $(seq 1 88))"
printf 'SESSION_SECRET=planted-session-secret-0123456789\nADMIN_TOKEN=short\nNETWORK=testnet\n' > "$T/etc/stack.env"
printf 'RUNS_ROOT=%s\n' "$runs" > "$T/etc/worker.env"
printf '{"account_id":"op.testnet","public_key":"ed25519:pub","private_key":"%s"}\n' "$nearkey" > "$T/etc/operator-key.json"
export OMNI_ETC="$T/etc"
echo 'worker ready' > "$S/journal"; echo 'GET /api/health 200' > "$S/logs-api-1"
: > "$runs/new-req/1/worker.log"
out="$(bash "$INFRA/deploy/log-hygiene.sh" 2>&1)" || fail "clean logs reported a hit: $out"
printf '%s' "$out" | grep -q '^clean: ' || fail "no clean line: $out"
echo 'token planted-session-secret-0123456789 leaked' >> "$S/journal"
echo "clone with $gh" >> "$runs/new-req/1/worker.log"
echo "signer $nearkey" >> "$S/logs-api-1"
: > "$calls"
if out="$(bash "$INFRA/deploy/log-hygiene.sh" 2>&1)"; then fail "planted secrets were not found"; fi
for want in 'HIT value of SESSION_SECRET in journal' 'HIT github-token in run:new-req_1_worker.log' 'HIT value of OPERATOR_KEY in docker:api-1' 'HIT near-secret-key in docker:api-1'; do
  printf '%s' "$out" | grep -qF "$want" || fail "log-hygiene lacks '$want': $out"
done
for leak in planted-session-secret "$gh" "$nearkey"; do
  printf '%s' "$out" | grep -qF -- "$leak" && fail "log-hygiene printed a secret it found"
done
[ "$(count 'alert.invalid.*log-hygiene')" = 1 ] || fail "log-hygiene hit sent no alert"
echo "  log-hygiene.sh: exact secret values and key shapes found in journal, container and engine logs; names only in output; one alert"
