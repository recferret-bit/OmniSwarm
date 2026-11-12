#!/usr/bin/env bash
set -euo pipefail

# orchestrate.sh
# Multi-agent security review of ONE target repo (already resolved to a directory by bin/audit).
# Isolated source-review policy: reviewers run only through persistent ACP sessions and the
# restricted Docker MCP bridge. No host CLI fallback.
# Reviewers, models, presets and budgets are resolved by scripts/run-config.mjs (flags > preset > config file > defaults).
#
# Usage (normally via bin/audit):
#   orchestrate.sh --target <dir> --out <dir> [--name <slug>] [--surface s1..s6|all] [--scope full|web2|web3|infra]
#                  [--reviewers <spec,spec>] [--config <file>] [--preset <name>] [--assign matrix|round-robin]
#                  [--orchestrator <spec|recommended>] [--alternate-judge <spec>] [--passes N] [--tool-budget N]
#                  [--debate-rounds N] [--debate-max-clusters N] [--debate-tool-budget N] [--debate-turn-ms N] [--debate-phase-ms N]
#                  [--agents a,b] [--model <slug>] [--models a=<slug>,b=<slug>] [--model-<agent> <slug>]   aliases for cli: reviewers
#                  [--mode local|remote] [--source <path|url>] [--ref <ref>] [--commit <sha>] [--plan]
#                  [--rpc <https URL>]   rejected: source review does not contact deployed RPCs
# Precedence for an agent's model: --model-<agent>, then --models, then --model, then the default in reviewer-registry.mjs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET_DIR="" OUTPUT_DIR="" TARGET_NAME="" SURFACE="all" SCOPE="full" RPC="" RESUME_FROM="" TEST_ARTIFACTS="" RESTART_FAILED=0
TARGET_MODE="local" TARGET_SOURCE="" TARGET_REF="" TARGET_COMMIT=""
PLAN=0 BLOCKED="${AUDIT_BLOCKED_RUN:-0}"
RC_ARGS=()   # reviewer/budget flags, forwarded to scripts/run-config.mjs

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_DIR="$2"; shift 2 ;;
    --out) OUTPUT_DIR="$2"; shift 2 ;;
    --name) TARGET_NAME="$2"; shift 2 ;;
    --surface) SURFACE="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --agents|--reviewers|--config|--preset|--assign|--orchestrator|--alternate-judge|--passes|--tool-budget|--max-cost-usd|--debate-rounds|--debate-max-clusters|--debate-tool-budget|--debate-turn-ms|--debate-phase-ms|--pipeline|--concurrency|--model|--models|--model-claude|--model-grok|--model-agy|--model-codex)
      [ $# -ge 2 ] || { echo "orchestrate: $1 needs a value" >&2; exit 1; }
      RC_ARGS+=("$1" "$2"); shift 2 ;;
    --step-by-step|--no-debate)
      RC_ARGS+=("$1"); shift ;;
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

# --- surfaces: generic review areas, not tied to any one codebase --------------------
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
HTML_DONE=0
finalize_html() {
  if [ "$HTML_DONE" -eq 0 ] && [ "${OMNI_DEMO_HOST:-0}" != "1" ] && [ -n "$OUTPUT_DIR" ] && [ -f "$OUTPUT_DIR/meta.json" ]; then
    HTML_DONE=1
    node "$SCRIPT_DIR/generate-html-report.mjs" "$OUTPUT_DIR" || [ "${code:-0}" -ne 0 ] || code=2
    if [ "${BLOCKED:-${AUDIT_BLOCKED_RUN:-0}}" != "1" ]; then
      node "$SCRIPT_DIR/debate-step-cli.mjs" finalize "$OUTPUT_DIR" --target "$TARGET_DIR" >/dev/null 2>&1 || true
    fi
  fi
}
cleanup_exit() {
  finalize_html || true
  rm -f -- "$RESOLVED_FILE" ${REQUEST_FILE:+"$REQUEST_FILE"}
}
trap cleanup_exit EXIT
trap 'code=130' INT TERM
# --target lets run-config refuse the scripted judge on anything but an OmniSwarm fixture (scripted_judge_demo_only).
node "$SCRIPT_DIR/run-config.mjs" resolve --target "$TARGET_DIR" ${RC_ARGS[@]+"${RC_ARGS[@]}"} >"$RESOLVED_FILE" || exit 2
{ IFS= read -r AGENT_LABELS; IFS= read -r MODEL_LINE; } < <(node "$SCRIPT_DIR/reviewer-plan.mjs" header "$RESOLVED_FILE")

