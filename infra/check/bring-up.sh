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
# infra/deploy/smoke.sh against it (TLS, redirect, health, ready, web root,
# headers, admin 403, reports CSP, 429 burst); Postgres on loopback only;
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
export OMNI_PROJECT=omniswarm-infra-check OMNI_PROFILE=dev OMNI_ENV_FILE="$env_file" OMNI_SRV="$state/srv"
export OMNI_RELEASE=check-1 OMNI_BACKUP_DIR="$state/backup"
[ "$APPS" = stub ] && export OMNI_COMPOSE_EXTRA="$INFRA/compose/compose.stub.yml"
# shellcheck source=infra/deploy/lib.sh
. "$INFRA/deploy/lib.sh"

env_get() { grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2-; }
HTTP="$(env_get OMNI_HTTP_PORT)"; HTTPS="$(env_get OMNI_HTTPS_PORT)"; PG="$(env_get OMNI_PG_PORT)"
DOMAIN="$(env_get OMNI_DOMAIN)"; REPORTS="$(env_get OMNI_REPORTS_DOMAIN)"
APP="https://$DOMAIN:$HTTPS"
CACERT="$state/tls/live/$DOMAIN/fullchain.pem"
curl_opts=(--silent --show-error --max-time 10 --cacert "$CACERT"
  --resolve "$DOMAIN:$HTTPS:127.0.0.1" --resolve "$REPORTS:$HTTPS:127.0.0.1"
  --resolve "$DOMAIN:$HTTP:127.0.0.1" --resolve "$REPORTS:$HTTP:127.0.0.1")
get() { curl "${curl_opts[@]}" "$@"; }

for port in "$HTTP" "$HTTPS" "$PG"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    check_fail "port 127.0.0.1:$port is in use; change it in infra/env/dev.env.example"
  fi
done

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

bash "$INFRA/deploy/smoke.sh" --cacert "$CACERT" --resolve 127.0.0.1 --http-port "$HTTP" \
  --network testnet --min-cert-days 7 "$DOMAIN:$HTTPS" "$REPORTS" | sed 's/^/    /'

case "$(omni_compose port postgres 5432)" in
  "127.0.0.1:$PG") check_log "postgres published on 127.0.0.1:$PG only" ;;
  *) check_fail "postgres is published as $(omni_compose port postgres 5432)" ;;
esac
[ "$(get -o /dev/null -w '%{redirect_url}' "http://$REPORTS:$HTTP/sample/report.html")" = "https://$REPORTS:$HTTPS/sample/report.html" ] \
  || check_fail "reports http -> https redirect"
[ "$(get -o /dev/null -w '%{http_code}' -X POST "https://$REPORTS:$HTTPS/sample/report.html")" = 403 ] \
  || check_fail "reports origin accepted a POST"
if curl --silent --max-time 5 -k --resolve "unknown.localhost:$HTTPS:127.0.0.1" -o /dev/null "https://unknown.localhost:$HTTPS/"; then
  check_fail "nginx completed a TLS handshake for an unknown hostname"
fi
check_log "reports origin: redirect, GET only; unknown hostnames rejected at the handshake"

[ "$APPS" = stub ] || { check_log "real apps: proxy behaviour checks need the stub's /api/whoami; skipped"; exit 0; }

who="$(get -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 6.6.6.6' "$APP/api/whoami")"
case "$who" in
  *6.6.6.6*) check_fail "a forged X-Forwarded-For reached the api: $who" ;;
  *'"proto":"https"'*) check_log "api sees nginx's client address, not the forged header ($who)" ;;
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
