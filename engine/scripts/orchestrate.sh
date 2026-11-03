#!/usr/bin/env bash
set -euo pipefail

# orchestrate.sh
# Multi-agent security review of ONE target repo (already resolved to a directory by bin/audit).
# Isolated source-review policy: reviewers run only through persistent ACP sessions and the
# restricted Docker MCP bridge. No host CLI fallback.
# Reviewers, models, presets and budgets are resolved by scripts/run-config.mjs (flags > preset > config file > defaults).
#
# Usage (normally via bin/audit):
#   orchestrate.sh --target <dir> --out <dir> [--name <slug>] [--surface s1..s6|all]
#                  [--reviewers <spec,spec>] [--config <file>] [--preset <name>] [--assign matrix|round-robin]
#                  [--orchestrator <spec|recommended>] [--alternate-judge <spec>] [--passes N] [--tool-budget N]
#                  [--debate-rounds N] [--debate-max-clusters N] [--debate-tool-budget N]
#                  [--agents a,b] [--model <slug>] [--models a=<slug>,b=<slug>] [--model-<agent> <slug>]   aliases for cli: reviewers
#                  [--mode local|remote] [--source <path|url>] [--ref <ref>] [--commit <sha>] [--plan]
#                  [--rpc <https URL>]   rejected: source review does not contact deployed RPCs
# Precedence for an agent's model: --model-<agent>, then --models, then --model, then the default in reviewer-registry.mjs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_DIR="" OUTPUT_DIR="" TARGET_NAME="" SURFACE="all" RPC="" RESUME_FROM="" TEST_ARTIFACTS="" RESTART_FAILED=0
TARGET_MODE="local" TARGET_SOURCE="" TARGET_REF="" TARGET_COMMIT=""
PLAN=0 BLOCKED="${AUDIT_BLOCKED_RUN:-0}"
RC_ARGS=()   # reviewer/budget flags, forwarded to scripts/run-config.mjs

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_DIR="$2"; shift 2 ;;
    --out) OUTPUT_DIR="$2"; shift 2 ;;
    --name) TARGET_NAME="$2"; shift 2 ;;
    --surface) SURFACE="$2"; shift 2 ;;
    --agents|--reviewers|--config|--preset|--assign|--orchestrator|--alternate-judge|--passes|--tool-budget|--max-cost-usd|--debate-rounds|--debate-max-clusters|--debate-tool-budget|--model|--models|--model-claude|--model-grok|--model-agy|--model-codex)
      [ $# -ge 2 ] || { echo "orchestrate: $1 needs a value" >&2; exit 1; }
      RC_ARGS+=("$1" "$2"); shift 2 ;;
    --mode) TARGET_MODE="$2"; shift 2 ;;
    --source) TARGET_SOURCE="$2"; shift 2 ;;
    --ref) TARGET_REF="$2"; shift 2 ;;
    --commit) TARGET_COMMIT="$2"; shift 2 ;;
    --plan) PLAN=1; shift ;;
    --blocked) BLOCKED=1; shift ;;
    --resume-from) RESUME_FROM="${2:?--resume-from needs a report directory}"; shift 2 ;;
    --test-artifacts) TEST_ARTIFACTS="${2:?--test-artifacts needs a Cargo target directory}"; shift 2 ;;
    --restart-failed) RESTART_FAILED=1; shift ;;
    --rpc) RPC="${2:?--rpc needs an https URL}"; shift 2 ;;
    *) echo "orchestrate: unknown option $1" >&2; exit 1 ;;
  esac
done

[ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ] || { echo "orchestrate: --target <dir> is required" >&2; exit 1; }
[ -n "$OUTPUT_DIR" ] || [ "$PLAN" -eq 1 ] || { echo "orchestrate: --out <dir> is required" >&2; exit 1; }
TARGET_NAME="${TARGET_NAME:-$(basename "$TARGET_DIR")}"
TARGET_SOURCE="${TARGET_SOURCE:-$TARGET_DIR}"

[ -z "$RPC" ] || { echo "source security review does not contact deployed RPCs" >&2; exit 2; }

# --- surfaces: generic attack areas, not tied to any one codebase --------------------
# id|slug|name|focus
SURFACES=(
  "s1|auth|Identity & Access Control|authentication, sessions/tokens/cookies, authorization and IDOR, privilege escalation, admin/internal planes, CSRF, password/key handling"
  "s2|input|Input Handling & Injection|injection (SQL/NoSQL/command/template), deserialization, SSRF, path traversal, file upload, XXE, request smuggling, validation gaps on every network or file input"
  "s3|logic|Business Logic & Value Flows|money / credit / entitlement flows, race conditions and double-spend, idempotency, state-machine bypass, rate and quota limits, smart-contract or ledger invariants where present"
  "s4|config|Secrets, Config & Infrastructure|hard-coded or leaked secrets, env/config handling, Dockerfiles, IaC, CI/CD workflows, reverse-proxy and TLS config, security headers, logging of sensitive data"
  "s5|deps|Dependencies & Supply Chain|manifests and lockfiles, known-vulnerable or typosquatted packages, install/postinstall scripts, unpinned CI actions, vendored code, build reproducibility"
  "s6|client|Client & Web Surface|DOM XSS sinks, postMessage/origin checks, CSP/SRI, CORS, token storage in the browser, wallet/signing flows, mobile or desktop client trust boundaries"
)

surface_row() { # <id|slug> -> prints the matching SURFACES row
  local want="$1" row id slug
  for row in "${SURFACES[@]}"; do
    IFS='|' read -r id slug _ <<<"$row"
    case "$want" in
      "$id"|"$slug") printf '%s' "$row"; return 0 ;;
    esac
  done
  return 1
}

