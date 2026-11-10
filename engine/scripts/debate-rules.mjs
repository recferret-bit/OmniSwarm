// Argument rules (ORCHESTRATION 4.2) and the evidence floor every verdict must respect (4.3).
// - An argument with no valid citation is discarded (insufficient_evidence needs none).
// - A verdict change whose valid citations were all presented earlier in the cluster is kept but marked
//   conformity_suspect and carries no weight.
export const citationKey = (row) => `${row.file}:${row.startLine}-${row.endLine}`;

// A citation is fresh when its lines overlap nothing presented earlier in the cluster. Comparing the exact
// `file:start-end` key would let line 12 pass as new evidence when it is cited again as 11-12.
function overlapsSeen(citation, seen) {
  const start = Number(citation.startLine);
  const end = Number(citation.endLine ?? start);
  for (const key of seen) {
    const match = /^(.*):(\d+)-(\d+)$/.exec(key);
    if (match && match[1] === citation.file && start <= Number(match[3]) && end >= Number(match[2])) return true;
  }
  return false;
}

// turn: {verdict, citations (already checked)}; seen: citation keys presented earlier in this cluster;
// previous: this speaker's previous verdict on the cluster (authors start at "upheld").
export function classifyArgument(turn, { seen = new Set(), previous = null } = {}) {
  const valid = (turn.citations || []).filter((citation) => citation.valid);
  const verdictChanged = previous != null && turn.verdict !== previous;
  if (turn.verdict === 'insufficient_evidence') return { ...turn, verdictChanged, discarded: false, conformitySuspect: false };
  if (!valid.length) return { ...turn, verdictChanged, discarded: true, reason: 'no_valid_citation', conformitySuspect: verdictChanged };
  const fresh = valid.filter((citation) => !overlapsSeen(citation, seen));
  // A defence that only repeats lines the cluster already holds adds nothing: an author always upholds itself,
  // so without new evidence the turn cannot turn a counted refutation into a dispute.
  if (turn.role === 'defend' && !verdictChanged && !fresh.length) return { ...turn, verdictChanged, discarded: true, reason: 'no_fresh_citation', conformitySuspect: false };
  return { ...turn, verdictChanged, discarded: false, conformitySuspect: verdictChanged && !fresh.length };
}

export function judgeVisible(turns) {
  return turns.filter((turn) => !turn.discarded && !turn.conformitySuspect);
}

const SUPPORT = new Set(['upheld', 'partial']);

// Each speaker's standing verdict: the last turn that counts. A challenger who refuted in round 1 and upheld in
// round 3 supports the finding; it is not both a refutation and a support.
function standing(turns) {
  const last = new Map();
  judgeVisible(turns).forEach((turn, index) => {
    const key = `${turn.speaker || turn.anonId || `turn-${index}`}${turn.role === 'devil' ? ':devil' : ''}`;
    const have = last.get(key);
    if (!have || (turn.round || 0) >= (have.round || 0)) last.set(key, turn);
  });
  return [...last.values()];
}

// The status the verified evidence supports. An LLM judge may not go past it (see debate-judge.mjs).
// The devil's advocate is an advocate, not a voter: its brief requires the false-positive case, so its verdict is
// never tallied. A valid devil refutation that no other vendor's support answers leaves the cluster DISPUTED for a
// judge to weigh; it cannot refute a finding by itself and it cannot confirm one.
export function rulesVerdict(cluster, turns) {
  if (cluster.status === 'AGREED') return 'CONFIRMED';
  const visible = standing(turns);
  const honest = visible.filter((turn) => turn.role !== 'devil');
  const refuted = honest.some((turn) => turn.verdict === 'refuted');
  const upheld = honest.filter((turn) => SUPPORT.has(turn.verdict));
  if (!cluster.citationsOk) return refuted ? 'REFUTED' : 'INSUFFICIENT_EVIDENCE';
  if (refuted && upheld.length) return 'DISPUTED';
  if (refuted) return 'REFUTED';
  const authors = new Set(cluster.vendors);
  if (upheld.some((turn) => turn.speakerVendor && !authors.has(turn.speakerVendor))) return 'CONFIRMED';
  if (visible.some((turn) => turn.role === 'devil' && turn.verdict === 'refuted')) return 'DISPUTED';
  return 'LIKELY';
}

// Statuses a model judge may return for an argument set.
// - The mechanical status is always allowed.
// - INSUFFICIENT_EVIDENCE only when a cited line could not be checked: a judge cannot set aside a finding whose
//   citations all verified by calling the evidence insufficient.
// - With a counted refutation the judge may also answer REFUTED or DISPUTED.
// - LIKELY (the finding is kept) is allowed without a refutation, when counted support stands against the
//   refutation (the judge resolves the dispute), or when every counted refutation came from the devil's advocate,
//   whose brief requires it to argue the false-positive case. An unanswered refutation from an ordinary
//   challenger cannot be raised to LIKELY.
export function allowedVerdicts(cluster, turns) {
  const mechanical = rulesVerdict(cluster, turns);
  const visible = standing(turns);
  const refutations = visible.filter((turn) => turn.verdict === 'refuted');
  const supported = visible.some((turn) => turn.role !== 'devil' && SUPPORT.has(turn.verdict));
  const allowed = new Set([mechanical]);
  if (!cluster.citationsOk) allowed.add('INSUFFICIENT_EVIDENCE');
  if (refutations.length) { allowed.add('REFUTED'); allowed.add('DISPUTED'); }
  if (cluster.citationsOk && (supported || refutations.every((turn) => turn.role === 'devil'))) allowed.add('LIKELY');
  return allowed;
}
