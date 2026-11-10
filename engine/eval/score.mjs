// Score a finished review report against a golden answer key. Pure functions: scoreReport(rows, expected) takes
// the rows of findings-and-scores.json and an expected.json and returns counts per layer, per reviewer and per
// final status; renderScore(score) is the markdown. Used by live.mjs for runs with real models; the same numbers
// work for a scripted run.
//
// Matching: a row matches a seeded bug (or a decoy) when one of its locations is in the same file within three
// lines, the tolerance clustering uses, and that item is the nearest one to the location. A row that matches neither is "unlisted": the key does not claim to be
// complete, so an unlisted row is a finding to read, not a false positive.
import { adapterOf } from '../scripts/report-contract.mjs';
import { LINE_TOLERANCE } from '../scripts/cluster-findings.mjs';

const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];
const LAYERS = ['web2', 'web3', 'infra'];
const key = (row) => `${row.file}:${row.startLine}`;
const round = (n) => Math.round(n * 100) / 100;
const ratio = (a, b) => (b ? round(a / b) : null);

function parse(location) {
  const match = /^(.+):(\d+)$/.exec(String(location));
  return match ? { file: match[1], line: Number(match[2]) } : null;
}

// Each cited location belongs to the nearest key item within the tolerance (a seeded bug wins a tie with a decoy),
// so a finding on a bug is not also counted against a decoy that sits two lines away. A row that cites several
// places can match several items.
function matcher(items) {
  const nearest = (loc) => {
    let best = null;
    for (const item of items) {
      if (item.file !== loc.file || loc.line < item.startLine - LINE_TOLERANCE || loc.line > item.endLine + LINE_TOLERANCE) continue;
      const distance = loc.line < item.startLine ? item.startLine - loc.line : loc.line > item.endLine ? loc.line - item.endLine : 0;
      if (!best || distance < best.distance || (distance === best.distance && item.bug && !best.item.bug)) best = { item, distance };
    }
    return best?.item || null;
  };
  return (row) => new Set((row.locations || []).map(parse).filter(Boolean).map(nearest).filter(Boolean));
}

// The status that decides whether a row is still an open finding: the debate's when it ran, else the peer review's.
export const statusOf = (row) => row.finalStatus || row.status || 'UNKNOWN';
export const isRefuted = (row) => ['REFUTED', 'REFUTED_REVIEW'].includes(statusOf(row));
const reviewersOf = (row) => [...new Set((row.auditors || []).map((name) => adapterOf(name)).filter(Boolean))];

