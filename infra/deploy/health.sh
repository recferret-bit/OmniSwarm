#!/bin/bash
# On-box health check (omniswarm-health.timer, once a minute; W12-17), as root on the host.
#   health.sh [--dry-run]
#
# Checks, each reported as "ok <check>" or "FAIL <check>: <why>":
#   api-health  GET https://<OMNI_DOMAIN>/api/health through nginx on 127.0.0.1 answers 200 "ok":true
#   api-ready   GET /api/ready answers 200 (database reachable, migrations applied, queue installed)
#   workers     omniswarm-workers.target and every worker@N are active, and /api/health counts a live worker
#   disk        /srv/omniswarm and Docker's data root are below OMNI_DISK_ALARM_PCT (80) percent used
# A check that fails OMNI_HEALTH_RESTART_AFTER (2) runs in a row is repaired (again every 10
# failed runs): api/web/nginx containers that stopped or turned unhealthy are started again,
# failed workers are reset and started. It alerts once when a check goes down and once when it
# recovers (omni_alert, OMNI_ALERT_WEBHOOK_URL). An all-green run fetches OMNI_HEARTBEAT_URL.
# Exit 1 when any check failed. State (failure counts) lives in $STATE_DIRECTORY.
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

STATE="${OMNI_HEALTH_STATE:-${STATE_DIRECTORY:-/var/lib/omniswarm-health}}"
AFTER="${OMNI_HEALTH_RESTART_AFTER:-2}"
DISK_PCT="${OMNI_DISK_ALARM_PCT:-80}"
REPEAT_REPAIR=10
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
    *) omni_die "unknown option $1" ;;
  esac
done

domain="$(omni_env_value OMNI_DOMAIN)"
body=""
reason=""

# probe <path>: status code into $code, body into $body.
probe() {
  local out
  out="$(curl -sS --max-time 10 --proto '=https' --resolve "$domain:443:127.0.0.1" -w '\n%{http_code}' "https://$domain$1" 2>&1)" || true
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
}

check_api_health() {
  probe /api/health
  [ "$code" = 200 ] || { reason="status ${code:-none}"; return 1; }
  case "$body" in *'"ok":true'*) return 0 ;; *) reason="no \"ok\":true in the body"; return 1 ;; esac
}
health_body="" # /api/health body of this run, for the worker count

check_api_ready() {
  probe /api/ready
  [ "$code" = 200 ] || { reason="status ${code:-none}: ${body:0:120}"; return 1; }
}

check_workers() {
  local unit inactive=""
  systemctl is-active --quiet omniswarm-workers.target || { reason="omniswarm-workers.target is not active"; return 1; }
  for unit in $(systemctl list-units 'omniswarm-worker@*.service' --all --plain --no-legend | awk '{ print $1 }'); do
    systemctl is-enabled --quiet "$unit" && ! systemctl is-active --quiet "$unit" && inactive="$inactive $unit"
  done
  [ -z "$inactive" ] || { reason="not active:$inactive"; return 1; }
  case "$health_body" in
    *'"workers":0'*) reason="/api/health counts no live worker (pg-boss)"; return 1 ;;
  esac
}

check_disk() {
  local path pct full=""
  for path in "$OMNI_SRV" "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"; do
    pct="$(df -P "$path" 2>/dev/null | awk 'NR == 2 { sub(/%/, "", $5); print $5 }')"
    [ -n "$pct" ] && [ "$pct" -ge "$DISK_PCT" ] && full="$full $path=${pct}%"
  done
  [ -z "$full" ] || { reason="over ${DISK_PCT}%:$full"; return 1; }
}

repair_stack() {
  local ids
  ids="$(docker ps -q --filter "label=com.docker.compose.project=$OMNI_PROJECT" --filter health=unhealthy || true)"
  # shellcheck disable=SC2086 # one id per word
  [ -z "$ids" ] || omni_run docker restart $ids
  # Starts stopped or missing containers (up to OMNI_API_REPLICAS api); healthy ones are kept.
  omni_compose up -d --no-deps --no-recreate api web nginx
}

repair_workers() {
  omni_run systemctl reset-failed 'omniswarm-worker@*.service'
  omni_run systemctl start omniswarm-workers.target
}

repair() {
  case "$1" in
    api-health | api-ready) repair_stack ;;
    workers) repair_workers ;;
    disk) omni_log "disk: no automatic repair; see docs/ops/COST.md \"Storage\"" ;;
  esac
}

# record <check> <ok 0|1>: failure counting, repair and alert transitions.
failed=0
record() {
  local name="$1" ok="$2" fails_file="$STATE/$1.fails" alerted="$STATE/$1.alerted" n
  if [ "$ok" = 1 ]; then
    echo "ok   $name"
    [ -e "$alerted" ] && omni_alert recovered "$name is healthy again"
    rm -f "$fails_file" "$alerted"
    return 0
  fi
  failed=$((failed + 1))
  echo "FAIL $name: $reason"
  n=$(( $(cat "$fails_file" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$fails_file"
  if [ "$n" -eq "$AFTER" ] || { [ "$n" -gt "$AFTER" ] && [ $(( (n - AFTER) % REPEAT_REPAIR )) -eq 0 ]; }; then
    repair "$name"
  fi
  if [ "$n" -ge "$AFTER" ] && [ ! -e "$alerted" ]; then
    omni_alert down "$name: $reason ($n failed runs in a row; repair attempted)"
    : > "$alerted"
  fi
}

if [ "$OMNI_DRY_RUN" = 1 ]; then
  for path in /api/health /api/ready; do
    printf '+ [%s] curl -sS --max-time 10 --resolve %s:443:127.0.0.1 https://%s%s\n' "api-${path#/api/}" "$domain" "$domain" "$path"
  done
  printf '+ [workers] systemctl is-active omniswarm-workers.target omniswarm-worker@*.service\n'
  printf '+ [disk] df -P %s <docker root>  (alarm at %s%%)\n' "$OMNI_SRV" "$DISK_PCT"
  echo "repairs after $AFTER failed runs:"
  repair_stack
  repair_workers
  omni_fetch OMNI_HEARTBEAT_URL
  echo "dry run: nothing was checked"
  exit 0
fi

mkdir -p "$STATE"
if check_api_health; then health_body="$body"; record api-health 1; else record api-health 0; fi
if check_api_ready; then record api-ready 1; else record api-ready 0; fi
if check_workers; then record workers 1; else record workers 0; fi
if check_disk; then record disk 1; else record disk 0; fi

if [ "$failed" -gt 0 ]; then exit 1; fi
omni_fetch OMNI_HEARTBEAT_URL || omni_log "heartbeat ping failed"
