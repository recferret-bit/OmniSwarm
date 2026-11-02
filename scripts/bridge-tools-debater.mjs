// Debate turns. Inspection stops at the debate tool budget; submit is always allowed.
import { SAFE_ANNOTATIONS, objSchema, strProp } from './bridge-tools-common.mjs';

export const role = 'debater';
const READS = ['get_audit_context', 'read_file', 'search_code', 'list_files'];

export function toolDefinitions() {
  return [
    ...READS.map((name) => ({ name, description: name, annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({}) })),
    { name: 'submit_debate_turn', description: 'Commit one anonymized debate turn.', annotations: SAFE_ANNOTATIONS, inputSchema: objSchema({ argument: strProp() }) },
  ];
}

export function debateBudgetDecision(record, tool, budget = 12) {
  const next = { calls: record?.calls || 0 };
  if (tool === 'submit_debate_turn') return { allow: true, record: next };
  if (next.calls >= budget) return { allow: false, text: 'budget exhausted: call submit_debate_turn now', record: next };
  next.calls += 1;
  return { allow: true, record: next };
}

export const handlers = {
  async submit_debate_turn(_ctx, args) {
    if (!args?.argument) throw new Error('argument required');
    if (args.verdict !== 'insufficient_evidence' && !(args.citations || []).length) throw new Error('citation required');
    return 'committed';
  },
};
