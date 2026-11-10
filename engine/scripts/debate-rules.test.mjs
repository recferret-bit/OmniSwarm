import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedVerdicts, classifyArgument, rulesVerdict } from './debate-rules.mjs';
import { adjudicateCluster, adjudicateWithRetry, pickReplacementJudge } from './debate-judge.mjs';
import { stripIdentity } from './debate-anonymize.mjs';
import { checkCitation, checkTurnCitations, sourceReader } from './debate-citations.mjs';
import { debatePlan } from './debate-plan.mjs';
import { adjudicateStage } from './debate-run.mjs';
import { runRounds } from './debate-rounds.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { finding, phaseContext, reportRun, sourceTree, tempDir } from './debate-test-run.mjs';

const cluster = (extra = {}) => ({ id: 'CLUSTER-1', status: 'QUEUED', citationsOk: true, vendors: ['v1'], severity: 'high', ...extra });
const turn = (speaker, round, role, verdict, extra = {}) => ({ speaker, speakerVendor: extra.vendor || speaker, anonId: speaker, round, role, verdict, discarded: false, conformitySuspect: false, ...extra });
const cite = (startLine, endLine = startLine) => ({ file: 'a.rs', startLine, endLine, quote: 'x', valid: true });
const judge = { reviewer: { id: 'j', vendor: 'v9' }, record: { reviewerId: 'j', vendor: 'v9', alternate: false } };
const judged = (cl, turns, body) => adjudicateCluster(cl, turns, judge, () => async () => body).then((r) => r.row);

test('a flip that re-cites a known line inside a wider range is still a conformity suspect', () => {
  const seen = new Set(['a.rs:12-12']);
  assert.equal(classifyArgument({ verdict: 'refuted', citations: [cite(12)] }, { seen, previous: 'upheld' }).conformitySuspect, true);
  assert.equal(classifyArgument({ verdict: 'refuted', citations: [cite(11, 12)] }, { seen, previous: 'upheld' }).conformitySuspect, true);
  assert.equal(classifyArgument({ verdict: 'refuted', citations: [cite(20, 22)] }, { seen, previous: 'upheld' }).conformitySuspect, false);
});

test('a defence that only repeats the cluster\'s own lines is discarded and cannot block a refutation', () => {
  const seen = new Set(['a.rs:12-12']);
  const stale = classifyArgument({ role: 'defend', verdict: 'upheld', citations: [cite(12)] }, { seen, previous: 'upheld' });
  assert.deepEqual([stale.discarded, stale.reason], [true, 'no_fresh_citation']);
  const fresh = classifyArgument({ role: 'defend', verdict: 'upheld', citations: [cite(30)] }, { seen, previous: 'upheld' });
  assert.equal(fresh.discarded, false);
  const refutation = turn('c1', 1, 'challenge', 'refuted');
  assert.equal(rulesVerdict(cluster(), [refutation, { ...turn('a1', 2, 'defend', 'upheld', { vendor: 'v1' }), ...stale }]), 'REFUTED');
  assert.equal(rulesVerdict(cluster(), [refutation, { ...turn('a1', 2, 'defend', 'upheld', { vendor: 'v1' }), ...fresh }]), 'DISPUTED');
});

test('only a speaker\'s last counted verdict stands', () => {
  const turns = [turn('c1', 1, 'challenge', 'refuted', { vendor: 'v2' }), turn('c1', 3, 'rebut', 'upheld', { vendor: 'v2' })];
  assert.equal(rulesVerdict(cluster(), turns), 'CONFIRMED');
  // A later turn that carries no weight does not replace the earlier one.
  assert.equal(rulesVerdict(cluster(), [turns[0], { ...turns[1], conformitySuspect: true }]), 'REFUTED');
});