export function scoreReport(rows, expected) {
  const bugs = expected.bugs || [];
  const decoys = expected.decoys || [];
  const tagged = [...bugs.map((item) => ({ ...item, bug: true, source: item })), ...decoys.map((item) => ({ ...item, bug: false, source: item }))];
  const match = matcher(tagged);
  const hits = new Map(rows.map((row) => [row, new Set([...match(row)].map((item) => item.source))]));
  const rowsOn = (item) => rows.filter((row) => hits.get(row).has(item));
  const bugRows = new Map(bugs.map((bug) => [key(bug), rowsOn(bug)]));
  const decoyRows = new Map(decoys.map((decoy) => [key(decoy), rowsOn(decoy)]));
  const matchedBug = new Set([...bugRows.values()].flat());
  const matchedDecoy = new Set([...decoyRows.values()].flat());
  const open = (list) => list.filter((row) => !isRefuted(row));

  const found = bugs.filter((bug) => bugRows.get(key(bug)).length > 0);
  const kept = bugs.filter((bug) => open(bugRows.get(key(bug))).length > 0);
  const lost = found.filter((bug) => !kept.includes(bug));
  const decoyReported = decoys.filter((decoy) => decoyRows.get(key(decoy)).length > 0);
  const decoyKept = decoys.filter((decoy) => open(decoyRows.get(key(decoy))).length > 0);
  const unlisted = rows.filter((row) => !matchedBug.has(row) && !matchedDecoy.has(row));
  const openRows = open(rows);
  const openTrue = openRows.filter((row) => matchedBug.has(row));
  const openDecoy = openRows.filter((row) => matchedDecoy.has(row) && !matchedBug.has(row));

  const layer = (name) => {
    const of = (list) => list.filter((item) => item.layer === name);
    return {
      bugs: of(bugs).length, found: of(found).length, kept: of(kept).length, recall: ratio(of(kept).length, of(bugs).length),
      decoys: of(decoys).length, decoysReported: of(decoyReported).length, decoysKept: of(decoyKept).length,
    };
  };

  const reviewerIds = [...new Set(rows.flatMap(reviewersOf))].sort();
  const reviewers = reviewerIds.map((id) => {
    const mine = (list) => list.some((row) => reviewersOf(row).includes(id));
    const hit = bugs.filter((bug) => mine(bugRows.get(key(bug))));
    const fooled = decoys.filter((decoy) => mine(decoyRows.get(key(decoy))));
    return {
      id, found: hit.length, recall: ratio(hit.length, bugs.length), decoysReported: fooled.length,
      unlisted: unlisted.filter((row) => reviewersOf(row).includes(id)).length,
      byLayer: Object.fromEntries(LAYERS.map((name) => [name, hit.filter((bug) => bug.layer === name).length])),
      unique: hit.filter((bug) => new Set(bugRows.get(key(bug)).flatMap(reviewersOf)).size === 1).length,
    };
  });

  // Severity: the highest-severity open row on a bug against the key.
  const severity = { exact: 0, within1: 0, under: 0, over: 0 };
  for (const bug of kept) {
    const reported = Math.max(...open(bugRows.get(key(bug))).map((row) => SEVERITY.indexOf(row.severity)));
    const want = SEVERITY.indexOf(bug.severity);
    if (reported === want) severity.exact += 1;
    if (Math.abs(reported - want) <= 1) severity.within1 += 1;
    if (reported < want - 1) severity.under += 1;
    if (reported > want + 1) severity.over += 1;
  }

  const statuses = (list) => Object.fromEntries([...new Set(list.map(statusOf))].sort().map((status) => [status, list.filter((row) => statusOf(row) === status).length]));
  const layerMismatch = rows.filter((row) => row.layer && [...bugRows.entries()].some(([id, list]) => list.includes(row) && bugs.find((bug) => key(bug) === id).layer !== row.layer)).length;

  return {
    totals: {
      rows: rows.length, openRows: openRows.length, bugs: bugs.length, found: found.length, kept: kept.length,
      recallReported: ratio(found.length, bugs.length), recall: ratio(kept.length, bugs.length),
      decoys: decoys.length, decoysReported: decoyReported.length, decoysKept: decoyKept.length, decoyFalsePositiveRate: ratio(decoyKept.length, decoys.length),
      unlisted: unlisted.length, unlistedOpen: open(unlisted).length,
      // Precision against the key: open rows on a seeded bug over open rows on a bug or a decoy. Unlisted rows are left out.
      precisionOnKey: ratio(openTrue.length, openTrue.length + openDecoy.length),
      lostInDebate: lost.length, layerMismatch,
      // Grouping: rows per reported seeded bug (1 is ideal; many means one defect is still debated as several), and rows
      // whose cited places touch more than one seeded bug (an upper bound: a row also lists its context locations).
      rowsPerBug: found.length ? Number((found.reduce((sum, bug) => sum + bugRows.get(key(bug)).length, 0) / found.length).toFixed(2)) : null,
      multiBugRows: rows.filter((row) => [...hits.get(row)].filter((item) => item.bug).length > 1).length,
    },
    layers: Object.fromEntries(LAYERS.map((name) => [name, layer(name)])),
    reviewers,
    severity,
    statuses: { bugs: statuses([...matchedBug]), decoys: statuses([...matchedDecoy].filter((row) => !matchedBug.has(row))), unlisted: statuses(unlisted) },
    missed: bugs.filter((bug) => !found.includes(bug)).map((bug) => ({ at: key(bug), layer: bug.layer, severity: bug.severity, class: bug.class, title: bug.title })),
    lost: lost.map((bug) => ({ at: key(bug), layer: bug.layer, severity: bug.severity, title: bug.title, statuses: bugRows.get(key(bug)).map(statusOf) })),
    decoysKept: decoyKept.map((decoy) => ({ at: key(decoy), layer: decoy.layer, claim: decoy.claim, statuses: open(decoyRows.get(key(decoy))).map(statusOf) })),
    unlisted: unlisted.map((row) => ({ title: row.title, severity: row.severity, status: statusOf(row), layer: row.layer || null, at: (row.locations || [])[0] || null, reviewers: reviewersOf(row) })),
  };
}

