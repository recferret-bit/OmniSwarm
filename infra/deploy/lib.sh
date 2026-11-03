# shellcheck shell=bash
# Shared helpers for infra/deploy/*.sh and infra/check/bring-up.sh. Source it;
# do not run it. Every command that changes state goes through omni_run, so
# OMNI_DRY_RUN=1 prints the plan instead of acting.
#
# Settings (environment, with production defaults):
#   OMNI_PROJECT        compose project name             (omniswarm)
#   OMNI_PROFILE        compose overlay: prod | dev      (prod)
#   OMNI_ENV_FILE       compose --env-file               (/etc/omniswarm/stack.env)
#   OMNI_COMPOSE_EXTRA  extra overlay files, space separated (none)
#   OMNI_SRV            host root                        (/srv/omniswarm)
#   OMNI_RELEASE        image tag; defaults to the release `current` points at
#   OMNI_DRY_RUN        1 = print commands only          (0)

OMNI_INFRA="${OMNI_INFRA:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OMNI_PROJECT="${OMNI_PROJECT:-omniswarm}"
OMNI_PROFILE="${OMNI_PROFILE:-prod}"
OMNI_ENV_FILE="${OMNI_ENV_FILE:-/etc/omniswarm/stack.env}"
OMNI_COMPOSE_EXTRA="${OMNI_COMPOSE_EXTRA:-}"
OMNI_SRV="${OMNI_SRV:-/srv/omniswarm}"
OMNI_DRY_RUN="${OMNI_DRY_RUN:-0}"

omni_log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
omni_die() { omni_log "error: $*"; exit 1; }

# omni_run <cmd...>: execute, or print it when OMNI_DRY_RUN=1.
omni_run() {
  if [ "$OMNI_DRY_RUN" = 1 ]; then
    printf '+'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

# omni_env_value <NAME>: a value from the stack env file (last assignment wins).
omni_env_value() {
  [ -r "$OMNI_ENV_FILE" ] || { [ "$OMNI_DRY_RUN" = 1 ] && { printf '<%s>' "$1"; return 0; }; omni_die "cannot read $OMNI_ENV_FILE"; }
  grep -E "^$1=" "$OMNI_ENV_FILE" | tail -n 1 | cut -d= -f2-
}

omni_current_release() {
  local target
  target="$(readlink "$OMNI_SRV/current" 2>/dev/null || true)"
  [ -n "$target" ] && basename "$target"
}

# Image tag for compose interpolation: explicit > env file > current symlink.
omni_export_release() {
  if [ -z "${OMNI_RELEASE:-}" ]; then
    OMNI_RELEASE="$( [ -r "$OMNI_ENV_FILE" ] && omni_env_value OMNI_RELEASE || true)"
    [ -n "$OMNI_RELEASE" ] || OMNI_RELEASE="$(omni_current_release || true)"
  fi
  [ -n "${OMNI_RELEASE:-}" ] || OMNI_RELEASE="unknown"
  export OMNI_RELEASE
}

omni_compose() {
  local files=(-f "$OMNI_INFRA/compose/compose.yml" -f "$OMNI_INFRA/compose/compose.$OMNI_PROFILE.yml")
  local extra
  for extra in $OMNI_COMPOSE_EXTRA; do files+=(-f "$extra"); done
  omni_export_release
  omni_run docker compose --project-name "$OMNI_PROJECT" --project-directory "$OMNI_INFRA/compose" \
    --env-file "$OMNI_ENV_FILE" "${files[@]}" "$@"
}

# Container ids of a service (empty in dry-run mode).
omni_service_ids() {
  [ "$OMNI_DRY_RUN" = 1 ] && return 0
  omni_compose ps -q "$1"
}

# omni_rolling_restart <service> <replicas>
# Start <replicas> new containers next to the old ones (new image/config),
# wait until all are healthy, give nginx one DNS refresh to see them, then stop
# the old containers one at a time (SIGTERM, 30 s drain), one DNS refresh
# apart, so nginx never holds more than one departed address. A draining
# replica refuses new connections and nginx retries them on another one
# (proxy_next_upstream); a departed address costs one 1 s connect timeout.
omni_rolling_restart() {
  local svc="$1" want="$2" old count id
  old="$(omni_service_ids "$svc")"
  count="$(printf '%s\n' "$old" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    omni_compose up -d --no-deps --scale "$svc=$want" --wait "$svc"
    return
  fi
  omni_log "rolling $svc: $count old -> $want new"
  omni_compose up -d --no-deps --no-recreate --scale "$svc=$((count + want))" --wait "$svc"
  omni_run sleep "${OMNI_DNS_SETTLE_S:-3}" # nginx resolver valid=2s
  for id in $old; do
    omni_run docker stop --time 30 "$id"
    omni_run docker rm "$id"
    omni_run sleep "${OMNI_DNS_SETTLE_S:-3}"
  done
}

# Re-render the nginx templates from the mounted dir, test, then reload.
omni_nginx_reload() {
  omni_compose exec -T nginx sh -c \
    '/docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null && nginx -t -q && nginx -s reload'
}
