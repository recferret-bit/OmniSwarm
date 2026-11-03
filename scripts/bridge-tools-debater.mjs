// Debater role: the auditor's read tools behind a 12-call budget, plus one submit per assignment. The round,
// cluster, role and anonymous label come from the host-written assignment, never from the model.
import { SAFE_ANNOTATIONS, objSchema, strProp, intProp } from './bridge-tools-common.mjs';
import { assignmentOf, budgetedReadHandlers, readToolDefinitions, requireRole, unwrapReportJson } from './debate-bridge.mjs';
import { commitInbox } from './debate-inbox.mjs';
import { validate } from '../packages/schemas/index.mjs';

export const role = 'debater';
export const SUBMIT = 'submit_debate_turn';
const VERDICTS = ['upheld', 'partial', 'refuted', 'insufficient_evidence'];

export function toolDefinitions() {
  const citation = objSchema({ file: strProp('Path under /work/src'), startLine: intProp(), endLine: intProp(), quote: strProp('Exact text from those lines') }, ['file', 'startLine', 'endLine', 'quote']);
  const submit = {
    name: SUBMIT,
    description: 'Commit your one debate turn for the assigned cluster. Cite file, lines and an exact quote, or the argument is discarded.',
    annotations: SAFE_ANNOTATIONS,
    inputSchema: objSchema({
      report_json: strProp('JSON-encoded object with verdict, citations and argument, for CLIs that cannot send nested arrays.'),
      verdict: { type: 'string', enum: VERDICTS },
      citations: { type: 'array', items: citation },
      argument: strProp(),
    }),
  };
  submit.inputSchema.oneOf = [{ required: ['report_json'] }, { required: ['verdict', 'citations', 'argument'] }];
  return [...readToolDefinitions(), submit];
}

async function submitDebateTurn(ctx, raw) {
  const identity = requireRole(ctx, role);
  const task = assignmentOf(ctx);
  if (task.kind !== 'debate-turn') throw new Error('This session was not assigned a debate turn');
  const args = unwrapReportJson(raw);
  const body = {
    round: task.round, clusterId: task.clusterId, role: task.role, anonId: task.anonId,
    verdict: args.verdict, citations: args.citations, argument: args.argument, devilAdvocate: task.role === 'devil',
  };
  const check = validate('debate-round', body);
  if (!check.ok) throw new Error(`Invalid debate turn: ${check.errors[0]}`);
  if (body.verdict !== 'insufficient_evidence' && !body.citations.length) throw new Error('citation_required: cite file, lines and a quote, or answer insufficient_evidence');
  const hash = commitInbox(ctx.reportDir, identity.name, 'debate-turn', body);
  return `Debate turn committed for ${task.anonId} on ${task.clusterId} round ${task.round}. Hash: ${hash}. Finish with a short acknowledgement.`;
}

export const handlers = { ...budgetedReadHandlers(() => SUBMIT), [SUBMIT]: submitDebateTurn };
