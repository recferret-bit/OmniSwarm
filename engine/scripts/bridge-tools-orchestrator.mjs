// Orchestrator role: read tools plus the judge and general-review submits. It cannot run target tests or file
// a new finding: a general review that names a cluster outside the adjudication is rejected.
import { SAFE_ANNOTATIONS, objSchema, strProp } from './bridge-tools-common.mjs';
import { assignmentOf, budgetedReadHandlers, readToolDefinitions, requireRole, unwrapReportJson } from './debate-bridge.mjs';
import { commitInbox } from './debate-inbox.mjs';
import { validate } from '../../packages/schemas/index.mjs';

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
    submitTool('submit_stage_advice', 'Commit the Step 2 frontier evaluation of Stage 1 review quality, gaps, and debate depth recommendation.', {
      qualityRating: { type: 'string', enum: ['strong', 'adequate', 'degraded', 'incomplete'] },
      qualitySummary: strProp(),
      coverageGaps: { type: 'array', items: strProp() },
      issues: { type: 'array', items: strProp() },
      debateNeeded: { type: 'boolean' },
      recommendedDepth: { type: 'string', enum: ['none', 'shallow', 'standard', 'deep'] },
      recommendedRounds: { type: 'integer', minimum: 0, maximum: 3 },
      focusClusterIds: { type: 'array', items: strProp() },
      rationale: strProp(),
      nextSteps: { type: 'array', items: strProp() },
    }, ['qualityRating', 'qualitySummary', 'debateNeeded', 'recommendedDepth', 'recommendedRounds', 'rationale', 'nextSteps']),
  ];
}

