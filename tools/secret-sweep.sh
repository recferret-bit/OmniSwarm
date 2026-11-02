#!/bin/bash
# Fail if git history or the index holds a high-confidence secret, or tracks reports/, pocs/, or .env.
set -euo pipefail
tracked="$(git ls-files)"
if printf '%s\n' "$tracked" | grep -E '(^|/)(reports/|pocs/|\.env$)' >/dev/null; then
  echo "tracked reports/, pocs/, or .env" >&2
  printf '%s\n' "$tracked" | grep -E '(^|/)(reports/|pocs/|\.env$)' >&2 || true
  exit 1
fi
# The harness fixture bad.js contains only the PEM header plus "MII", which is a shape, not a key.
pattern='ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----['"'"'\r\n]+[A-Za-z0-9+/=]{40,}|sk-ant-[A-Za-z0-9]|sk-proj-[A-Za-z0-9]'
tmp="$(mktemp)"
# git grep exits 1 when nothing matches. Any other failure is a real error.
set +e
git grep -I -n -E "$pattern" $(git rev-list --all) -- . >"$tmp" 2>"$tmp.err"
code=$?
set -e
if [ "$code" -eq 0 ]; then
  echo "secret pattern matched git history" >&2
  head -20 "$tmp" >&2
  exit 1
fi
if [ "$code" -ne 1 ]; then
  echo "secret sweep could not search history" >&2
  cat "$tmp.err" >&2
  exit 1
fi
rm -f "$tmp" "$tmp.err"
echo "secret sweep ok"
