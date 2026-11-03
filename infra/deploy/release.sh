#!/bin/bash
# Runs ON the host, as root, from inside an unpacked release. deploy.sh calls it
# over ssh; an operator may call it directly.
#
#   release.sh activate <release-id> [--api-replicas N] [--workers M] [--dry-run]
#   release.sh rollback [--api-replicas N] [--workers M] [--dry-run]
#
# activate: install host deps, build images, migrate once, flip `current`,
#           roll api and web, reload nginx, restart workers one at a time,
#           keep the newest 3 releases.
# rollback: flip `current` to the previous release and roll the same way.
#           Migrations are not undone: they must stay backward compatible
#           with the previous release (expand first, contract a release later).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

KEEP_RELEASES=3
cmd="${1:-}"; shift || true
release=""
api_replicas=""
workers=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-replicas) api_replicas="$2"; shift 2 ;;
    --workers) workers="$2"; shift 2 ;;
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    -*) omni_die "unknown option $1" ;;
    *) release="$1"; shift ;;
  esac
done
[ -n "$api_replicas" ] || api_replicas="$(omni_env_value OMNI_API_REPLICAS)"
workers="${workers:-1}"
HISTORY="$OMNI_SRV/releases/.history"

# Release ids from the history file, oldest first, each at its latest position.
history_recent() {
  [ -r "$HISTORY" ] || return 0
  awk '{ last[$0] = NR; line[NR] = $0 } END { for (i = 1; i <= NR; i++) if (last[line[i]] == i) print line[i] }' "$HISTORY"
}

install_host_deps() {
  local dir="$1"
  # The worker runs from this tree on the host. Root owns it; the omniswarm
  # user only reads it. No install scripts run.
  omni_run npm --prefix "$dir" ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @omniswarm/api
  omni_run npm --prefix "$dir/engine/runtime" ci --ignore-scripts --no-audit --no-fund
}

install_host_config() {
  local dir="$1" nginx_dir
  nginx_dir="$(omni_env_value OMNI_NGINX_DIR)"
  # nginx mounts a stable path, so pruning old releases never pulls its
  # config out from under it.
  omni_run mkdir -p "$nginx_dir"
  omni_run rsync -a --delete "$dir/infra/nginx/" "$nginx_dir/"
  omni_run install -m 0644 -t /etc/systemd/system \
    "$dir"/infra/systemd/*.service "$dir"/infra/systemd/*.timer "$dir"/infra/systemd/*.target
  omni_run systemctl daemon-reload
}

ensure_tls() {
  local domain
  domain="$(omni_env_value OMNI_DOMAIN)"
  if [ "$OMNI_DRY_RUN" = 1 ] || [ ! -s "$(omni_env_value OMNI_TLS_DIR)/live/$domain/fullchain.pem" ]; then
    omni_log "no certificate for $domain yet: issuing (standalone, before nginx owns :80)"
    omni_run "$OMNI_INFRA/deploy/certbot.sh" issue
  fi
}

flip_current() {
  local dir="$1" id="$2"
  omni_run ln -sfn "$dir" "$OMNI_SRV/current.next"
  omni_run mv -T "$OMNI_SRV/current.next" "$OMNI_SRV/current"
  if [ "$OMNI_DRY_RUN" = 1 ]; then
    printf '+ echo %q >> %q\n' "$id" "$HISTORY"
  else
    printf '%s\n' "$id" >> "$HISTORY"
  fi
}

restart_workers() {
  local want="$1" i unit
  for i in $(seq 1 "$want"); do
    # Sequential: each stop waits for the running job (TimeoutStopSec).
    omni_run systemctl enable "omniswarm-worker@$i.service"
    omni_run systemctl restart "omniswarm-worker@$i.service"
    omni_run systemctl is-active --quiet "omniswarm-worker@$i.service"
  done
  [ "$OMNI_DRY_RUN" = 1 ] && return 0
  systemctl list-units 'omniswarm-worker@*.service' --all --plain --no-legend | while read -r unit _; do
    i="${unit#omniswarm-worker@}"; i="${i%.service}"
    if [ "$i" -gt "$want" ] 2>/dev/null; then
      omni_run systemctl disable --now "$unit"
    fi
  done
  omni_run systemctl enable omniswarm-workers.target
}

roll_services() {
  omni_compose up -d --wait postgres
  omni_rolling_restart api "$api_replicas"
  omni_rolling_restart web 1
  omni_compose up -d --no-deps --wait nginx
  omni_nginx_reload
  restart_workers "$workers"
  omni_run systemctl enable --now omniswarm-backup.timer omniswarm-certbot-renew.timer
}

prune_releases() {
  local current keep id
  [ "$OMNI_DRY_RUN" = 1 ] && { printf '+ prune %s/releases to the newest %s\n' "$OMNI_SRV" "$KEEP_RELEASES"; return 0; }
  current="$(omni_current_release)"
  keep="$(history_recent | tail -n "$KEEP_RELEASES")"
  for dir in "$OMNI_SRV"/releases/*/; do
    id="$(basename "$dir")"
    [ "$id" = "$current" ] && continue
    printf '%s\n' "$keep" | grep -qxF "$id" && continue
    omni_log "pruning release $id"
    rm -rf -- "$OMNI_SRV/releases/$id"
  done
}

activate() {
  [ -n "$release" ] || omni_die "usage: release.sh activate <release-id>"
  local dir="$OMNI_SRV/releases/$release"
  [ "$OMNI_DRY_RUN" = 1 ] || [ -d "$dir" ] || omni_die "$dir does not exist"
  OMNI_INFRA="$dir/infra"
  OMNI_RELEASE="$release"; export OMNI_RELEASE
  install_host_deps "$dir"
  install_host_config "$dir"
  omni_compose build
  ensure_tls
  omni_compose run --rm migrate
  flip_current "$dir" "$release"
  roll_services
  prune_releases
  omni_log "release $release is live"
}

rollback() {
  local current previous
  current="$(omni_current_release || true)"
  previous="$(history_recent | grep -vxF "${current:-}" | tail -n 1 || true)"
  if [ "$OMNI_DRY_RUN" = 1 ]; then previous="${previous:-<previous>}"; fi
  [ -n "$previous" ] || omni_die "no previous release recorded in $HISTORY"
  local dir="$OMNI_SRV/releases/$previous"
  [ "$OMNI_DRY_RUN" = 1 ] || [ -d "$dir" ] || omni_die "$dir was pruned"
  OMNI_INFRA="$dir/infra"
  OMNI_RELEASE="$previous"; export OMNI_RELEASE
  install_host_config "$dir"
  omni_compose build # no-op when the release's images still exist
  flip_current "$dir" "$previous"
  roll_services
  omni_log "rolled back from ${current:-?} to $previous"
}

case "$cmd" in
  activate) activate ;;
  rollback) rollback ;;
  *) omni_die "usage: release.sh activate <release-id> | rollback [--api-replicas N] [--workers M] [--dry-run]" ;;
esac
