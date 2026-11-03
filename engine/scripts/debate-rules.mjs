// Argument rules (ORCHESTRATION 4.2) and the evidence floor every verdict must respect (4.3).
// - An argument with no valid citation is discarded (insufficient_evidence needs none).
// - A verdict change whose valid citations were all presented earlier in the cluster is kept but marked
//   conformity_suspect and carries no weight.
export const citationKey = (row) => `${row.file}:${row.startLine}-${row.endLine}`;

// turn: {verdict, citations (already checked)}; seen: citation keys presented earlier in this cluster;
// previous: this speaker's previous verdict on the cluster (authors start at "upheld").
export function classifyArgument(turn, { seen = new Set(), previous = null } = {}) {
  const valid = (turn.citations || []).filter((citation) => citation.valid);
  const verdictChanged = previous != null && turn.verdict !== previous;
  if (turn.verdict === 'insufficient_evidence') return { ...turn, verdictChanged, discarded: false, conformitySuspect: false };
  if (!valid.length) return { ...turn, verdictChanged, discarded: true, reason: 'no_valid_citation', conformitySuspect: verdictChanged };
  const fresh = valid.filter((citation) => !seen.has(citationKey(citation)));
  return { ...turn, verdictChanged, discarded: false, conformitySuspect: verdictChanged && !fresh.length };
}

export function judgeVisible(turns) {
  return turns.filter((turn) => !turn.discarded && !turn.conformitySuspect);
}

const SUPPORT = new Set(['upheld', 'partial']);

// The status the verified evidence supports. An LLM judge may not go past it (see debate-judge.mjs).
export function rulesVerdict(cluster, turns) {
  if (cluster.status === 'AGREED') return 'CONFIRMED';
  const visible = judgeVisible(turns);
  const refuted = visible.some((turn) => turn.verdict === 'refuted');
  const upheld = visible.filter((turn) => SUPPORT.has(turn.verdict));
  if (!cluster.citationsOk) return refuted ? 'REFUTED' : 'INSUFFICIENT_EVIDENCE';
  if (refuted && upheld.length) return 'DISPUTED';
  if (refuted) return 'REFUTED';
  const authors = new Set(cluster.vendors);
  if (upheld.some((turn) => turn.speakerVendor && !authors.has(turn.speakerVendor))) return 'CONFIRMED';
  return 'LIKELY';
}

// Statuses an argument set can support. LIKELY and INSUFFICIENT_EVIDENCE are always allowed: they keep the finding.
export function allowedVerdicts(cluster, turns) {
  const mechanical = rulesVerdict(cluster, turns);
  const visible = judgeVisible(turns);
  const allowed = new Set([mechanical, 'INSUFFICIENT_EVIDENCE']);
  if (cluster.citationsOk) allowed.add('LIKELY');
  if (visible.some((turn) => turn.verdict === 'refuted')) { allowed.add('REFUTED'); allowed.add('DISPUTED'); }
  return allowed;
}
