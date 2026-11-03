import fs from 'node:fs';
import path from 'node:path';
import { validCrosscheckRow } from './report-contract.mjs';
import { commitSubmission, deriveSubmission } from './audit-submission.mjs';
import { renderMarkdownFromFindings } from './bridge-tools-auditor.mjs';
import { SAFE_ANNOTATIONS, BridgeError, objSchema, strProp, strArr, normalizeCitation, commonToolDefinitions, commonHandlers } from './bridge-tools-common.mjs';

export const role = 'crosscheck';

export function normalizeCrosscheckPayload(rawVerdicts, assignedClaims) {
  const list = Array.isArray(rawVerdicts)
    ? rawVerdicts
    : rawVerdicts?.verdicts;
  if (!Array.isArray(list) || list.length !== assignedClaims.length) throw new Error('Cross-check must cover every assigned claim');
  const assigned = new Set(assignedClaims.map((claim) => claim.id));
  const byId = new Map();
  for (const row of list) {
    if (!row || !assigned.has(row.id) || byId.has(row.id) || !Array.isArray(row.evidence)) throw new Error('Unexpected, duplicate or invalid cross-check claim');
    const entry = { ...row, verdict: row.verdict?.toLowerCase(), evidence: row.evidence.map(normalizeCitation) };
    if (row.severity != null) entry.severity = row.severity.toLowerCase();
    if (!validCrosscheckRow(entry)) throw new Error(`Invalid cross-check row for ${row.id}`);
    byId.set(row.id, entry);
  }
  return assignedClaims.map((claim) => byId.get(claim.id));
}

export function toolDefinitions() {
  const submit = {
      name: 'submit_crosscheck_report',
      description: 'Validate and save the cross-check verdicts for all assigned peer claims. Call this tool before finishing.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        report_json: strProp('JSON-encoded object containing verdicts. Use this instead of nested arguments when the CLI cannot serialize object arrays.'),
        verdicts: {
          type: 'array',
          items: objSchema({
            id: strProp(),
            verdict: { type: 'string', enum: ['upheld', 'partial', 'refuted'] },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
            reason: strProp(),
            evidence: strArr(),
          }, ['id', 'verdict', 'reason', 'evidence']),
        },
      }, []),
  };
  submit.inputSchema.oneOf = [{ required: ['report_json'] }, { required: ['verdicts'] }];
  return [...commonToolDefinitions(), submit];
}

export async function submitCrosscheckReport(ctx, args) {
  const { reportDir, role, agent } = ctx;
  if (role !== 'crosscheck') throw new Error('Peer submission is unavailable in this bridge role');
  if (!agent) throw new Error('Bridge was not configured with an --agent identity');
  if (!ctx.submissionIdentity) throw new BridgeError('IDENTITY_REQUIRED', 'Peer report submission requires a submission identity; the bridge was started without --identity-file');
  let assignedClaims = [];
  const inbox = path.join(reportDir, 'crosscheck', `${agent}.json`);
  if (fs.existsSync(inbox)) assignedClaims = JSON.parse(fs.readFileSync(inbox, 'utf8'));
  const normalized = normalizeCrosscheckPayload(args.verdicts || args, assignedClaims);
  const submission = commitSubmission(reportDir, `crosscheck-${agent}`, ctx.submissionIdentity, normalized);
  deriveSubmission(reportDir, submission, renderMarkdownFromFindings);
  return `Peer report committed for ${agent}: ${normalized.length} verdicts. Submission hash: ${submission.hash}. Finish with a short acknowledgement.`;
}

export const handlers = { ...commonHandlers, submit_crosscheck_report: submitCrosscheckReport };
