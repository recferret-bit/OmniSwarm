// Shared pieces of the debater and orchestrator bridge roles: the read tools (the auditor's own handlers and
// input schemas, behind a per-session call budget), the session's assignment, and report_json unwrapping.
import { commonHandlers, commonToolDefinitions } from './bridge-tools-common.mjs';
import { sha256Json as digest } from './hash-util.mjs';
import { readReportJson } from './report-files.mjs';
import { readJsonOr, writeJson } from './report-util-files.mjs';

const DEBATE_READS = ['get_audit_context', 'read_file', 'search_code', 'list_files'];
export const DEBATE_TOOL_BUDGET = 12;

export function readToolDefinitions() {
  return commonToolDefinitions().filter((tool) => DEBATE_READS.includes(tool.name));
}

function identityOf(ctx) {
  const identity = ctx.submissionIdentity;
  if (!identity?.name) throw new Error('Debate tools require a submission identity; the bridge was started without --identity-file');
  return identity;
}

// The budget decision for one call. Submits never count and are always allowed.
function debateBudgetDecision(record, tool, submitTool, budget = DEBATE_TOOL_BUDGET) {
  const calls = record?.calls || 0;
  if (tool === submitTool) return { allow: true, record: { calls } };
  if (calls >= budget) return { allow: false, text: `budget exhausted: call ${submitTool} now`, record: { calls } };
  return { allow: true, record: { calls: calls + 1 } };
}

// Read handlers that count calls per session identity in harness/debate-budget-<name>.json.
// submitFor(assignment) names the submit the budget message points at.
export function budgetedReadHandlers(submitFor) {
  return Object.fromEntries(DEBATE_READS.map((name) => [name, async (ctx, args) => {
    const identity = identityOf(ctx);
    const rel = `harness/debate-budget-${identity.name}.json`;
    const assignment = assignmentOf(ctx);
    const decision = debateBudgetDecision(readJsonOr(ctx.reportDir, rel, { calls: 0 }), name, submitFor(assignment), assignment.budget || DEBATE_TOOL_BUDGET);
    writeJson(ctx.reportDir, rel, decision.record);
    if (!decision.allow) return decision.text;
    return commonHandlers[name](ctx, args);
  }]));
}

// The host writes harness/assignments/<name>.json before launch; its digest is part of the session identity,
// so a reviewer cannot pick a different cluster, round or role.
export function assignmentOf(ctx) {
  const identity = identityOf(ctx);
  const assignment = readReportJson(ctx.reportDir, `harness/assignments/${identity.name}.json`);
  if (digest(assignment) !== identity.assignmentDigest) throw new Error('Debate assignment does not match the session identity');
  return assignment;
}

export function unwrapReportJson(args) {
  if (!Object.hasOwn(args || {}, 'report_json')) return args || {};
  if (Object.keys(args).length !== 1 || typeof args.report_json !== 'string' || Buffer.byteLength(args.report_json) > 512 * 1024) throw new Error('Supply only report_json, containing the complete JSON object (maximum 512 KiB).');
  const parsed = JSON.parse(args.report_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('report_json must encode an object');
  return parsed;
}

export function requireRole(ctx, role) {
  if (ctx.role !== role) throw new Error(`This submit is unavailable outside the ${role} bridge role`);
  return identityOf(ctx);
}
