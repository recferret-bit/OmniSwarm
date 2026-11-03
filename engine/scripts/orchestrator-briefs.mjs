// Debate and orchestrator briefs (ORCHESTRATION 5). Review-pass briefs live in review-briefs.mjs.
// Every brief has the same four headings so a reviewer cannot wander: Objective, Output schema,
// Tools and sources, Boundaries. A brief carries one cluster only, its quoted evidence and the anonymized
// arguments so far; it never names a vendor, a model or a vote count.
export const BRIEF_HEADINGS = ['Objective', 'Output schema', 'Tools and sources', 'Boundaries'];

const DEBATE_TOOLS = 'Read the sealed source with read_file, search_code and list_files; get_audit_context gives the scope.';
const TEMPLATES = {
  challenge: {
    objective: 'Challenge this one cluster. Decide whether the cited source supports it: upheld, partial, refuted, or insufficient_evidence.',
    schema: 'debate-round', submit: 'submit_debate_turn',
  },
  'devil-advocate': {
    objective: 'You are the devil\'s advocate for this cluster. Argue the strongest case that it is a false positive, citing the control that stops it. If no such control exists in source, answer insufficient_evidence.',
    schema: 'debate-round', submit: 'submit_debate_turn',
  },
  defend: {
    objective: 'You reported this cluster. Read the challenges below. Defend it with a new citation, or concede with the citation that convinced you.',
    schema: 'debate-round', submit: 'submit_debate_turn',
  },
  rebut: {
    objective: 'A verdict changed in the defence round. Respond to it with a citation, or keep your earlier verdict.',
    schema: 'debate-round', submit: 'submit_debate_turn',
  },
  judge: {
    objective: 'Judge this cluster from the verified quotes and the valid arguments only: CONFIRMED, LIKELY, DISPUTED, REFUTED or INSUFFICIENT_EVIDENCE. You may re-calibrate severity with a reason.',
    schema: 'adjudication', submit: 'submit_adjudication',
  },
  'general-review': {
    objective: 'Write the executive summary of the adjudicated clusters listed below and name the disagreements that stayed open. Do not add a finding that was not adjudicated.',
    schema: 'general-review', submit: 'submit_general_review',
  },
};

export function briefIds() { return Object.keys(TEMPLATES); }

function evidenceLines(cluster) {
  return (cluster?.evidence || []).map((row) => `- ${row.file}:${row.startLine} ${row.valid ? `\`${row.quote}\`` : `(not checkable: ${row.reason})`}`);
}

function argumentLines(turns) {
  return (turns || []).map((turn) => `- ${turn.anonId}, round ${turn.round} (${turn.role}): ${turn.verdict}. ${turn.argument}${(turn.citations || []).length ? ` Cites ${turn.citations.map((c) => `${c.file}:${c.startLine}`).join(', ')}.` : ''}${turn.conformitySuspect ? ' [conformity suspect: the verdict changed without new evidence; it carries no weight]' : ''}`);
}

function subjectLines(id, { cluster, clusters }) {
  if (id === 'general-review') {
    return ['## Adjudicated clusters', ...(clusters || []).map((row) => `- ${row.clusterId}: ${row.finalStatus} (${row.severity}) ${row.title}`), ''];
  }
  return [`## Cluster ${cluster.id}`, `Claim: ${cluster.primaryTitle} (severity ${cluster.severity}, surface ${cluster.surface})`, 'Evidence:', ...evidenceLines(cluster), ''];
}

// id: a template id. options: {cluster, clusters, turns, anonId, round, budget}.
export function renderDebateBrief(id, { cluster = null, clusters = [], turns = [], anonId = '', round = 0, budget = 12 } = {}) {
  const template = TEMPLATES[id];
  if (!template) throw new Error(`unknown brief ${id}`);
  const you = anonId ? `You are ${anonId}${round ? ` in round ${round}` : ''}.` : '';
  return [
    `# ${id}`, '',
    '## Objective', [template.objective, you].filter(Boolean).join(' '), '',
    ...subjectLines(id, { cluster, clusters }),
    ...(turns.length ? ['## Arguments so far', ...argumentLines(turns), ''] : []),
    '## Output schema',
    `Call ${template.submit} once with fields of the ${template.schema} schema. Cite file, startLine, endLine and an exact quote, or the argument is discarded.`, '',
    '## Tools and sources', id === 'general-review' ? 'No source reads are needed; use the adjudication above.' : DEBATE_TOOLS, '',
    '## Boundaries',
    `${id === 'general-review' ? 'No new findings in this step.' : 'One cluster only; no new findings.'} insufficient_evidence is allowed. No exploits. Budget: ${budget} tool calls.`, '',
  ].join('\n');
}