test('the judge cannot call verified evidence insufficient, nor keep a finding against an unanswered refutation', async () => {
  assert.deepEqual([...allowedVerdicts(cluster(), [])], ['LIKELY']);
  assert.equal((await judged(cluster(), [], { finalStatus: 'INSUFFICIENT_EVIDENCE', rationale: 'r' })).finalStatus, 'LIKELY');
  assert.equal(allowedVerdicts(cluster({ citationsOk: false }), []).has('INSUFFICIENT_EVIDENCE'), true);
  const ordinary = [turn('c1', 1, 'challenge', 'refuted')];
  assert.equal((await judged(cluster(), ordinary, { finalStatus: 'LIKELY', rationale: 'r' })).finalStatus, 'REFUTED');
  // The devil's advocate is told to argue the false-positive case, so a judge may overrule it.
  const devil = [turn('c1', 1, 'devil', 'refuted')];
  assert.equal((await judged(cluster(), devil, { finalStatus: 'LIKELY', rationale: 'r' })).finalStatus, 'LIKELY');
  // Counted support against a refutation is a dispute the judge may resolve either way.
  const disputed = [...ordinary, turn('c2', 1, 'challenge', 'upheld', { vendor: 'v1' })];
  assert.equal((await judged(cluster(), disputed, { finalStatus: 'LIKELY', rationale: 'r' })).finalStatus, 'LIKELY');
  assert.equal((await judged(cluster(), disputed, { finalStatus: 'CONFIRMED', rationale: 'r' })).finalStatus, 'DISPUTED');
});

test('a severity downgrade without a reason is not applied', async () => {
  const silent = await judged(cluster({ severity: 'critical' }), [], { finalStatus: 'LIKELY', severity: 'info', rationale: 'r' });
  assert.equal(silent.severity, 'critical');
  assert.match(silent.severityReason, /proposed info without a reason/);
  const reasoned = await judged(cluster({ severity: 'critical' }), [], { finalStatus: 'LIKELY', severity: 'medium', severityReason: 'Needs the owner key.', rationale: 'r' });
  assert.deepEqual([reasoned.severity, reasoned.severityReason], ['medium', 'Needs the owner key.']);
  const raised = await judged(cluster({ severity: 'low' }), [], { finalStatus: 'LIKELY', severity: 'high', rationale: 'r' });
  assert.equal(raised.severity, 'high');
});

test('a citation is judged on the lines its quote occupies, and a trivial quote proves nothing', () => {
  const lines = Array.from({ length: 450 }, (_, i) => (i === 399 ? 'fn far_away() { transfer_all(); }' : `let v${i} = ${i};`));
  const reader = sourceReader(sourceTree({ 'a.rs': lines.join('\n') }));
  const anchors = [{ file: 'a.rs', line: 5 }];
  // The range touches the anchor, the quote sits 395 lines away.
  const [wide] = checkTurnCitations(reader, [{ file: 'a.rs', startLine: 3, endLine: 401, quote: 'transfer_all();' }], anchors);
  assert.deepEqual([wide.valid, wide.reason], [false, 'not_about_this_cluster']);
  const [near] = checkTurnCitations(reader, [{ file: 'a.rs', startLine: 3, endLine: 401, quote: 'let v5 = 5;' }], anchors);
  assert.equal(near.valid, true);
  assert.equal(checkCitation(reader, { file: 'a.rs', startLine: 1, endLine: 401, quote: 'let v5 = 5;' }).reason, 'line_out_of_range');
  assert.equal(checkCitation(reader, { file: 'a.rs', startLine: 1, endLine: 400, quote: 'let v5 = 5;' }).valid, true);
  assert.equal(checkCitation(reader, { file: 'a.rs', startLine: 5, endLine: 6, quote: ';' }).reason, 'quote_too_short');
});

test('model family words are scrubbed from arguments and ordinary words are kept', () => {
  assert.equal(stripIdentity('As Opus and GPT-6.1 noted, the SOL transfer is unchecked.'), 'As a reviewer and a reviewer noted, the SOL transfer is unchecked.');
});

test('a capped cluster is adjudicated from its citations instead of being left out', async () => {
  const out = tempDir('debate-capped-');
  const capped = cluster({ status: 'CAPPED', severity: 'critical' });
  const state = await adjudicateStage({ out }, { clusters: [capped], debated: new Map(), gaps: [], trace: [] });
  assert.deepEqual(state.rows.map((row) => [row.clusterId, row.finalStatus, row.severity, row.judge.reviewerId]), [['CLUSTER-1', 'LIKELY', 'critical', 'rules']]);
  assert.match(state.rows[0].rationale, /debate_cap/);
});

