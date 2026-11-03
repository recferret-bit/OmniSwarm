#!/bin/bash
# Daily log sweep (omniswarm-log-hygiene.timer; W12-13), as root on the host.
#   log-hygiene.sh [--dry-run] [--hours N]   (window, default 24)
#
# Sources: the journal of the omniswarm-* units, the logs of every container in the compose
# project, and engine worker.log files under RUNS_ROOT changed in the window.
# Looks for:
#   - the exact value of every secret in /etc/omniswarm/*.env (names with SECRET, TOKEN,
#     PASSWORD, _KEY, WEBHOOK or HEARTBEAT; values of 12+ characters) and the operator key
#   - secret shapes: GitHub tokens and provider API keys (tools/secret-shapes.txt, shared with
#     tools/secret-sweep.sh), NEAR ed25519 secret keys, PEM private keys
# Prints "clean", or one "HIT <rule> in <source>" line per finding and never the matching text;
# a hit exits 1 and sends one alert (omni_alert).
set -euo pipefail
# shellcheck source=infra/deploy/lib.sh
. "$(dirname "$0")/lib.sh"

ETC="${OMNI_ETC:-/etc/omniswarm}"
hours=24
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) OMNI_DRY_RUN=1; shift ;;
    --hours) hours="${2:-}"; shift 2 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) omni_die "unknown option $1" ;;
  esac
done
[[ "$hours" =~ ^[1-9][0-9]{0,3}$ ]] || omni_die "--hours takes a whole number of hours"
since="${hours}h"

SECRET_VAR='(SECRET|TOKEN|PASSWORD|_KEY$|_KEY_|WEBHOOK|HEARTBEAT)'
# rule name -> extended regex. The GitHub and provider key shapes are tools/secret-shapes.txt, shared
# with tools/secret-sweep.sh; the NEAR and PEM shapes are for logs only.
SHAPES="$(dirname "$0")/../../tools/secret-shapes.txt"
[ -r "$SHAPES" ] || omni_die "key shapes file $SHAPES is missing"
RULES=()
while IFS= read -r rule; do
  case "$rule" in '' | '#'*) continue ;; esac
  RULES+=("$rule")
done <"$SHAPES"
RULES+=(
  "near-secret-key|ed25519:[1-9A-HJ-NP-Za-km-z]{80,}"
  "pem-private-key|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)

if [ "$OMNI_DRY_RUN" = 1 ]; then
  printf '+ journalctl --since -%s -u omniswarm-* -o cat\n' "$since"
  printf '+ docker logs --since %s <each container of compose project %s>\n' "$since" "$OMNI_PROJECT"
  printf '+ find <RUNS_ROOT> -name worker.log -mmin -%s\n' "$((hours * 60))"
  printf '+ grep -F <values of the secret variables in %s/*.env and the operator key>; grep -E %s\n' "$ETC" "${RULES[*]%%|*}"
  exit 0
fi

work="$(mktemp -d "${RUNTIME_DIRECTORY:-${TMPDIR:-/tmp}}/log-hygiene.XXXXXX")"
trap 'rm -rf "$work"' EXIT
chmod 0700 "$work"
mkdir "$work/src"

# --- collect --------------------------------------------------------------------
journalctl --since "-$since" --no-pager -o cat -u 'omniswarm-*' > "$work/src/journal" 2>/dev/null || true
while IFS= read -r name; do
  [ -n "$name" ] || continue
  docker logs --since "$since" "$name" > "$work/src/docker:$name" 2>&1 || true
done < <(docker ps -a --filter "label=com.docker.compose.project=$OMNI_PROJECT" --format '{{.Names}}' 2>/dev/null || true)
runs="$( [ -r "$ETC/worker.env" ] && omni_env_value RUNS_ROOT "$ETC/worker.env" || true)"
runs="${runs:-$OMNI_SRV/work/runs}"
if [ -d "$runs" ]; then
  while IFS= read -r log; do
    rel="${log#"$runs"/}"
    cp "$log" "$work/src/run:${rel//\//_}" 2>/dev/null || true
  done < <(find "$runs" -name worker.log -type f -mmin -"$((hours * 60))" 2>/dev/null)
fi

# --- secret values (names only ever leave this function) --------------------------
: > "$work/values"
for file in "$ETC"/*.env; do
  [ -r "$file" ] || continue
  while IFS='=' read -r name value; do
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    [[ "$name" =~ ^[A-Z0-9_]+$ ]] && [[ "$name" =~ $SECRET_VAR ]] && [ "${#value}" -ge 12 ] || continue
    printf '%s\t%s\n' "$name" "$value" >> "$work/values"
  done < "$file"
done
if [ -r "$ETC/operator-key.json" ]; then
  key="$(sed -nE 's/.*"(private_key|secret_key)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/p' "$ETC/operator-key.json" | head -n 1)"
  [ -z "$key" ] || printf 'OPERATOR_KEY\t%s\n' "$key" >> "$work/values"
fi

# --- scan -----------------------------------------------------------------------
hits=0
hit() { echo "HIT $1 in $2"; hits=$((hits + 1)); }
for src in "$work"/src/*; do
  [ -s "$src" ] || continue
  label="$(basename "$src")"
  while IFS=$'\t' read -r name value; do
    if grep -qF -- "$value" "$src"; then hit "value of $name" "$label"; fi
  done < "$work/values"
  for rule in "${RULES[@]}"; do
    if grep -qE -- "${rule#*|}" "$src"; then hit "${rule%%|*}" "$label"; fi
  done
done

sources="$(find "$work/src" -type f -size +0 | wc -l | tr -d ' ')"
secrets="$(wc -l < "$work/values" | tr -d ' ')"
if [ "$hits" -gt 0 ]; then
  omni_alert log-hygiene "$hits secret hit(s) in the last $since of logs; run infra/deploy/log-hygiene.sh on the host for the sources"
  exit 1
fi
echo "clean: $sources log source(s), last $since, $secrets secret value(s) and ${#RULES[@]} shapes"