SELECTED=()
if [ "$SURFACE" = "all" ]; then
  for row in "${SURFACES[@]}"; do SELECTED+=("$row"); done
else
  row="$(surface_row "$SURFACE")" || { echo "Unknown surface: $SURFACE. Valid: s1..s6 (auth, input, logic, config, deps, client) or all" >&2; exit 1; }
  SELECTED+=("$row")
fi

RESOLVED_FILE="$(mktemp "${TMPDIR:-/tmp}/audit-reviewers.XXXXXX")"
REQUEST_FILE=""
trap 'rm -f -- "$RESOLVED_FILE" ${REQUEST_FILE:+"$REQUEST_FILE"}' EXIT
# --target lets run-config refuse the scripted judge on anything but an OmniSwarm fixture (scripted_judge_demo_only).
node "$SCRIPT_DIR/run-config.mjs" resolve --target "$TARGET_DIR" ${RC_ARGS[@]+"${RC_ARGS[@]}"} >"$RESOLVED_FILE" || exit 2
{ IFS= read -r AGENT_LABELS; IFS= read -r MODEL_LINE; } < <(node "$SCRIPT_DIR/reviewer-plan.mjs" header "$RESOLVED_FILE")

echo "=========================================================="
echo " Audit Multi-Agent Orchestrator"
echo " Target:   $TARGET_NAME ($TARGET_MODE)"
echo " Source:   $TARGET_SOURCE${TARGET_REF:+ @ $TARGET_REF}${TARGET_COMMIT:+ [$TARGET_COMMIT]}"
echo " Path:     $TARGET_DIR"
echo " Surface:  $SURFACE"
echo " Agents:   $AGENT_LABELS"
echo " Models:   $MODEL_LINE"
echo " Output:   ${OUTPUT_DIR:-<plan>}"
echo " Policy:   persistent ACP sessions + one-shot Docker MCP bridge; committed reports are authoritative"
echo "=========================================================="

if [ "$PLAN" -eq 1 ]; then
  echo "Plan only. No harness, no agents."
fi
# Reviewer table, assignment, budgets and orchestrator. Exits 2 when a reviewer's family is not installed.
node "$SCRIPT_DIR/reviewer-plan.mjs" plan "$RESOLVED_FILE" "$SURFACE" || exit 2
[ "$PLAN" -eq 0 ] || exit 0

umask 077
if [ -d "$OUTPUT_DIR" ] && [ -n "$(ls -A "$OUTPUT_DIR")" ]; then
  echo "orchestrate: output directory must be empty; stale reports are not current evidence" >&2
  exit 2
fi
REQUEST_FILE="$(mktemp "${TMPDIR:-/tmp}/audit-review-request.XXXXXX")"
node -e '
const fs = require("node:fs");
const [file, resolved, target, out, name, mode, source, ref, commit, surface, rpc, resumeFrom, testArtifacts, restartFailed] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(resolved, "utf8"));
const models = Object.fromEntries(r.reviewers.map((x) => [x.id, x.model]));
fs.writeFileSync(file, JSON.stringify({target, out, name, mode, source, ref, commit, surface, agents: r.reviewers.map((x) => x.id), models, reviewers: r.reviewers, orchestrator: r.orchestrator, alternateJudge: r.alternateJudge, assign: r.assign, budgets: r.budgets, prices: r.prices || null, preset: r.preset, rpc: rpc || "", resumeFrom: resumeFrom || null, testArtifacts: testArtifacts || null, restartFailed: restartFailed === "1"}), {mode: 0o600});
' "$REQUEST_FILE" "$RESOLVED_FILE" "$TARGET_DIR" "$OUTPUT_DIR" "$TARGET_NAME" "$TARGET_MODE" "$TARGET_SOURCE" "$TARGET_REF" "$TARGET_COMMIT" "$SURFACE" "$RPC" "$RESUME_FROM" "$TEST_ARTIFACTS" "$RESTART_FAILED"

code=0
if [ "${BLOCKED:-${AUDIT_BLOCKED_RUN:-0}}" = "1" ]; then
  node "$SCRIPT_DIR/worker-supervisor.mjs" blocked-run "$REQUEST_FILE" || code=$?
  if [ -f "$OUTPUT_DIR/meta.json" ]; then
    node "$SCRIPT_DIR/generate-html-report.mjs" "$OUTPUT_DIR" || code=2
  fi
  [ "$code" -ne 0 ] || code=2
  echo "Blocked/incomplete review record saved to: $OUTPUT_DIR"
  exit "$code"
fi

if [ "${OMNI_DEMO_HOST:-0}" = "1" ]; then
  node "$SCRIPT_DIR/review-host.mjs" "$REQUEST_FILE" || code=$?
else
  node "$SCRIPT_DIR/docker-agent-orchestrator.mjs" "$REQUEST_FILE" || code=$?
fi
if [ "${OMNI_DEMO_HOST:-0}" != "1" ] && [ -f "$OUTPUT_DIR/meta.json" ]; then
  # HTML generation revalidates and scores current inputs before rendering.
  node "$SCRIPT_DIR/generate-html-report.mjs" "$OUTPUT_DIR" || code=2
fi
if [ "$code" -ne 0 ] && [ "${OMNI_DEMO:-0}" = "1" ]; then
  # The demo decides its own outcome (audit-demo-verdict.mjs); do not announce a failed audit first.
  echo "Demo run finished (engine exit $code); checking the demo verdict for: $OUTPUT_DIR" >&2
elif [ "$code" -ne 0 ]; then
  echo "AUDIT FAILED (exit $code); partial output at: $OUTPUT_DIR" >&2
else
  echo "Audit report saved to: $OUTPUT_DIR"
fi
exit "$code"
