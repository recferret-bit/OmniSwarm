#!/bin/bash
# Local bring-up: postgres + migrate + api x2 + web + nginx on loopback ports
# (infra/env/dev.env.example), driven by the same infra/deploy/lib.sh helpers
# the host uses, then torn down (volumes included).
#
#   CHECK_APPS=stub (default)  api/web are infra/test/stub (compose.stub.yml),
#                              so the infra is proven without other tracks' code
#   CHECK_APPS=real            builds apps/api/Dockerfile and apps/web/Dockerfile
#
# Proves: compose up with healthchecks and migrate-before-api ordering;
# infra/deploy/smoke.sh against it (plain HTTP, health, ready, web root,
# headers without HSTS, admin 403, reports CSP, 429 burst); Postgres on loopback only;
# and, with the stub: real client IP despite a forged X-Forwarded-For, SSE
# delivered unbuffered, requests spread over every replica, `--scale api=3`
# picked up without an nginx reload, a rolling restart with zero failed
# requests, backup.sh + restore.sh drill.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"
APPS="${CHECK_APPS:-stub}"

state="$CHECK_TMP/stack"
env_file="$(bash "$INFRA/compose/dev-env.sh" "$state")"
# A project name of its own, so a second gate run on this machine (another
# worktree) neither collides with nor tears down this one.
export OMNI_PROJECT="omniswarm-infra-check-$$" OMNI_PROFILE=dev OMNI_ENV_FILE="$env_file" OMNI_SRV="$state/srv"
export OMNI_RELEASE=check-1 OMNI_BACKUP_DIR="$state/backup"
[ "$APPS" = stub ] && export OMNI_COMPOSE_EXTRA="$INFRA/compose/compose.stub.yml"
# shellcheck source=infra/deploy/lib.sh
. "$INFRA/deploy/lib.sh"

env_get() { grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2-; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# The dev ports (dev.env.example) may be held by another stack or another gate
# run: move each busy one to the next free port in this run's own env file.
for name in OMNI_HTTP_PORT OMNI_PG_PORT; do
  want="$(env_get "$name")"; port="$want"
  while port_busy "$port"; do
    port=$((port + 1))
    [ "$port" -lt $((want + 50)) ] || check_fail "127.0.0.1:$want..$port are all in use; free one or change $name in infra/env/dev.env.example"
  done
  if [ "$port" != "$want" ]; then
    check_log "127.0.0.1:$want is in use; $name=$port for this run"
    sed -i.bak "s/^$name=.*/$name=$port/" "$env_file" && rm -f "$env_file.bak"
  fi
done
HTTP="$(env_get OMNI_HTTP_PORT)"; PG="$(env_get OMNI_PG_PORT)"
DOMAIN="$(env_get OMNI_DOMAIN)"; REPORTS="$(env_get OMNI_REPORTS_DOMAIN)"
APP="http://$DOMAIN:$HTTP"
curl_opts=(--silent --show-error --max-time 10
  --resolve "$DOMAIN:$HTTP:127.0.0.1" --resolve "$REPORTS:$HTTP:127.0.0.1")
get() { curl "${curl_opts[@]}" "$@"; }

teardown() {
  omni_compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
}
trap teardown EXIT
teardown

check_log "building images ($APPS apps)"
omni_compose build > "$CHECK_TMP/build.log" 2>&1 || { tail -n 40 "$CHECK_TMP/build.log"; check_fail "compose build"; }
omni_compose up -d --wait --wait-timeout 180 > "$CHECK_TMP/up.log" 2>&1 || {
  cat "$CHECK_TMP/up.log"; omni_compose ps -a; omni_compose logs --tail 30; check_fail "compose up --wait"
}
check_log "stack healthy: $(omni_compose ps --format '{{.Service}}' | sort | uniq -c | awk '{ printf "%s%sx%s", sep, $2, $1; sep = " " }')"
[ "$(omni_compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | grep -c '^migrate exited 0$')" = 1 ] \
  || check_fail "migrate did not run to completion before api"

bash "$INFRA/deploy/smoke.sh" --scheme http --resolve 127.0.0.1 --http-port "$HTTP" \
  "$DOMAIN" "$REPORTS" | sed 's/^/    /'

case "$(omni_compose port postgres 5432)" in
  "127.0.0.1:$PG") check_log "postgres published on 127.0.0.1:$PG only" ;;
  *) check_fail "postgres is published as $(omni_compose port postgres 5432)" ;;
