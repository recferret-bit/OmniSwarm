// Fixed briefs. Every template has the same four headings so a reviewer cannot wander.
const TEMPLATES = {
  'review-pass': 'Inspect the assigned surface and submit only findings you can cite.',
  challenge: 'Challenge this one cluster. Uphold, refute, or say the evidence is insufficient.',
  'devil-advocate': 'Argue the strongest case that this cluster is a false positive.',
  defend: 'Defend your finding with a new citation, or concede.',
  rebut: 'Respond only because a verdict changed. Cite a line or leave the verdict.',
  judge: 'Decide this cluster from the verified quotes only.',
  'general-review': 'Summarize the debate. Do not add a finding that was not adjudicated.',
  'merge-suggestions': 'Suggest merges only when two clusters cite the same file.',
};

const HEADINGS = ['Objective', 'Output schema', 'Tools and sources', 'Boundaries'];

export function renderBrief(id, { budget = 12 } = {}) {
  const objective = TEMPLATES[id];
  if (!objective) throw new Error(`unknown brief ${id}`);
  return [
    `# ${id}`,
    '',
    '## Objective',
    objective,
    '',
    '## Output schema',
    'Return the schema fields only. Cite file, startLine, endLine and quote, or the argument is discarded.',
    '',
    '## Tools and sources',
    'Read the sealed source with read_file, search_code and list_files. One cluster only.',
    '',
    '## Boundaries',
    `Insufficient evidence is allowed. No new findings outside this cluster. Budget: ${budget} calls.`,
    '',
  ].join('\n');
}

export function briefIds() { return Object.keys(TEMPLATES); }
export const BRIEF_HEADINGS = HEADINGS;
