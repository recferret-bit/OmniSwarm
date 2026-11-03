#!/bin/bash
# Runs shellcheck on every infra shell script and hadolint on every Dockerfile infra
# builds and actionlint on the workflows, all from pinned images so laptop and
# CI agree; then the checker unit tests, the deploy/smoke/timer dry runs and
# the host-timer scripts against stubs (timers.test.sh).
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

cd "$ROOT"
scripts=()
while IFS= read -r f; do scripts+=("$f"); done < <(find infra -name '*.sh' -type f | sort)
docker run --rm -v "$ROOT:/work:ro" -w /work "$SHELLCHECK_IMAGE" --external-sources --severity=style "${scripts[@]}"
# systemd units and release.sh exec these directly from a `git archive` tree.
not_exec="$(find infra -name '*.sh' -type f ! -perm -u+x)"
[ -z "$not_exec" ] || check_fail "scripts without the executable bit: $not_exec"
check_log "shellcheck ok (${#scripts[@]} scripts, all executable)"

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

# Workflows: actionlint (schema, expressions, shellcheck on run: scripts) on every
# workflow, then the deploy workflow's own policy (workflow-policy.mjs).
docker run --rm -v "$ROOT:/repo:ro" -w /repo "$ACTIONLINT_IMAGE" -no-color -oneline || check_fail "actionlint"
node "$CHECK_DIR/workflow-policy.mjs" .github/workflows/deploy.yml || check_fail "deploy workflow policy"
check_log "actionlint ok (.github/workflows); deploy.yml: dispatch-only, protected environment, pinned actions"

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
for step in 'npm --prefix' 'docker compose' 'run --rm migrate' 'mv -T' '--scale api=2' 'systemctl restart omniswarm-worker@1.service' \
  'r1/omniswarm.config.json' 'omniswarm-health.timer omniswarm-prune.timer omniswarm-log-hygiene.timer'; do
  grep -qF -- "$step" "$CHECK_TMP/release-plan.txt" || check_fail "release.sh activate --dry-run lacks '$step'"
done
for script in "certbot.sh issue" "certbot.sh renew --staging" "backup.sh" "restore.sh drill" "restore.sh live x.dump --yes"; do
  # shellcheck disable=SC2086 # "<script> <args>" split on purpose
  OMNI_ENV_FILE="$CHECK_TMP/prod.env" OMNI_SRV="$CHECK_TMP/srv" bash infra/deploy/$script --dry-run > "$CHECK_TMP/plan.txt" 2>&1 \
    || { cat "$CHECK_TMP/plan.txt"; check_fail "$script --dry-run"; }
  grep -q '^+ docker compose' "$CHECK_TMP/plan.txt" || check_fail "$script --dry-run printed no compose command"
done
bash infra/deploy/smoke.sh --dry-run omniswarm.example > "$CHECK_TMP/smoke-plan.txt"
for step in health ready web-root admin-blocked reports-csp rate-limit; do
  grep -qF "[$step]" "$CHECK_TMP/smoke-plan.txt" || check_fail "smoke.sh --dry-run lacks the $step check"
done
for script in health.sh prune.sh log-hygiene.sh; do
  OMNI_ENV_FILE="$CHECK_TMP/prod.env" OMNI_SRV="$CHECK_TMP/srv" OMNI_ALERT_WEBHOOK_URL=https://alert.invalid/secret-path \
    OMNI_HEARTBEAT_URL=https://beat.invalid/secret-path bash "infra/deploy/$script" --dry-run > "$CHECK_TMP/plan.txt" 2>&1 \
    || { cat "$CHECK_TMP/plan.txt"; check_fail "$script --dry-run"; }
  grep -q '^+ ' "$CHECK_TMP/plan.txt" || check_fail "$script --dry-run printed no plan"
  grep -q 'secret-path' "$CHECK_TMP/plan.txt" && check_fail "$script --dry-run printed an alert or heartbeat URL"
done
check_log "deploy, release, certbot, backup, restore, smoke, health, prune and log-hygiene dry runs print their plans"
bash "$CHECK_DIR/timers.test.sh"
