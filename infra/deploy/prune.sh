#!/bin/bash
# Daily retention (omniswarm-prune.timer; W12-11), as root on the host.
#   prune.sh [--dry-run]
#
# - RUNS_ROOT (worker.env, default /srv/omniswarm/work/runs): request dirs whose newest file
#   is older than OMNI_RUNS_KEEP_DAYS (30). They hold worker.log, result.json and the
#   attempt's own report copy. Only from OMNI_PRUNE_NOT_BEFORE (2026-12-31) on: until then
#   every run is kept for the hackathon review.
# - Published reports (REPORTS_ROOT) are never pruned: attestations point at them.
# - Engine staging leftovers in work/tmp and work/targets older than 2 days (crashed runs).
# - Docker: omniswarm/api and omniswarm/web images of releases that are no longer on disk,
#   dangling images and build cache older than 7 days.
# Backups prune themselves (backup.sh, newest 7).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

WORKER_ENV="${OMNI_WORKER_ENV_FILE:-/etc/omniswarm/worker.env}"
KEEP_DAYS="${OMNI_RUNS_KEEP_DAYS:-30}"
NOT_BEFORE="${OMNI_PRUNE_NOT_BEFORE:-2026-12-31}"
STAGING_DAYS=2
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) omni_die "unknown option $1" ;;
  esac
done
case "$KEEP_DAYS" in '' | *[!0-9]*) omni_die "OMNI_RUNS_KEEP_DAYS must be a number" ;; esac
[[ "$NOT_BEFORE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || omni_die "OMNI_PRUNE_NOT_BEFORE must be YYYY-MM-DD"

runs="$( [ -r "$WORKER_ENV" ] && omni_env_value RUNS_ROOT "$WORKER_ENV" || true)"
runs="${runs:-$OMNI_SRV/work/runs}"
today="$(date -u +%F)"
removed=0

remove() {
  omni_run rm -rf -- "$1"
  removed=$((removed + 1))
}

prune_runs() {
  local dir
  if [[ "$today" < "$NOT_BEFORE" ]]; then
    omni_log "runs: kept (pruning starts $NOT_BEFORE)"
    return 0
  fi
  [ -d "$runs" ] || return 0
  while IFS= read -r dir; do
    # The dir's own mtime moves when an attempt is added; a file inside may be newer still.
    if [ -z "$(find "$dir" -mtime -"$KEEP_DAYS" -print -quit)" ]; then remove "$dir"; fi
  done < <(find "$runs" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS")
}

prune_staging() {
  local base dir
  for base in "$OMNI_SRV/work/tmp" "$OMNI_SRV/work/targets"; do
    [ -d "$base" ] || continue
    while IFS= read -r dir; do remove "$dir"; done < <(find "$base" -mindepth 1 -maxdepth 1 -mtime +"$STAGING_DAYS")
  done
}

prune_images() {
  local repo tag
  for repo in omniswarm/api omniswarm/web; do
    while IFS= read -r tag; do
      if [ -z "$tag" ] || [ "$tag" = '<none>' ] || [ -d "$OMNI_SRV/releases/$tag" ]; then continue; fi
      # A container still running the image keeps it (rm refuses); next run retries.
      omni_run docker image rm "$repo:$tag" || true
    done < <(docker image ls "$repo" --format '{{.Tag}}' 2>/dev/null || true)
  done
  omni_run docker image prune -f --filter until=168h
  omni_run docker builder prune -f --filter until=168h
}

prune_runs
prune_staging
prune_images
omni_log "prune: removed $removed dir(s) from $runs and the engine staging dirs"
