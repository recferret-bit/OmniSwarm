#!/bin/bash
# Fail if the index tracks reports/, pocs/, engine/runtime/node_modules/ or an env file other than .env.example or a NEXT_PUBLIC_-only file, or if
# git history holds a high-confidence secret. gitleaks (pinned version below) runs when it is installed; the
# pattern sweep over every commit always runs, so a machine without gitleaks still gets the provider-key shapes.
#   SECRET_SWEEP_NO_GITLEAKS=1   skip gitleaks (tests use this to exercise the fallback alone)
set -euo pipefail
GITLEAKS_PINNED="8.30.1"
# Planted, inert test values that gitleaks' generic rule matches. Fingerprint: commit:file:rule:line.
GITLEAKS_ALLOW=(
  "20913d67d6d9d76a95fbc11f1ee9c70b7fff3610:tests/e2e/intake/w09.spec.ts:generic-api-key:16"
  # NodeSource apt signing-key fingerprint (public), renamed in a later commit.
  "36a2c7e9b48fc7a386f0cdd18c91c97a4d892813:infra/deploy/provision.sh:generic-api-key:26"
)

tracked="$(git ls-files)"
candidates="$(printf '%s\n' "$tracked" | grep -E '(^|/)(reports/|pocs/)|^engine/runtime/node_modules/|(^|/)\.env(\.[^/]+)?$' | grep -Ev '(^|/)\.env\.example$' || true)"
# A tracked env file is allowed only when it is public by construction: every non-blank, non-comment line is a
# NEXT_PUBLIC_* assignment (values inlined into the browser bundle anyway). Anything else in it fails the sweep.
public_env_only() {
  [ -f "$1" ] || return 1
  ! grep -Ev '^[[:space:]]*(#|$)' "$1" | grep -Evq '^NEXT_PUBLIC_[A-Z0-9_]+='
}
forbidden=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    */.env|*/.env.*|.env|.env.*) if public_env_only "$file"; then continue; fi ;;
  esac
  forbidden+="$file"$'\n'
done <<<"$candidates"
forbidden="${forbidden%$'\n'}"
if [ -n "$forbidden" ]; then
  echo "tracked reports/, pocs/, engine/runtime/node_modules/ or an env file" >&2
  printf '%s\n' "$forbidden" | head -20 >&2
  exit 1
fi

if [ "${SECRET_SWEEP_NO_GITLEAKS:-}" != "1" ] && command -v gitleaks >/dev/null 2>&1; then
  version="$(gitleaks version 2>/dev/null | tr -d 'v' || true)"
  [ "$version" = "$GITLEAKS_PINNED" ] || echo "secret sweep: gitleaks $version is not the pinned $GITLEAKS_PINNED; running it anyway" >&2
  ignore="$(mktemp)"
  printf '%s\n' "${GITLEAKS_ALLOW[@]}" >"$ignore"
  set +e
  gitleaks detect --source . --redact --no-banner --log-level error --exit-code 3 --gitleaks-ignore-path "$ignore" >&2
  code=$?
  set -e
  rm -f "$ignore"
  if [ "$code" -eq 3 ]; then echo "gitleaks found a secret in git history" >&2; exit 1; fi
  if [ "$code" -ne 0 ]; then echo "gitleaks could not scan the repository (exit $code)" >&2; exit 1; fi
  echo "gitleaks $version: no leaks"
fi

# Key shapes come from tools/secret-shapes.txt, which infra/deploy/log-hygiene.sh reads too. The PEM rule
# stays here: it needs the key body, because the harness fixture bad.js holds only the PEM header plus "MII",
# which is a shape, not a key.
SHAPES="$(dirname "$0")/secret-shapes.txt"
[ -r "$SHAPES" ] || { echo "secret sweep: $SHAPES is missing" >&2; exit 1; }
pattern=''
while IFS= read -r rule; do
  case "$rule" in '' | '#'*) continue ;; esac
  pattern+="${rule#*|}|"
done <"$SHAPES"
pattern+='-----BEGIN [A-Z ]*PRIVATE KEY-----['"'"'\r\n]+[A-Za-z0-9+/=]{40,}'
tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.err"' EXIT
# git grep exits 1 when nothing matches. Any other failure is a real error.
set +e
# shellcheck disable=SC2046
git grep -I -n -E "$pattern" $(git rev-list --all) -- . >"$tmp" 2>"$tmp.err"
code=$?
set -e
if [ "$code" -eq 0 ]; then
  echo "secret pattern matched git history" >&2
  head -20 "$tmp" | cut -c1-160 >&2
  exit 1
fi
if [ "$code" -ne 1 ]; then
  echo "secret sweep could not search history" >&2
  cat "$tmp.err" >&2
  exit 1
fi
echo "secret sweep ok"
