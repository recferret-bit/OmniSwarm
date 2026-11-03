#!/bin/bash
# Infra gate (`npm run check:infra`).
#   bash infra/check.sh               static checks + local bring-up with the stub apps
#   bash infra/check.sh --static      static checks only
#   bash infra/check.sh --apps=real   bring-up builds apps/api and apps/web instead
#                                     (needs the api to bind HOST and the web app to be
#                                     a Next.js standalone build)
# Static: compose config (prod, dev, dev+stub) + compose policy + env contract +
# "refuses to start without each required secret"; nginx -t on the real config
# (prod and dev names); shellcheck; hadolint; checker unit tests; exec wrapper;
# deploy/release/smoke dry runs; systemd-analyze verify.
# Full adds: the api image build + content checks (images.sh) and the local
# stack bring-up (bring-up.sh).
# Needs: docker (compose v2), node, openssl, curl. Nothing here contacts a host.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/check/lib.sh"

mode=full
export CHECK_APPS=stub
for arg in "$@"; do
  case "$arg" in
    --static) mode=static ;;
    --apps=stub | --apps=real) CHECK_APPS="${arg#--apps=}" ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "infra/check.sh: unknown argument $arg" >&2; exit 64 ;;
  esac
done

for tool in docker node openssl curl; do
  command -v "$tool" >/dev/null 2>&1 || check_fail "$tool is required"
done
docker compose version >/dev/null 2>&1 || check_fail "docker compose v2 is required"

CHECK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/omniswarm-infra-check.XXXXXX")"
export CHECK_TMP
trap 'rm -rf "$CHECK_TMP"' EXIT

started=$(date +%s)
step() {
  local name="$1" script="$2" t0
  t0=$(date +%s)
  echo "$name"
  bash "$CHECK_DIR/$script"
  echo "  ($(( $(date +%s) - t0 ))s)"
}

step "compose + env contract" compose.sh
step "nginx" nginx.sh
step "lint + dry runs" lint.sh
step "systemd" systemd.sh
step "hosts (provisioning)" hosts.sh
if [ "$mode" = full ]; then
  step "api image" images.sh
  step "bring-up ($CHECK_APPS apps)" bring-up.sh
else
  echo "bring-up: skipped (--static)"
fi
echo "infra check ok ($(( $(date +%s) - started ))s)"