// A verdict on the whole target ("the contract is secure"), not a statement about one control ("the cast is safe").
const CERTIFIES = /\b(?:target|repository|repo|project|code\s?base|code|application|app|system|protocol|platform|contracts?|programs?)\s+(?:is|are|appears?|looks?|seems?)\s+(?:to\s+be\s+)?(?:fully\s+|completely\s+|now\s+)?(?:secure|safe)\b|\bsafe\s+to\s+(?:deploy|ship|launch|release)\b|\b(?:production|mainnet|launch)[- ]ready\b|\bcertif(?:y|ies|ied|ication)\b|\b(?:passed|passes)\s+the\s+(?:audit|review)\b/i;
const FILE_LINE = /(?:^|[\s`'"(\[])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5}):\d+/g;

function refuse(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

// The general review may only talk about what was adjudicated. Structured rows name known clusters; the free
// text (the executive summary and each disagreement summary) is checked too, because a summary that cites a
// cluster id or a file:line nobody adjudicated is a new finding by another route, and one that calls the target
// secure is a certification this suite never gives. knownFiles: the files the adjudicated clusters cite, or
// null when the caller has no list (then file mentions are not checked).
export function acceptGeneralReview(body, knownClusters, knownFiles = null) {
  const known = new Set((knownClusters || []).map((id) => String(id).toUpperCase()));
  for (const row of [...(body?.topFindings || []), ...(body?.openDisagreements || [])]) {
    if (!known.has(String(row.clusterId).toUpperCase())) throw refuse('new_finding_in_general_review', 'only adjudicated clusters may be named');
  }
  const files = knownFiles ? new Set(knownFiles) : null;
  for (const text of [body?.executiveSummary, ...(body?.openDisagreements || []).map((row) => row.summary)].filter((t) => typeof t === 'string')) {
    for (const [id] of text.matchAll(/\bCLUSTER-\d+\b/gi)) {
      if (!known.has(id.toUpperCase())) throw refuse('new_finding_in_general_review', `the text names ${id.toUpperCase()}, which was not adjudicated`);
    }
    if (files) {
      for (const match of text.matchAll(FILE_LINE)) {
        if (!files.has(match[1])) throw refuse('new_finding_in_general_review', `the text cites ${match[1]}, which no adjudicated cluster cites; describe only adjudicated findings`);
      }
    }
    if (CERTIFIES.test(text)) throw refuse('certification_in_general_review', 'the review reports adjudicated findings and gaps; it does not state that the target is secure, safe to ship or certified');
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
  const body = acceptGeneralReview({ executiveSummary: args.executiveSummary.trim(), openDisagreements, ...(args.topFindings ? { topFindings: args.topFindings } : {}) }, task.clusterIds, Array.isArray(task.files) ? task.files : null);
  const hash = commitInbox(ctx.reportDir, identity.name, 'general-review', { executiveSummary: body.executiveSummary, openDisagreements });
  return `General review committed. Hash: ${hash}. Finish with a short acknowledgement.`;
}

async function submitStageAdvice(ctx, raw) {
  const identity = requireRole(ctx, role);
  const task = assignmentOf(ctx);
  if (task.kind !== 'stage-advice') throw new Error('This session was not assigned stage advice');
  const args = unwrapReportJson(raw);
  const canonicalByUpper = new Map((task.clusterIds || []).map((id) => [String(id).toUpperCase(), String(id)]));
  const focus = [];
  for (const rawId of Array.isArray(args.focusClusterIds) ? args.focusClusterIds : []) {
    const key = String(rawId).trim().toUpperCase();
    if (!key) continue;
    const canonical = canonicalByUpper.get(key);
    if (!canonical) throw refuse('unknown_cluster_in_advice', `focusClusterIds names ${rawId}, which is not in Stage 1 clusters`);
    if (!focus.includes(canonical)) focus.push(canonical);
  }
  const debateNeeded = Boolean(args.debateNeeded);
  const recommendedRounds = debateNeeded ? Math.max(1, Math.min(3, Number(args.recommendedRounds) || 1)) : 0;
  const recommendedDepth = debateNeeded
    ? (['shallow', 'standard', 'deep'].includes(args.recommendedDepth) ? args.recommendedDepth : (recommendedRounds === 1 ? 'shallow' : recommendedRounds === 2 ? 'standard' : 'deep'))
    : 'none';
  const texts = [args.qualitySummary, args.rationale, ...(args.coverageGaps || []), ...(args.issues || []), ...(args.nextSteps || [])].filter((t) => typeof t === 'string');
  for (const t of texts) {
    if (CERTIFIES.test(t)) throw refuse('certification_in_stage_advice', 'stage advice evaluates review quality and debate need; it must not certify the target as secure or safe to deploy');
  }
  const body = {
    stage: 'stage-2-advice',
    quality: {
      rating: args.qualityRating,
      summary: String(args.qualitySummary || '').trim(),
      coverageGaps: Array.isArray(args.coverageGaps) ? args.coverageGaps.map((s) => String(s).trim()).filter(Boolean).slice(0, 64) : [],
      issues: Array.isArray(args.issues) ? args.issues.map((s) => String(s).trim()).filter(Boolean).slice(0, 64) : [],
    },
    debateAdvice: {
      debateNeeded,
      recommendedDepth,
      recommendedRounds,
      focusClusterIds: focus.slice(0, 32),
      rationale: String(args.rationale || '').trim(),
    },
    nextSteps: (Array.isArray(args.nextSteps) ? args.nextSteps.map((s) => String(s).trim()).filter(Boolean) : []).slice(0, 16),
    generatedBy: { mode: 'model', orchestrator: task.orchestrator || identity.agent },
    disclaimer: 'Model agreement and passing checks do not certify security.',
  };
  const check = validate('orchestrator-advice', body);
  if (!check.ok) throw new Error(`Invalid orchestrator advice: ${check.errors[0]}`);
  const hash = commitInbox(ctx.reportDir, identity.name, 'stage-advice', body);
  return `Stage advice committed. Hash: ${hash}. Finish with a short acknowledgement.`;
}

export const handlers = {
  ...budgetedReadHandlers((task) => (task.kind === 'general-review' ? 'submit_general_review' : task.kind === 'stage-advice' ? 'submit_stage_advice' : 'submit_adjudication')),
  submit_adjudication: submitAdjudication,
  submit_general_review: submitGeneralReview,
  submit_stage_advice: submitStageAdvice,
};