esac
[ "$(get -o /dev/null -w '%{http_code}' "http://$REPORTS:$HTTP/sample/report.html")" = 200 ] \
  || check_fail "reports origin did not serve the sample over http"
[ "$(get -o /dev/null -w '%{http_code}' -X POST "http://$REPORTS:$HTTP/sample/report.html")" = 403 ] \
  || check_fail "reports origin accepted a POST"
unknown="$(curl --silent --show-error --max-time 5 --resolve "unknown.localhost:$HTTP:127.0.0.1" -o /dev/null -w '%{http_code}' "http://unknown.localhost:$HTTP/" || true)"
[ "$unknown" = 404 ] || check_fail "unknown hostname on the local http port answered ${unknown:-nothing}"
check_log "reports origin: HTTP GET only; unknown hostnames get 404"

[ "$APPS" = stub ] || { check_log "real apps: proxy behaviour checks need the stub's /api/whoami; skipped"; exit 0; }

who="$(get -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 6.6.6.6' "$APP/api/whoami")"
case "$who" in
  *6.6.6.6*) check_fail "a forged X-Forwarded-For reached the api: $who" ;;
  *'"proto":"http"'*) check_log "api sees nginx's client address, not the forged header ($who)" ;;
  *) check_fail "unexpected forwarding headers: $who" ;;
esac

events="$(get -N --max-time 2 "$APP/api/requests/00000000-0000-4000-8000-000000000000/events" 2>/dev/null || true)"
n="$(printf '%s\n' "$events" | grep -c '^data:' || true)"
[ "$n" -ge 3 ] || check_fail "SSE: $n events arrived in 2 s (buffered?), want >= 3"
check_log "SSE streamed unbuffered ($n events in 2 s)"

distinct_hosts() {
  local _
  for _ in $(seq 1 "$1"); do get "$APP/api/whoami"; echo; sleep 0.05; done \
    | sed -n 's/.*"host":"\([^"]*\)".*/\1/p' | sort -u | wc -l | tr -d ' '
}
[ "$(distinct_hosts 20)" = 2 ] || check_fail "requests did not reach both api replicas"
omni_compose up -d --no-deps --scale api=3 --wait api >/dev/null 2>&1
sleep 4 # resolver valid=2s
[ "$(distinct_hosts 30)" = 3 ] || check_fail "nginx did not pick up the third replica without a reload"
check_log "nginx spreads requests over every replica and follows --scale api=3 without a reload"

codes="$CHECK_TMP/rolling-codes.txt"; : > "$codes"
( while [ ! -f "$CHECK_TMP/rolling.stop" ]; do
    get -o /dev/null -w '%{http_code}\n' "$APP/api/health" >> "$codes" || echo "curl-error" >> "$codes"
    sleep 0.1
  done ) &
loop=$!
export OMNI_RELEASE=check-2
omni_compose build api > "$CHECK_TMP/build2.log" 2>&1
omni_rolling_restart api 3 > "$CHECK_TMP/rolling.log" 2>&1 || { cat "$CHECK_TMP/rolling.log"; check_fail "rolling restart"; }
sleep 2
touch "$CHECK_TMP/rolling.stop"; wait "$loop"
total="$(wc -l < "$codes" | tr -d ' ')"; bad="$(grep -vc '^200$' "$codes" || true)"
if [ "$bad" != 0 ] || [ "$total" -lt 20 ]; then
  omni_compose logs --no-log-prefix nginx 2>&1 | grep -E '\[(error|warn)\]|" 50[0-9] ' | tail -n 20 >&2 || true
  check_fail "rolling restart: $bad of $total requests failed ($(sort "$codes" | uniq -c | tr '\n' ' '))"
fi
images="$(for id in $(omni_service_ids api); do docker inspect --format '{{.Config.Image}}' "$id"; done | sort -u)"
[ "$images" = "omniswarm-stub/app:check-2" ] || check_fail "after the rolling restart api runs: $images"
check_log "rolling restart to check-2: $total requests during the roll, 0 failed, 3 replicas on the new image"

dump="$(bash "$INFRA/deploy/backup.sh" 2>/dev/null | tail -n 1)"
[ -s "$dump" ] && [ -s "$(ls "$state"/backup/reports-*.tar.gz)" ] || check_fail "backup.sh wrote no dump or no reports tarball"
drill="$(bash "$INFRA/deploy/restore.sh" drill "$dump" 2>&1)" || { echo "$drill"; check_fail "restore drill"; }
printf '%s\n' "$drill" | grep -q '^restored from .*stub_request=1 ' || check_fail "restore drill did not restore stub_request: $drill"
check_log "backup + restore drill: $(printf '%s\n' "$drill" | grep '^restored from')"