test('a real target without its sealed manifest does not start the debate', () => {
  const target = sourceTree({ 'src/a.rs': 'fn a() {}\n' });
  const { out, reviewers } = reportRun(['cli:claude:opus', 'cli:codex:gpt-6.1-sol'], { 'cli-claude-opus': { findings: [finding('Bug', ['src/a.rs:1'])] } });
  const ctx = { ...phaseContext({ out: tempDir('unused-'), reviewers, target, orchestrator: 'cli:claude:opus' }), output: out };
  assert.throws(() => debatePlan(ctx, {}), (error) => error.code === 'source_manifest_missing');
});

test('a quote in the next block is not about this cluster even when it is three lines away', () => {
  const compose = ['services:', '  db:', '    ports:', '      - "0.0.0.0:5432:5432"', '', '  proxy:', '    image: nginx:1.27.2@sha256:abc', '    read_only: true'].join('\n');
  const reader = sourceReader(sourceTree({ 'compose.yml': compose }));
  const anchors = [{ file: 'compose.yml', line: 4 }];
  const [next] = checkTurnCitations(reader, [{ file: 'compose.yml', startLine: 7, endLine: 7, quote: 'image: nginx:1.27.2@sha256:abc' }], anchors);
  assert.deepEqual([next.valid, next.reason], [false, 'not_about_this_cluster']);
  const [same] = checkTurnCitations(reader, [{ file: 'compose.yml', startLine: 3, endLine: 3, quote: 'ports:' }], anchors);
  assert.equal(same.valid, true);
});

test('the devil\'s advocate is an advocate, not a voter', () => {
  const devil = turn('c1', 1, 'devil', 'refuted', { vendor: 'v2' });
  // Alone it cannot refute a finding; it leaves a dispute for the judge.
  assert.equal(rulesVerdict(cluster(), [devil]), 'DISPUTED');
  assert.deepEqual([...allowedVerdicts(cluster(), [devil])].sort(), ['DISPUTED', 'LIKELY', 'REFUTED']);
  // The same reviewer's own verdict is what counts, whatever it argued as devil.
  assert.equal(rulesVerdict(cluster(), [turn('c1', 1, 'challenge', 'upheld', { vendor: 'v2' }), devil]), 'CONFIRMED');
  assert.equal(rulesVerdict(cluster(), [turn('c1', 1, 'challenge', 'refuted', { vendor: 'v2' }), devil]), 'REFUTED');
  // A devil that upholds does not confirm anything either.
  assert.equal(rulesVerdict(cluster(), [turn('c1', 1, 'devil', 'upheld', { vendor: 'v2' })]), 'LIKELY');
  // An author's own defence does not make the devil's point go away.
  assert.equal(rulesVerdict(cluster(), [devil, turn('a1', 2, 'defend', 'upheld', { vendor: 'v1' })]), 'DISPUTED');
});

