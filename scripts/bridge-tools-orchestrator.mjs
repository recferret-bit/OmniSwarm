// Orchestrator role: read tools plus the judge and general-review submits. It cannot run target tests or file
// a new finding: a general review that names a cluster outside the adjudication is rejected.
import { SAFE_ANNOTATIONS, objSchema, strProp } from './bridge-tools-common.mjs';
import { assignmentOf, budgetedReadHandlers, readToolDefinitions, requireRole, unwrapReportJson } from './debate-bridge.mjs';
import { commitInbox } from './debate-inbox.mjs';
import { validate } from '../packages/schemas/index.mjs';

export const role = 'orchestrator';
const FINAL = ['CONFIRMED', 'LIKELY', 'DISPUTED', 'REFUTED', 'INSUFFICIENT_EVIDENCE'];
const SEVERITY = ['critical', 'high', 'medium', 'low', 'info'];

function submitTool(name, description, properties, required) {
  const tool = { name, description, annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({ report_json: strProp('JSON-encoded object, for CLIs that cannot send nested arrays.'), ...properties }) };
  tool.inputSchema.oneOf = [{ required: ['report_json'] }, { required }];
  return tool;
}

export function toolDefinitions() {
  const disagreement = objSchema({ clusterId: strProp(), summary: strProp() }, ['clusterId', 'summary']);
  return [
    ...readToolDefinitions(),
    submitTool('submit_adjudication', 'Commit the judgement for the assigned cluster.', {
      finalStatus: { type: 'string', enum: FINAL }, severity: { type: 'string', enum: SEVERITY }, severityReason: strProp(), rationale: strProp(),
    }, ['finalStatus', 'severity', 'rationale']),
    submitTool('submit_general_review', 'Commit the executive summary and open disagreements of the adjudicated clusters.', {
      executiveSummary: strProp(), openDisagreements: { type: 'array', items: disagreement },
    }, ['executiveSummary', 'openDisagreements']),
  ];
}

export function acceptGeneralReview(body, knownClusters) {
  const known = new Set(knownClusters || []);
  for (const row of [...(body?.topFindings || []), ...(body?.openDisagreements || [])]) {
    if (!known.has(row.clusterId)) {
      const error = new Error('new_finding_in_general_review: only adjudicated clusters may be named');
      error.code = 'new_finding_in_general_review';
      throw error;
    }
  }
  return body;
}

async function submitAdjudication(ctx, raw) {
  const identity = requireRole(ctx, role);
  const task = assignmentOf(ctx);
  if (task.kind !== 'judge') throw new Error('This session was not assigned a judgement');
  const args = unwrapReportJson(raw);
  const body = {
    clusterId: task.clusterId, finalStatus: args.finalStatus, severity: args.severity,
    ...(args.severityReason ? { severityReason: args.severityReason } : {}),
    judge: task.judge, rationale: args.rationale, validArguments: task.validArguments, discardedArguments: task.discardedArguments,
  };
  const check = validate('adjudication', body);
  if (!check.ok) throw new Error(`Invalid adjudication: ${check.errors[0]}`);
  const hash = commitInbox(ctx.reportDir, identity.name, 'judge', body);
  return `Judgement committed for ${task.clusterId}. Hash: ${hash}. Finish with a short acknowledgement.`;
}

async function submitGeneralReview(ctx, raw) {
  const identity = requireRole(ctx, role);
  const task = assignmentOf(ctx);
  if (task.kind !== 'general-review') throw new Error('This session was not assigned the general review');
  const args = unwrapReportJson(raw);
  if (typeof args.executiveSummary !== 'string' || !args.executiveSummary.trim() || args.executiveSummary.length > 8000) throw new Error('executiveSummary is required (up to 8000 characters)');
  const openDisagreements = Array.isArray(args.openDisagreements) ? args.openDisagreements : [];
  if (!openDisagreements.every((row) => typeof row?.clusterId === 'string' && typeof row.summary === 'string' && row.summary.trim())) throw new Error('openDisagreements rows need clusterId and summary');
  const body = acceptGeneralReview({ executiveSummary: args.executiveSummary.trim(), openDisagreements, ...(args.topFindings ? { topFindings: args.topFindings } : {}) }, task.clusterIds);
  const hash = commitInbox(ctx.reportDir, identity.name, 'general-review', { executiveSummary: body.executiveSummary, openDisagreements });
  return `General review committed. Hash: ${hash}. Finish with a short acknowledgement.`;
}

export const handlers = {
  ...budgetedReadHandlers((task) => (task.kind === 'general-review' ? 'submit_general_review' : 'submit_adjudication')),
  submit_adjudication: submitAdjudication,
  submit_general_review: submitGeneralReview,
};
