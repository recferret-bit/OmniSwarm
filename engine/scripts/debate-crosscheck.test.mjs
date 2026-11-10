import test from 'node:test';
import assert from 'node:assert/strict';
import { crosscheckPrior, crosscheckTurn, crosscheckVerdicts } from './debate-crosscheck.mjs';
import { sourceReader } from './debate-citations.mjs';
import { runRounds } from './debate-rounds.mjs';
import { finding, reportRun, sourceTree, tempDir } from './debate-test-run.mjs';
import { writeJson } from './report-util-files.mjs';

// Lines: 1 fn, 2 transfer (the finding), 3 guard, 4 blank, 5 closing brace, 7 another function.
const SOURCE = { 'src/a.rs': 'fn pay() {\n    transfer(amount);\n    require_owner();\n\n}\n\nfn other() { noop(); }\n' };
const reader = () => sourceReader(sourceTree(SOURCE));
const cluster = { id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', authors: ['author'], vendors: ['v1'], citationsOk: true, claimIds: ['author-s1-auth#0', 'author-s1-auth#1'],
  anchors: [{ file: 'src/a.rs', line: 2 }], evidence: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);', valid: true }] };
const verdicts = (rows) => new Map(Object.entries(rows));
const row = (reviewer, verdict, evidence, reason = 'Read the line.') => ({ reviewer, verdict, reason, evidence });

