// Golden-eval metrics. A cluster hits an expected item when one of its anchors lies in the item's file and line
// range. Union keeps every cluster; majority keeps clusters reported by more than half of the reviewers that
// submitted anything; debate keeps every cluster the adjudication did not REFUTE (no silent drops).

const hits = (cluster, item) => cluster.anchors.some((a) => a.file === item.file && a.line >= item.startLine && a.line <= item.endLine);

export function retainedBy(mode, clusters, { submitters = 0, adjudication = [] } = {}) {
  if (mode === 'union') return clusters;
  if (mode === 'majority') return clusters.filter((c) => c.authors.length > submitters / 2);
  const refuted = new Set(adjudication.filter((row) => row.finalStatus === 'REFUTED').map((row) => row.clusterId));
  return clusters.filter((c) => !refuted.has(c.id));
}

// counts for one repo and one mode; rates are derived later so totals can be micro-averaged.
export function score(retained, expected) {
  const bugHits = expected.bugs.filter((bug) => retained.some((c) => hits(c, bug)));
  const decoyHits = expected.decoys.filter((decoy) => retained.some((c) => hits(c, decoy)));
  const items = [...expected.bugs, ...expected.decoys].map((item) => retained.filter((c) => hits(c, item)).length).filter((n) => n > 0);
  return {
    bugs: expected.bugs.length, decoys: expected.decoys.length, retained: retained.length,
    bugHits: bugHits.length, truePositives: retained.filter((c) => expected.bugs.some((bug) => hits(c, bug))).length,
    decoyHits: decoyHits.length, matched: items.length, matchedOnce: items.filter((n) => n === 1).length,
  };
}

export function sum(rows) {
  const keys = ['bugs', 'decoys', 'retained', 'bugHits', 'truePositives', 'decoyHits', 'matched', 'matchedOnce', 'turns', 'suspect', 'cost'];
  return Object.fromEntries(keys.map((key) => [key, rows.reduce((n, row) => n + (row[key] || 0), 0)]));
}

const ratio = (a, b) => (b ? Math.round((a / b) * 100) / 100 : 0);
export function rates(c) {
  return {
    recall: ratio(c.bugHits, c.bugs), precision: ratio(c.truePositives, c.retained), decoyFp: ratio(c.decoyHits, c.decoys),
    dedup: ratio(c.matchedOnce, c.matched), conformity: c.turns ? ratio(c.suspect, c.turns) : 0, cost: c.cost || 0,
  };
}

// OD-14 (ORCHESTRATION 7): debate ships as the default only if it beats union and majority on precision without
// losing more than one seeded bug; otherwise the default is one round (challenge only), with the reason written.
export function decideDefaultRounds({ debate, union, majority }) {
  const d = rates(debate);
  const lost = union.bugHits - debate.bugHits;
  const beatsUnion = d.precision > rates(union).precision;
  const beatsMajority = d.precision > rates(majority).precision;
  if (beatsUnion && beatsMajority && lost <= 1) {
    return { rounds: 2, reason: `debate precision ${d.precision} beats union ${rates(union).precision} and majority ${rates(majority).precision}; ${lost} seeded bug(s) lost against union (limit 1).` };
  }
  const why = [!beatsUnion && 'it does not beat union on precision', !beatsMajority && 'it does not beat majority on precision', lost > 1 && `it loses ${lost} seeded bugs against union`].filter(Boolean).join('; ');
  return { rounds: 1, reason: `two rounds are not the default because ${why}.` };
}
