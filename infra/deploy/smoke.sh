#!/bin/bash
# Live smoke needs a Linux host. This machine does not pretend one exists.
set -euo pipefail
if [ "${1:-}" = "" ]; then
  echo "usage: smoke.sh <host>" >&2
  exit 2
fi
echo "smoke.sh does not run against ${1} here; no host was provided to this check" >&2
exit 2