echo "=========================================================="
echo " Audit Multi-Agent Orchestrator"
echo " Target:   $TARGET_NAME ($TARGET_MODE)"
echo " Source:   $TARGET_SOURCE${TARGET_REF:+ @ $TARGET_REF}${TARGET_COMMIT:+ [$TARGET_COMMIT]}"
echo " Path:     $TARGET_DIR"
echo " Surface:  $SURFACE"
echo " Scope:    $SCOPE"
echo " Agents:   $AGENT_LABELS"
echo " Models:   $MODEL_LINE"
echo " Output:   ${OUTPUT_DIR:-<plan>}"
echo " Policy:   persistent ACP sessions + one-shot Docker MCP bridge; committed reports are authoritative"
echo "=========================================================="

if [ "$PLAN" -eq 1 ]; then
  echo "Plan only. No harness, no agents."
fi
# Reviewer table, assignment, budgets and orchestrator. Exits 2 when a reviewer's family is not installed.
# A blocked run prints the plan without probing host CLIs (worker-isolation).
if [ "$BLOCKED" = 1 ]; then
  OMNI_SKIP_CLI_PROBE=1 node "$SCRIPT_DIR/reviewer-plan.mjs" plan "$RESOLVED_FILE" "$SURFACE" "$SCOPE" || exit 2
else
  node "$SCRIPT_DIR/reviewer-plan.mjs" plan "$RESOLVED_FILE" "$SURFACE" "$SCOPE" || exit 2
fi
[ "$PLAN" -eq 0 ] || exit 0

umask 077
if [ -f "$OUTPUT_DIR/.omni-continue-pipeline.json" ] && [ -f "$OUTPUT_DIR/pipeline-progress.json" ]; then
  { IFS= read -r CONT_ACTION; IFS= read -r CONT_ROUNDS; } < <(node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const a = d.action === "advise" || Number(d.rounds) === 0 ? "advise" : "debate";
    const r = Number.isInteger(d.rounds) && d.rounds >= 1 && d.rounds <= 5 ? String(d.rounds) : "1";
    process.stdout.write(a + "\n" + r + "\n");
  ' "$OUTPUT_DIR/.omni-continue-pipeline.json")
  rm -f -- "$OUTPUT_DIR/.omni-continue-pipeline.json"
  code=0
  CONT_ARGS=("$CONT_ACTION" "$OUTPUT_DIR" --repo "$TARGET_DIR")
  [ "$CONT_ACTION" = "debate" ] && CONT_ARGS+=(--rounds "$CONT_ROUNDS")
  node "$SCRIPT_DIR/debate-step-cli.mjs" "${CONT_ARGS[@]}" ${RC_ARGS[@]+"${RC_ARGS[@]}"} || code=$?
  finalize_html
  exit "$code"
fi
if [ -d "$OUTPUT_DIR" ] && [ -n "$(ls -A "$OUTPUT_DIR")" ]; then
  echo "orchestrate: output directory must be empty; stale reports are not current evidence" >&2
  exit 2
fi
REQUEST_FILE="$(mktemp "${TMPDIR:-/tmp}/audit-review-request.XXXXXX")"
node -e '
const fs = require("node:fs");
const [file, resolved, target, out, name, mode, source, ref, commit, surface, rpc, resumeFrom, testArtifacts, restartFailed, scope] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(resolved, "utf8"));
const models = Object.fromEntries(r.reviewers.map((x) => [x.id, x.model]));
fs.writeFileSync(file, JSON.stringify({target, out, name, mode, source, ref, commit, surface, scope: scope || "full", agents: r.reviewers.map((x) => x.id), models, reviewers: r.reviewers, orchestrator: r.orchestrator, alternateJudge: r.alternateJudge, assign: r.assign, pipelineMode: r.pipelineMode || "full", concurrency: r.concurrency || 1, budgets: r.budgets, prices: r.prices || null, preset: r.preset, rpc: rpc || "", resumeFrom: resumeFrom || null, testArtifacts: testArtifacts || null, restartFailed: restartFailed === "1"}), {mode: 0o600});
' "$REQUEST_FILE" "$RESOLVED_FILE" "$TARGET_DIR" "$OUTPUT_DIR" "$TARGET_NAME" "$TARGET_MODE" "$TARGET_SOURCE" "$TARGET_REF" "$TARGET_COMMIT" "$SURFACE" "$RPC" "$RESUME_FROM" "$TEST_ARTIFACTS" "$RESTART_FAILED" "$SCOPE"

code=0
if [ "${BLOCKED:-${AUDIT_BLOCKED_RUN:-0}}" = "1" ]; then
  node "$SCRIPT_DIR/worker-supervisor.mjs" blocked-run "$REQUEST_FILE" || code=$?
  finalize_html
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
  finalize_html
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