test('a cross-check verdict with a citable line becomes the round-1 turn, quoted from the snapshot', () => {
  const turn = crosscheckTurn(cluster, 'peer', verdicts({ 'author-s1-auth#0': [row('peer', 'upheld', ['src/a.rs:2'])] }), reader());
  assert.deepEqual(turn, { verdict: 'upheld', argument: 'Read the line.', citations: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);' }] });
  // Bridge-style paths and a line range are read the same way.
  const ranged = crosscheckTurn(cluster, 'peer', verdicts({ 'author-s1-auth#0': [row('peer', 'refuted', ['/work/src/src/a.rs:3-4', './src/a.rs:3'])] }), reader());
  assert.deepEqual(ranged.citations, [{ file: 'src/a.rs', startLine: 3, endLine: 3, quote: 'require_owner();' }]);
});

test('several claims of one cluster take the reviewer\'s most adverse verdict and only its evidence', () => {
  const byClaim = verdicts({ 'author-s1-auth#0': [row('peer', 'upheld', ['src/a.rs:2'], 'Unguarded.')], 'author-s1-auth#1': [row('peer', 'refuted', ['src/a.rs:3'], 'The owner is required.'), row('other', 'upheld', ['src/a.rs:2'])] });
  const turn = crosscheckTurn(cluster, 'peer', byClaim, reader());
  assert.equal(turn.verdict, 'refuted');
  assert.equal(turn.argument, 'The owner is required.');
  assert.deepEqual(turn.citations.map((c) => c.startLine), [3]);
  assert.equal(crosscheckTurn(cluster, 'other', byClaim, reader()).verdict, 'upheld');
});

test('no verdict, another cluster\'s verdict, or evidence that proves nothing gives no usable turn', () => {
  const read = reader();
  assert.equal(crosscheckTurn(cluster, 'peer', verdicts({}), read), null);
  assert.equal(crosscheckTurn(cluster, 'peer', verdicts({ 'someone-s1-auth#0': [row('peer', 'upheld', ['src/a.rs:2'])] }), read), null);
  assert.equal(crosscheckTurn(cluster, 'peer', verdicts({ 'author-s1-auth#0': [row('stranger', 'upheld', ['src/a.rs:2'])] }), read), null);
  // A blank line, a lone brace, a missing file, a line past the end, a path outside the snapshot, free text: no citation.
  for (const evidence of [['src/a.rs:4'], ['src/a.rs:5'], ['src/gone.rs:1'], ['src/a.rs:99'], ['../etc/passwd:1'], ['the transfer line'], []]) {
    assert.deepEqual(crosscheckTurn(cluster, 'peer', verdicts({ 'author-s1-auth#0': [row('peer', 'upheld', evidence)] }), read).citations, [], JSON.stringify(evidence));
  }
});

async function debate(prior) {
  const asked = [];
  const voice = (id) => async ({ role }) => { asked.push(`${id}:${role}`); return role === 'devil' ? { verdict: 'insufficient_evidence', argument: 'No control.', citations: [] } : { verdict: 'upheld', argument: 'Live answer.', citations: [{ file: 'src/a.rs', startLine: 2, endLine: 2, quote: 'transfer(amount);' }] }; };
  const result = await runRounds({ out: tempDir('debate-xcheck-'), clusters: [cluster], voices: new Map(['author', 'peer'].map((id) => [id, voice(id)])), vendors: new Map([['author', 'v1'], ['peer', 'v2']]), reader: reader(), rounds: 1, prior });
  const turns = result.debated.get('CLUSTER-1').turns;
  return { asked, turns, sources: result.trace.filter((r) => r.template === 'challenge').map((r) => r.source || 'session'), gaps: result.gaps };
}
const priorOf = (rows) => (c, id) => crosscheckTurn(c, id, verdicts(rows), reader());

test('a reviewer that already answered in the cross-check is not asked again in round 1', async () => {
  const run = await debate(priorOf({ 'author-s1-auth#0': [row('peer', 'refuted', ['src/a.rs:3'], 'The owner is required.')] }));
  // No challenge session; and the refutation is a counter-argument, so no devil turn either.
  assert.deepEqual(run.asked, []);
  assert.deepEqual(run.sources, ['crosscheck']);
  assert.deepEqual(run.turns.map((t) => [t.role, t.verdict, t.discarded, t.argument]), [['challenge', 'refuted', false, 'The owner is required.']]);
  // An upheld cross-check still gets the devil's advocate turn, in a session.
  const upheld = await debate(priorOf({ 'author-s1-auth#0': [row('peer', 'upheld', ['src/a.rs:2'])] }));
  assert.deepEqual(upheld.asked, ['peer:devil']);
  assert.deepEqual(upheld.sources, ['crosscheck']);
});

test('the reviewer is asked in a session when the cross-check gave nothing the checker accepts', async () => {
  const live = ['peer:challenge', 'peer:devil'];
  // No cross-check output at all, or none from this reviewer.
  assert.deepEqual((await debate(null)).asked, live);
  assert.deepEqual((await debate(priorOf({}))).asked, live);
  // A verdict with no evidence, with evidence on a blank line, or about another function is not a debate turn.
  for (const evidence of [[], ['src/a.rs:4'], ['src/a.rs:7']]) {
    const run = await debate(priorOf({ 'author-s1-auth#0': [row('peer', 'refuted', evidence)] }));
    assert.deepEqual(run.asked, live, JSON.stringify(evidence));
    assert.deepEqual(run.sources, ['session']);
    assert.equal(run.turns[0].argument, 'Live answer.');
  }
});

test('only assigned, well-formed cross-check rows are read from a report directory', () => {
  const { out } = reportRun(['cli:claude:opus', 'cli:codex:gpt-6.1-sol'], { 'cli-claude-opus': { findings: [finding('Bug', ['src/a.rs:2'])] } });
  const claim = 'cli-claude-opus-s1-auth#0';
  assert.equal(crosscheckVerdicts(out).size, 0, 'no cross-check files');
  assert.equal(crosscheckPrior(out, reader()), null);
  writeJson(out, 'crosscheck/cli-codex-gpt-6-1-sol.json', [{ id: claim, auditor: 'cli-claude-opus-s1-auth', title: 'Bug', location: ['src/a.rs:2'] }]);
  writeJson(out, 'auditors/crosscheck-cli-codex-gpt-6-1-sol.json', [
    { id: claim, verdict: 'upheld', reason: 'Read.', evidence: ['src/a.rs:2'] },
    { id: claim, verdict: 'refuted', reason: 'Second row for the same claim.', evidence: ['src/a.rs:3'] },
    { id: 'cli-claude-opus-s1-auth#7', verdict: 'refuted', reason: 'Not assigned.', evidence: ['src/a.rs:3'] },
    { id: claim, verdict: 'secure', reason: 'Not a verdict.' },
  ]);
  // A reviewer that was never assigned a cross-check, and an author reviewing its own claim.
  writeJson(out, 'auditors/crosscheck-cli-grok-grok-4-7.json', [{ id: claim, verdict: 'refuted', reason: 'Stranger.', evidence: ['src/a.rs:3'] }]);
  const byClaim = crosscheckVerdicts(out);
  assert.deepEqual([...byClaim.keys()], [claim]);
  assert.deepEqual(byClaim.get(claim).map((r) => [r.reviewer, r.verdict]), [['cli-codex-gpt-6-1-sol', 'upheld']]);
  const prior = crosscheckPrior(out, reader());
  assert.equal(prior({ claimIds: [claim] }, 'cli-codex-gpt-6-1-sol').verdict, 'upheld');
  assert.equal(prior({ claimIds: [claim] }, 'cli-grok-grok-4-7'), null);
});