const pct = (value) => (value == null ? 'n/a' : `${Math.round(value * 100)}%`);

export function renderScore(score, { title = 'Live eval' } = {}) {
  const t = score.totals;
  const lines = [
    `# ${title}`, '',
    `Seeded bugs kept after review and debate: **${t.kept} of ${t.bugs}** (recall ${pct(t.recall)}; ${t.found} were reported, ${t.lostInDebate} lost in the debate).`,
    `Decoys still open: **${t.decoysKept} of ${t.decoys}** (${t.decoysReported} were reported). Precision on the answer key: ${pct(t.precisionOnKey)}.`,
    `Grouping: ${t.rowsPerBug ?? 'n/a'} rows per reported seeded bug; ${t.multiBugRows} row(s) cite places of more than one seeded bug (upper bound: context locations count).`,
    `Rows: ${t.rows} clusters, ${t.openRows} open. ${t.unlisted} match neither a seeded bug nor a decoy (${t.unlistedOpen} open): read them, the key is not complete.`,
    `Severity of kept bugs: ${score.severity.exact} exact, ${score.severity.within1} within one step, ${score.severity.under} under-rated by two or more, ${score.severity.over} over-rated by two or more. Layer tag differs from the key on ${t.layerMismatch} row(s).`,
    '', '## By layer', '', '| Layer | Seeded | Reported | Kept | Recall | Decoys reported | Decoys kept |', '|---|---:|---:|---:|---:|---:|---:|',
    ...Object.entries(score.layers).map(([name, row]) => `| ${name} | ${row.bugs} | ${row.found} | ${row.kept} | ${pct(row.recall)} | ${row.decoysReported} of ${row.decoys} | ${row.decoysKept} |`),
    '', '## By reviewer', '', '| Reviewer | Bugs found | Recall | web2 | web3 | infra | Only this reviewer | Decoys reported | Unlisted |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...score.reviewers.map((row) => `| ${row.id} | ${row.found} | ${pct(row.recall)} | ${row.byLayer.web2} | ${row.byLayer.web3} | ${row.byLayer.infra} | ${row.unique} | ${row.decoysReported} | ${row.unlisted} |`),
    '', '## Final status', '', `- Rows on seeded bugs: ${JSON.stringify(score.statuses.bugs)}`, `- Rows on decoys: ${JSON.stringify(score.statuses.decoys)}`, `- Unlisted rows: ${JSON.stringify(score.statuses.unlisted)}`,
  ];
  const list = (heading, rows, format) => { if (rows.length) lines.push('', `## ${heading} (${rows.length})`, '', ...rows.map(format)); };
  list('Missed', score.missed, (row) => `- ${row.at} [${row.layer}, ${row.severity}] ${row.title}`);
  list('Reported, then lost in the debate', score.lost, (row) => `- ${row.at} [${row.layer}, ${row.severity}] ${row.title} (${row.statuses.join(', ')})`);
  list('Decoys still open', score.decoysKept, (row) => `- ${row.at} [${row.layer}] ${row.claim} (${row.statuses.join(', ')})`);
  list('Unlisted rows', score.unlisted, (row) => `- ${row.at || 'no location'} [${row.layer || '?'}, ${row.severity}, ${row.status}] ${row.title} (${row.reviewers.join(', ')})`);
  return `${lines.join('\n')}\n`;
}
