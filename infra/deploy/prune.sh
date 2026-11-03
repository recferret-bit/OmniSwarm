#!/bin/bash
# Daily retention (omniswarm-prune.timer; W12-11), as root on the host.
#   prune.sh [--dry-run]
#
# RUNS_ROOT attempt dirs and orphaned published reports are the worker's own job
# (apps/api worker hygiene, KEEP_RUNS); this script does not touch them.
# - Engine staging leftovers in work/tmp and work/targets older than 2 days (crashed runs).
# - Docker: omniswarm/api and omniswarm/web images of releases that are no longer on disk,
#   dangling images and build cache older than 7 days.
# Backups prune themselves (backup.sh, newest 7).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

STAGING_DAYS=2
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) omni_die "unknown option $1" ;;
  esac
done

removed=0

remove() {
  omni_run rm -rf -- "$1"
  removed=$((removed + 1))
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

prune_staging
prune_images
omni_log "prune: removed $removed engine staging dir(s)"
