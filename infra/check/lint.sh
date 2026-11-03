#!/bin/bash
# Runs shellcheck on every infra shell script and hadolint on every Dockerfile infra
# builds, both from pinned images so laptop and CI agree; then the checker
# unit tests and the deploy/smoke dry runs.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

cd "$ROOT"
scripts=()
while IFS= read -r f; do scripts+=("$f"); done < <(find infra -name '*.sh' -type f | sort)
docker run --rm -v "$ROOT:/work:ro" -w /work "$SHELLCHECK_IMAGE" --external-sources --severity=style "${scripts[@]}"
check_log "shellcheck ok (${#scripts[@]} scripts)"

dockerfiles=(apps/api/Dockerfile apps/web/Dockerfile infra/test/stub/Dockerfile)
docker run --rm -v "$ROOT:/work:ro" -w /work "$HADOLINT_IMAGE" hadolint --config infra/.hadolint.yaml "${dockerfiles[@]}"
for f in "${dockerfiles[@]}"; do
  # The last stage must drop root, and every FROM must be pinned by digest.
  last_user="$(awk '/^FROM /{ u = "" } /^USER /{ u = $2 } END { print u }' "$f")"
  [ -n "$last_user" ] && [ "$last_user" != root ] && [ "$last_user" != 0 ] || check_fail "$f: final stage runs as root"
  if grep -E '^FROM ' "$f" | grep -vE '^FROM [^ ]+@sha256:[0-9a-f]{64}( AS [a-z]+)?$' | grep -vE '^FROM (deps|build)( AS [a-z]+)?$' | grep -q .; then
    check_fail "$f: a FROM is not pinned by digest"
  fi
  grep -q '^HEALTHCHECK ' "$f" || check_fail "$f: no HEALTHCHECK"
done
check_log "hadolint ok; final stages non-root, bases digest-pinned, healthchecks present (${#dockerfiles[@]} Dockerfiles)"

node --test "$CHECK_DIR"/*.test.mjs > "$CHECK_TMP/node-test.log" 2>&1 || { cat "$CHECK_TMP/node-test.log"; check_fail "infra checker unit tests"; }
check_log "checker unit tests: $(grep -E '^. pass ' "$CHECK_TMP/node-test.log" | tr -d 'ℹ ' | sed 's/pass/pass /')"

bash "$INFRA/check/exec-script.test.sh"

# Dry runs must print a plan and touch nothing (no ssh, no compose).
plan="$(bash infra/deploy/deploy.sh --dry-run deploy-host.invalid HEAD --api-replicas 3 --workers 2)"
for step in 'git -C' 'rsync -az' 'ssh -o BatchMode=yes deploy-host.invalid' 'release.sh activate' '--api-replicas 3 --workers 2'; do
  printf '%s' "$plan" | grep -qF -- "$step" || check_fail "deploy.sh --dry-run plan lacks '$step'"
done
# The remote rm must name exactly one release directory.
printf '%s\n' "$plan" | grep -qE '^sudo rm -rf /srv/omniswarm/releases/[A-Za-z0-9._-]+$' \
  || check_fail "deploy.sh remote 'rm -rf' does not target a single release dir"
[ "$(bash infra/deploy/deploy.sh --dry-run deploy-host.invalid --rollback | grep -c 'release.sh rollback$')" = 1 ] \
  || check_fail "deploy.sh --rollback dry run"
if bash infra/deploy/deploy.sh --dry-run deploy-host.invalid HEAD --workers 'x;rm' >/dev/null 2>&1; then
  check_fail "deploy.sh accepted a non-numeric --workers"
fi
OMNI_ENV_FILE="$CHECK_TMP/prod.env" OMNI_SRV="$CHECK_TMP/srv" bash infra/deploy/release.sh activate r1 --dry-run > "$CHECK_TMP/release-plan.txt" 2>&1
for step in 'npm --prefix' 'docker compose' 'run --rm migrate' 'mv -T' '--scale api=2' 'systemctl restart omniswarm-worker@1.service'; do
  grep -qF -- "$step" "$CHECK_TMP/release-plan.txt" || check_fail "release.sh activate --dry-run lacks '$step'"
done
bash infra/deploy/smoke.sh --dry-run omniswarm.example > "$CHECK_TMP/smoke-plan.txt"
for step in health ready web-root admin-blocked reports-csp rate-limit; do
  grep -qF "[$step]" "$CHECK_TMP/smoke-plan.txt" || check_fail "smoke.sh --dry-run lacks the $step check"
done
check_log "deploy.sh, release.sh and smoke.sh dry runs print the full plan"
