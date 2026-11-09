#!/bin/bash
# Reserved near:local entry (W15-01b). W15-02 replaces this stub with the sandbox runner.
set -euo pipefail

subs=(up down status reset seed view call redeploy)

usage() {
  printf 'usage: near:local <subcommand>\n'
  printf 'subcommands: %s\n' "${subs[*]}"
}

if [ "$#" -eq 0 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

for sub in "${subs[@]}"; do
  if [ "$1" = "$sub" ]; then
    printf 'near:local %s: reserved\n' "$1"
    exit 0
  fi
done

printf 'near:local: unknown subcommand: %s\n' "$1" >&2
usage >&2
exit 2
