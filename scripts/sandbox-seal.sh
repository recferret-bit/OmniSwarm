#!/usr/bin/env bash
# Reviewer handoff seal. sandbox.sh runs this as root in a one-shot container on the /work volume after
# preparation, with the network already detached. From here on target suites run as uid 10001.
#
# R-01: /work and /work/bin become root:root 0755, so a suite cannot replace or rename /work/bin. Subdirectories
#       (src, cargo, target, runs, venv) stay 10001-owned.
# R-02: every prepared node_modules tree under /work/src (not inside .git or target) is copied into /work/deps,
#       root-owned and not writable by uid 10001. Per-run test copies take their dependencies from there, so one
#       suite cannot poison the node_modules the next suite runs with.
set -euo pipefail

WORK="${1:-/work}"

mkdir -p "$WORK/runs" "$WORK/bin"
chown 10001:10001 "$WORK/runs"
chown -R root:root "$WORK/bin"
chown root:root "$WORK"
chmod 755 "$WORK" "$WORK/bin"
chmod -R go-w "$WORK/bin"

rm -rf "$WORK/deps"
mkdir -p "$WORK/deps"
if [ -d "$WORK/src" ]; then
  cd "$WORK/src"
  find . \( -name .git -o -name target \) -prune -o -type d -name node_modules -print0 -prune |
    while IFS= read -r -d '' dir; do
      mkdir -p "$WORK/deps/$(dirname "$dir")"
      cp -a "$dir" "$WORK/deps/$dir"
    done
fi
chown -R root:root "$WORK/deps"
chmod -R go-w,a+rX "$WORK/deps"
chmod 755 "$WORK/deps"
