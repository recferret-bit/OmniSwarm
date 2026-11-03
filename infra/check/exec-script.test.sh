#!/bin/bash
# infra/bin/exec-script.sh must replace itself with the script's command (same
# PID, so SIGTERM reaches node directly) and refuse anything it cannot exec.
set -euo pipefail
# shellcheck source=infra/check/lib.sh
. "$(dirname "$0")/lib.sh"
: "${CHECK_TMP:?run through infra/check.sh}"

pkg="$CHECK_TMP/exec-script-pkg"
mkdir -p "$pkg"
cat > "$pkg/package.json" <<'EOF'
{ "scripts": {
  "pid": "node pid.mjs",
  "compound": "node pid.mjs && echo second",
  "assign": "FOO=1 node pid.mjs",
  "quoted": "node -e \"1\""
} }
EOF
cat > "$pkg/pid.mjs" <<'EOF'
import fs from 'node:fs';
fs.writeFileSync('pid.out', String(process.pid));
process.on('SIGTERM', () => { fs.writeFileSync('sigterm.out', 'yes'); process.exit(0); });
setInterval(() => {}, 1000);
EOF

sh "$INFRA/bin/exec-script.sh" "$pkg" pid &
launched=$!
for _ in $(seq 1 50); do [ -s "$pkg/pid.out" ] && break; sleep 0.1; done
[ "$(cat "$pkg/pid.out")" = "$launched" ] || check_fail "exec-script did not exec: wrapper pid $launched, node pid $(cat "$pkg/pid.out")"
kill -TERM "$launched"
wait "$launched" || true
[ "$(cat "$pkg/sigterm.out" 2>/dev/null)" = yes ] || check_fail "SIGTERM did not reach the node process"

expect_exit() {
  local want="$1" script="$2" got=0
  sh "$INFRA/bin/exec-script.sh" "$pkg" "$script" 2>/dev/null || got=$?
  [ "$got" = "$want" ] || check_fail "exec-script $script exited $got, want $want"
}
expect_exit 65 compound
expect_exit 65 assign
expect_exit 65 quoted
expect_exit 66 missing
check_log "exec-script: execs in place (SIGTERM reaches node), rejects compound/assign/quoted/missing scripts"