test('round 1 is independent and the devil speaks a separate turn after the challenger\'s own', async () => {
  const root = sourceTree({ 'src/a.rs': 'fn pay() {\n    transfer(amount);\n    check_owner();\n}\n' });
  const out = tempDir('debate-devil-');
  const row = { id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', authors: ['author'], vendors: ['v1'], citationsOk: true,
    anchors: [{ file: 'src/a.rs', line: 2 }], evidence: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);', valid: true }] };
  const seen = [];
  const speaker = (id) => async ({ role, round, turns }) => {
    seen.push({ id, role, round, shown: turns.length });
    if (id === 'silent') return { unavailable: 'nothing_committed' };
    if (role === 'devil') return { verdict: 'refuted', argument: 'The owner is checked.', citations: [{ file: 'src/a.rs', startLine: 3, endLine: 3, quote: 'check_owner();' }] };
    return { verdict: 'upheld', argument: 'The transfer comes first.', citations: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);' }] };
  };
  const voices = new Map(['author', 'silent', 'peer'].map((id) => [id, speaker(id)]));
  const result = await runRounds({ out, clusters: [row], voices, vendors: new Map([['author', 'v1'], ['silent', 'v2'], ['peer', 'v3']]), reader: sourceReader(root), rounds: 1 });
  // The reviewer that did not answer is not asked again as devil; the one that did speaks twice, seeing no other turn.
  assert.deepEqual(seen, [
    { id: 'silent', role: 'challenge', round: 1, shown: 0 },
    { id: 'peer', role: 'challenge', round: 1, shown: 0 },
    { id: 'peer', role: 'devil', round: 1, shown: 0 },
  ]);
  const { turns } = result.debated.get('CLUSTER-1');
  assert.deepEqual(turns.map((t) => [t.role, t.verdict, t.conformitySuspect]), [['challenge', 'upheld', false], ['devil', 'refuted', false]]);
  assert.equal(rulesVerdict(row, turns), 'CONFIRMED');
  const files = fs.readdirSync(path.join(out, 'debate', 'round-1')).sort();
  assert.equal(files.length, 2);
  assert.equal(files.filter((name) => /^Reviewer [A-Z]-CLUSTER-1-devil\.json$/.test(name)).length, 1);
});

