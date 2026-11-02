#!/bin/bash
# Prints the deploy steps. A live host is not contacted.
set -euo pipefail
if [ "${1:-}" = "" ] || [ "${1:-}" = "--dry-run" ]; then
  echo "dry-run: unpack the tag, flip /srv/omniswarm/current, restart api and worker"
  exit 0
fi
echo "refusing to deploy to ${1} from this machine" >&2
exit 2
