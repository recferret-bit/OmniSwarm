#!/bin/bash
# `systemd-analyze verify` on every unit in infra/systemd/ and the host units
# provision.sh installs (infra/hosts/*.service), inside a Debian
# trixie container with the release tree mounted at /srv/omniswarm/current,
# so ExecStart paths resolve exactly as on the host. Then checks the worker
# unit keeps the properties the plan requires.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

if ! docker image inspect "$SYSTEMD_CHECK_IMAGE" >/dev/null 2>&1; then
  check_log "building $SYSTEMD_CHECK_IMAGE (first run only)"
  docker build -q -t "$SYSTEMD_CHECK_IMAGE" -f "$CHECK_DIR/systemd.Dockerfile" "$CHECK_DIR" >/dev/null
fi

units=()
for f in "$INFRA"/systemd/* "$INFRA"/hosts/*.service; do units+=("/srv/omniswarm/current/${f#"$ROOT"/}"); done
# Templates are verified through an instance name.
docker run --rm --network none -v "$ROOT:/srv/omniswarm/current:ro" "$SYSTEMD_CHECK_IMAGE" sh -c '
  set -e
  mkdir -p /run/verify
  for u in "$@"; do
    case "$u" in
      *@.service) cp "$u" "/run/verify/$(basename "$u" | sed "s/@\.service$/@1.service/")" ;;
      *) cp "$u" /run/verify/ ;;
    esac
  done
  cd /run/verify
  out=$(SYSTEMD_LOG_LEVEL=notice systemd-analyze verify --man=no ./* 2>&1) || { echo "$out"; exit 1; }
  if [ -n "$out" ]; then echo "$out"; exit 1; fi
' verify "${units[@]}" || check_fail "systemd-analyze verify"
check_log "systemd-analyze verify ok (${#units[@]} units)"

worker="$INFRA/systemd/omniswarm-worker@.service"
want() { grep -qE "^$1" "$worker" || check_fail "worker unit lacks $1"; }
grep -qE '^ExecStart=.*exec-script\.sh apps/api worker$' "$worker" || check_fail "worker unit does not run the api worker script"
grep -q 'server\.ts' "$worker" && check_fail "worker unit starts the API server"
for directive in 'Restart=always' 'KillMode=mixed' 'NoNewPrivileges=yes' 'ProtectSystem=strict' 'ProtectHome=yes' \
  'EnvironmentFile=/etc/omniswarm/worker.env' 'EnvironmentFile=/etc/omniswarm/providers.env' 'SupplementaryGroups=docker' \
  'MemoryMax=' 'TasksMax=' 'ReadWritePaths=/srv/omniswarm/work /srv/omniswarm/reports' 'Environment=TMPDIR=/srv/omniswarm/work/'; do
  want "$directive"
done
stop="$(sed -n 's/^TimeoutStopSec=\([0-9]*\)$/\1/p' "$worker")"
[ "${stop:-0}" -ge 120 ] || check_fail "worker TimeoutStopSec=${stop:-unset}; it must cover the job grace (>= 120 s)"
grep -qE '^PrivateTmp=(yes|true)' "$worker" && check_fail "worker PrivateTmp=yes would hide the engine's bind-mount sources from dockerd"
check_log "worker unit: runs the worker, Restart=always, mixed SIGTERM stop ${stop}s, hardened, root-only env files"
