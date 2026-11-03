#!/bin/bash
# Builds apps/api/Dockerfile from the current tree and checks the W12-03
# acceptance: < 300 MB, non-root uid, a HEALTHCHECK, no engine code (engine/,
# bin/), no .env file, and nothing under /app writable by the runtime user.
# (apps/web/Dockerfile is built by `infra/check.sh --apps=real`: it needs the
# Next.js standalone build.)
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

image=omniswarm-infra-check/api:image-check
docker build -q -f "$ROOT/apps/api/Dockerfile" -t "$image" "$ROOT" > "$CHECK_TMP/api-image.log" 2>&1 \
  || { cat "$CHECK_TMP/api-image.log"; check_fail "apps/api/Dockerfile does not build"; }

size="$(docker image inspect "$image" --format '{{.Size}}')"
[ "$size" -lt 300000000 ] || check_fail "api image is $size bytes (limit 300 MB)"
[ -n "$(docker image inspect "$image" --format '{{if .Config.Healthcheck}}yes{{end}}')" ] || check_fail "api image has no HEALTHCHECK"

report="$(docker run --rm --network none --entrypoint sh "$image" -c '
  echo "uid=$(id -u)"
  for p in /app/engine /app/scripts /app/docker /app/bin /app/apps/api/test; do [ -e "$p" ] && echo "present=$p"; done
  find / -xdev -name ".env*" 2>/dev/null | sed "s/^/envfile=/"
  find /app -writable 2>/dev/null | head -n 3 | sed "s/^/writable=/"
  true
')"
case "$report" in uid=0* | "") check_fail "api image runs as root" ;; esac
printf '%s\n' "$report" | grep -E '^(present|envfile|writable)=' && check_fail "api image contents (above) break the allow-list"
check_log "api image: $((size / 1000000)) MB, $(printf '%s\n' "$report" | head -n 1), healthcheck, no engine code / .env, /app read-only"