const quiet = (verdict) => async () => ({ verdict, argument: 'Read the line.', citations: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);' }] });
const payCluster = { id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', authors: ['author'], vendors: ['v1'], citationsOk: true,
  anchors: [{ file: 'src/a.rs', line: 2 }], evidence: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);', valid: true }] };
const payReader = () => sourceReader(sourceTree({ 'src/a.rs': 'fn pay() {\n    transfer(amount);\n}\n' }));

test('the reviewer that will judge a cluster does not argue on it', async () => {
  const voices = new Map(['author', 'judge', 'peer'].map((id) => [id, quiet('upheld')]));
  const vendors = new Map([['author', 'v1'], ['judge', 'v2'], ['peer', 'v3']]);
  const result = await runRounds({ out: tempDir('debate-judge-'), clusters: [payCluster], voices, vendors, reader: payReader(), rounds: 1, judgeOf: () => 'judge' });
  const { turns, map } = result.debated.get('CLUSTER-1');
  assert.deepEqual([...new Set(turns.map((t) => t.speaker))], ['peer']);
  assert.equal(map.judge, undefined, 'the judge gets no debate label');
  assert.deepEqual(result.trace.filter((row) => row.template === 'judge-reserved').map((row) => row.judge), ['judge']);
});

test('the judge still challenges when it is the only other reviewer, and an author or outsider judge changes nothing', async () => {
  const vendors = new Map([['author', 'v1'], ['judge', 'v2'], ['peer', 'v3']]);
  const speakers = async (ids, judgeOf) => {
    const voices = new Map(ids.map((id) => [id, quiet('upheld')]));
    const result = await runRounds({ out: tempDir('debate-judge-'), clusters: [payCluster], voices, vendors, reader: payReader(), rounds: 1, judgeOf });
    return { who: [...new Set(result.debated.get('CLUSTER-1').turns.map((t) => t.speaker))].sort(), reserved: result.trace.filter((row) => row.template === 'judge-reserved').length };
  };
  // Two-model panel: reserving the judge would leave nobody to test the finding.
  assert.deepEqual(await speakers(['author', 'judge'], () => 'judge'), { who: ['judge'], reserved: 0 });
  // A judge outside the panel, no judge, or the rules judge: every non-author challenges.
  assert.deepEqual(await speakers(['author', 'judge', 'peer'], () => 'outsider'), { who: ['judge', 'peer'], reserved: 0 });
  assert.deepEqual(await speakers(['author', 'judge', 'peer'], () => null), { who: ['judge', 'peer'], reserved: 0 });
  assert.deepEqual(await speakers(['author', 'judge', 'peer']), { who: ['judge', 'peer'], reserved: 0 });
});

test('a replacement judge is never a reviewer that argued on the cluster', async () => {
  const r = (id, vendor) => ({ id, vendor, model: id, family: 'cli' });
  const [first, argued, fresh] = [r('first', 'v2'), r('argued', 'v3'), r('fresh', 'v4')];
  const row = cluster();
  assert.equal(pickReplacementJudge(row, { reviewers: [argued, fresh], exclude: [first], spoke: ['argued'] }).reviewer.id, 'fresh');
  assert.equal(pickReplacementJudge(row, { reviewers: [argued], exclude: [first], spoke: ['argued'] }), null);
  assert.equal(pickReplacementJudge(row, { reviewers: [argued], exclude: [first] }).reviewer.id, 'argued');
  // End to end: the first judge stays disputed; the only other reviewer argued, so there is no second judgement.
  const turns = [turn('argued', 1, 'challenge', 'refuted', { vendor: 'v3' }), turn('a1', 2, 'defend', 'upheld', { vendor: 'v1' })];
  const asked = [];
  const plan = { orchestrator: first, reviewers: [first, argued], turnMs: 1000, judgeVoice: (choice) => async () => { asked.push(choice.reviewer.id); return { finalStatus: 'DISPUTED', rationale: 'Both sides cite the line.' }; } };
  const judgedRow = await adjudicateWithRetry(row, turns, plan);
  assert.deepEqual(asked, ['first']);
  assert.equal(judgedRow.row.finalStatus, 'DISPUTED');
  assert.equal(judgedRow.trace.length, 1);
});

test('a reviewer of the author\'s vendor does not challenge, defend by proxy or play devil', async () => {
  const voices = new Map(['author', 'sibling', 'peer'].map((id) => [id, quiet('upheld')]));
  const vendors = new Map([['author', 'v1'], ['sibling', 'v1'], ['peer', 'v3']]);
  const result = await runRounds({ out: tempDir('debate-sibling-'), clusters: [payCluster], voices, vendors, reader: payReader(), rounds: 1 });
  const { turns, map } = result.debated.get('CLUSTER-1');
  assert.deepEqual([...new Set(turns.map((t) => t.speaker))], ['peer']);
  assert.equal(map.sibling, undefined);
  assert.deepEqual(result.trace.filter((row) => row.template === 'same-vendor').map((row) => row.count), [1]);
  // With only a sibling on the panel nobody independent is left: the finding stays single-source.
  const alone = await runRounds({ out: tempDir('debate-sibling-'), clusters: [payCluster], voices: new Map(['author', 'sibling'].map((id) => [id, quiet('upheld')])), vendors, reader: payReader(), rounds: 1 });
  assert.deepEqual(alone.debated.get('CLUSTER-1').turns, []);
  assert.equal(rulesVerdict(payCluster, alone.debated.get('CLUSTER-1').turns), 'LIKELY');
});

test('other vendors, reviewers with no recorded vendor and scripted reviewers all still challenge', async () => {
  const who = async (ids, vendors, row = payCluster) => {
    const result = await runRounds({ out: tempDir('debate-sibling-'), clusters: [row], voices: new Map(ids.map((id) => [id, quiet('upheld')])), vendors, reader: payReader(), rounds: 1 });
    return [...new Set(result.debated.get('CLUSTER-1').turns.map((t) => t.speaker))].sort();
  };
  assert.deepEqual(await who(['author', 'b', 'c'], new Map([['author', 'v1'], ['b', 'v2'], ['c', 'v3']])), ['b', 'c']);
  assert.deepEqual(await who(['author', 'b', 'c'], new Map()), ['b', 'c']);
  // The scripted panel shares the vendor "scripted"; it is a stand-in for separate reviewers.
  const scripted = new Map([['author', 'scripted'], ['b', 'scripted'], ['c', 'scripted']]);
  assert.deepEqual(await who(['author', 'b', 'c'], scripted, { ...payCluster, vendors: ['scripted'] }), ['b', 'c']);
});

// Round-3 trigger. Lines: 1 fn, 2 transfer (the finding), 3 guard A, 4 guard B.
const guarded = () => sourceReader(sourceTree({ 'src/a.rs': 'fn pay() {\n    transfer(amount);\n    require_owner();\n    require_nonzero(amount);\n}\n' }));
const at = (line, quote) => [{ file: 'src/a.rs', startLine: line, endLine: line, quote }];
async function threeRounds(defence) {
  const calls = [];
  const voices = new Map([
    ['author', async ({ round }) => { calls.push(`author:${round}`); return defence; }],
    ['peer', async ({ round, role }) => { calls.push(`peer:${round}:${role}`); return { verdict: 'refuted', argument: 'The owner is required.', citations: at(3, 'require_owner();') }; }],
  ]);
  const result = await runRounds({ out: tempDir('debate-r3-'), clusters: [payCluster], voices, vendors: new Map([['author', 'v1'], ['peer', 'v2']]), reader: guarded(), rounds: 3 });
  return { calls, turns: result.debated.get('CLUSTER-1').turns };
}

test('round 3 runs when a defence brings new evidence', async () => {
  const { calls, turns } = await threeRounds({ verdict: 'upheld', argument: 'That guard is after the transfer; this one too.', citations: at(4, 'require_nonzero(amount);') });
  assert.deepEqual(calls, ['peer:1:challenge', 'author:2', 'peer:3:rebut']);
  assert.equal(turns.find((t) => t.round === 2).discarded, false);
});

test('round 3 does not run after a concession, a repeated citation or a discarded defence', async () => {
  const noRebut = ['peer:1:challenge', 'author:2'];
  // The author concedes, citing the line that convinced it: nothing to rebut.
  assert.deepEqual((await threeRounds({ verdict: 'refuted', argument: 'I concede.', citations: at(3, 'require_owner();') })).calls, noRebut);
  // A concession with a new line is still a concession.
  assert.deepEqual((await threeRounds({ verdict: 'refuted', argument: 'I concede.', citations: at(4, 'require_nonzero(amount);') })).calls, noRebut);
  // The author repeats its own line: discarded, so there is no new evidence.
  const stale = await threeRounds({ verdict: 'upheld', argument: 'The transfer is unguarded.', citations: at(2, 'transfer(amount);') });
  assert.deepEqual(stale.calls, noRebut);
  assert.equal(stale.turns.find((t) => t.round === 2).reason, 'no_fresh_citation');
  // A quote that is not in the source.
  assert.deepEqual((await threeRounds({ verdict: 'upheld', argument: 'x', citations: at(4, 'no such text here') })).calls, noRebut);
  // Two rounds requested: never a third.
  const voices = new Map([['author', quiet('upheld')], ['peer', async () => ({ verdict: 'refuted', argument: 'x', citations: at(3, 'require_owner();') })]]);
  const two = await runRounds({ out: tempDir('debate-r3-'), clusters: [payCluster], voices, vendors: new Map(), reader: guarded(), rounds: 2 });
  assert.equal(Math.max(...two.debated.get('CLUSTER-1').turns.map((t) => t.round)), 2);
});

async function roundOne(peerAnswers) {
  const calls = [];
  const ids = Object.keys(peerAnswers);
  const voices = new Map([['author', quiet('upheld')], ...ids.map((id) => [id, async ({ role }) => { calls.push(`${id}:${role}`); return role === 'devil' ? { verdict: 'insufficient_evidence', argument: 'No control found.', citations: [] } : peerAnswers[id]; }])]);
  const vendors = new Map([['author', 'v1'], ...ids.map((id, i) => [id, `v${i + 2}`])]);
  await runRounds({ out: tempDir('debate-devil-need-'), clusters: [payCluster], voices, vendors, reader: guarded(), rounds: 1 });
  return calls;
}
const upheldTurn = { verdict: 'upheld', argument: 'Unguarded.', citations: at(2, 'transfer(amount);') };

// [challenge turns, devil turns]; which challenger plays the devil depends on the per-cluster labels.
const shape = (calls) => [calls.filter((c) => c.endsWith(':challenge')).length, calls.filter((c) => c.endsWith(':devil')).length];

test('the devil speaks when no challenger argued against the finding', async () => {
  // Everyone upheld: agreement that nobody tested.
  const unanimous = await roundOne({ b: upheldTurn, c: upheldTurn });
  assert.deepEqual(shape(unanimous), [2, 1]);
  assert.equal(unanimous.at(-1).endsWith(':devil'), true, 'the devil turn comes after every own verdict');
  // Nobody could tell, or only partly agreed: still no counter-argument on the table.
  assert.deepEqual(await roundOne({ b: { verdict: 'insufficient_evidence', argument: 'Not read.', citations: [] } }), ['b:challenge', 'b:devil']);
  assert.deepEqual(await roundOne({ b: { verdict: 'partial', argument: 'Only for one caller.', citations: at(2, 'transfer(amount);') } }), ['b:challenge', 'b:devil']);
  // A refutation with no valid quote is discarded, so it is not a counter-argument.
  assert.deepEqual(shape(await roundOne({ b: { verdict: 'refuted', argument: 'Guarded.', citations: at(3, 'this text is not in the file') }, c: upheldTurn })), [2, 1]);
});

test('the devil does not speak when a challenger already refuted the finding with a valid citation', async () => {
  const refutedTurn = { verdict: 'refuted', argument: 'The owner is required.', citations: at(3, 'require_owner();') };
  assert.deepEqual(shape(await roundOne({ b: refutedTurn, c: upheldTurn })), [2, 0]);
  assert.deepEqual(await roundOne({ b: refutedTurn }), ['b:challenge']);
});

test('a devil\'s advocate turn that never arrives is a coverage gap, not a missing answer; a missing challenger still is', async () => {
  const run = async (voices) => {
    const names = [...voices.keys()];
    const vendors = new Map(names.map((id, i) => [id, `v${i + 1}`]));
    return runRounds({ out: tempDir('debate-advisory-'), clusters: [payCluster], voices, vendors, reader: payReader(), rounds: 1 });
  };
  // The challenger answers its own turn, then its devil turn fails.
  const devilDown = await run(new Map([['author', quiet('upheld')], ['peer', async ({ role }) => (role === 'devil' ? { unavailable: 'debate_turn_timeout' } : quiet('upheld')())]]));
  assert.deepEqual(devilDown.gaps, [], 'no missing answer, so the debate stage does not fail');
  assert.deepEqual(devilDown.advisory.map((gap) => [gap.clusterId, gap.reason, gap.detail]), [['CLUSTER-1', 'devil_turn_missing', 'debate_turn_timeout']]);
  assert.equal(devilDown.trace.some((row) => row.template === 'devil-advocate' && row.stop === 'missing'), true, 'it is still traced');
  assert.equal(rulesVerdict(payCluster, devilDown.debated.get('CLUSTER-1').turns), 'CONFIRMED', 'and changes no status: the other vendor\'s upheld turn stands');
  // The challenger's own turn missing is a missing answer, as before.
  const challengerDown = await run(new Map([['author', quiet('upheld')], ['peer', async () => ({ unavailable: 'nothing_committed' })]]));
  assert.deepEqual(challengerDown.gaps.map((gap) => gap.reason), ['nothing_committed']);
  assert.deepEqual(challengerDown.advisory, []);
});

test('a devil that keeps timing out is not given the role again, whatever its challenges do', async () => {
  const clusters = ['CLUSTER-1', 'CLUSTER-2', 'CLUSTER-3', 'CLUSTER-4'].map((id) => ({ ...payCluster, id }));
  const asked = [];
  const voices = new Map([['author', quiet('upheld')], ['peer', async ({ role, cluster }) => {
    if (role === 'devil') { asked.push(cluster.id); return { unavailable: 'debate_turn_timeout' }; }
    return quiet('upheld')();
  }]]);
  const result = await runRounds({ out: tempDir('debate-devil-misses-'), clusters, voices, vendors: new Map([['author', 'v1'], ['peer', 'v2']]), reader: payReader(), rounds: 1 });
  // Every challenge succeeds, which resets the general counter; only the devil's own misses count.
  assert.deepEqual(asked, ['CLUSTER-1', 'CLUSTER-2'], 'asked twice, then not again');
  assert.deepEqual(result.gaps, []);
  assert.equal(result.advisory.length, 2);
});
