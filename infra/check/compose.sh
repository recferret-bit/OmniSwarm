#!/bin/bash
# Static compose checks: prod and dev profiles render, the resolved models pass
# compose-policy.mjs, the env contract holds, and compose refuses to start when
# any required secret or setting is missing.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

prod_env="$CHECK_TMP/prod.env"
filled_stack_env "$prod_env"
dev_env="$(bash "$INFRA/compose/dev-env.sh" "$CHECK_TMP/dev")"

for profile in prod dev; do
  env_file="$prod_env"; [ "$profile" = dev ] && env_file="$dev_env"
  compose_config "$profile" "$env_file" --format json > "$CHECK_TMP/$profile.json"
  node "$CHECK_DIR/compose-policy.mjs" "$profile" "$CHECK_TMP/$profile.json"
done
COMPOSE_CHECK_EXTRA="$INFRA/compose/compose.stub.yml" compose_config dev "$dev_env" -q
check_log "compose config: prod, dev and dev+stub render"

node "$CHECK_DIR/env-contract.mjs" --compose-json "$CHECK_TMP/prod.json"

# The shipped example has no secrets, so compose must refuse it as-is ...
example="$CHECK_TMP/example.env"
cp "$INFRA/env/stack.env.example" "$example"
printf 'OMNI_RELEASE=check\n' >> "$example"
if compose_config prod "$example" -q 2>/dev/null; then
  check_fail "compose accepted infra/env/stack.env.example with its secrets empty"
fi
# ... and refuse each required value on its own.
count=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  blanked="$CHECK_TMP/blank-$name.env"
  sed "s|^$name=.*|$name=|" "$prod_env" > "$blanked"
  if err="$(compose_config prod "$blanked" -q 2>&1)"; then
    check_fail "compose started without $name"
  fi
  case "$err" in
    *"$name"*) count=$((count + 1)) ;;
    *) check_fail "compose refused a blank $name but did not name it: $err" ;;
  esac
done < <(node "$CHECK_DIR/env-contract.mjs" --print-required)
[ "$count" -gt 0 ] || check_fail "no required variables found"
check_log "compose refuses to start without each of $count required values"
