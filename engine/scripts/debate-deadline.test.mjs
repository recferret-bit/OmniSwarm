// Debate wall clock and the one replacement judge. A started turn that times out is a missing answer.
// A cluster the phase clock never starts is a coverage gap and is judged from citations only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bridgeVoice } from './debate-voices.mjs';
import { runRounds } from './debate-rounds.mjs';
import { adjudicateStage, debateStage } from './debate-run.mjs';
import { adjudicateWithRetry } from './debate-judge.mjs';
import { sourceReader } from './debate-citations.mjs';
import { finding, sourceTree } from './debate-test-run.mjs';
import { createExecute } from './orchestrator-session.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { validate } from '../../packages/schemas/index.mjs';

const [claude, codex, grok, openrouterClaude, judge] = ['cli:claude:opus', 'cli:codex:gpt-5.5', 'cli:grok:grok-4', 'openrouter:anthropic/claude-opus-5.5', 'scripted:judge'].map(parseReviewerSpec);
const ok = { file: 'src/lib.rs', startLine: 2, endLine: 2, quote: 'x', valid: true };
const cluster = (vendors, extra = {}) => ({ id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', vendors, citationsOk: true, ...extra });
const argued = [
  { anonId: 'Reviewer A', round: 1, verdict: 'upheld', citations: [ok], discarded: false, conformitySuspect: false, speakerVendor: 'xai' },
  { anonId: 'Reviewer B', round: 1, verdict: 'refuted', citations: [ok], discarded: false, conformitySuspect: false, speakerVendor: 'google' },
];
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'debate-deadline-'));

test('a debate turn past turnMs is a debate_turn_timeout gap and the session signal aborts', async () => {
  const out = temp();
  let signal;
  const clusterRow = { id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', authors: ['author'], anchors: [], evidence: [], vendors: ['anthropic'], citationsOk: true };
  const voices = new Map([
    ['author', async () => { throw new Error('author should not speak'); }],
    ['slow', ({ signal: turnSignal }) => new Promise((resolve) => {
      signal = turnSignal;
      turnSignal.addEventListener('abort', () => resolve({ verdict: 'upheld', argument: 'too late', citations: [] }), { once: true });
    })],
  ]);
  const result = await runRounds({ out, clusters: [clusterRow], voices, vendors: new Map([['slow', 'openai']]), reader: null, rounds: 1, turnMs: 30, phaseMs: 60000 });
  assert.equal(signal.aborted, true);
  assert.deepEqual(result.gaps.map((gap) => gap.reason), ['debate_turn_timeout']);
  assert.deepEqual(result.skipped, []);
});

test('a spent phase clock skips clusters that were never started', async () => {
  const out = temp();
  let calls = 0;
  let t = 0;
  const row = (id) => ({ id, status: 'QUEUED', severity: 'low', authors: ['other'], anchors: [], evidence: [], vendors: ['anthropic'], citationsOk: true });
  const voices = new Map([
    ['speaker', async () => { calls += 1; t = 1000; return { unavailable: 'stop' }; }],
    ['other', async () => { throw new Error('author should not speak'); }],
  ]);
  const advanced = await runRounds({
    out, clusters: [row('CLUSTER-1'), row('CLUSTER-2')], voices, vendors: new Map(), reader: null, rounds: 1,
    turnMs: 60000, phaseMs: 500, now: () => t,
  });
  assert.equal(calls, 1);
  assert.deepEqual(advanced.skipped, ['CLUSTER-2']);
  assert.deepEqual(advanced.gaps.map((gap) => gap.clusterId), ['CLUSTER-1']);

  calls = 0;
  const skipped = await runRounds({
    out, clusters: [row('CLUSTER-1'), row('CLUSTER-2')], voices, vendors: new Map(), reader: null, rounds: 1, phaseMs: 0,
  });
  assert.equal(calls, 0);
  assert.deepEqual(skipped.skipped, ['CLUSTER-1', 'CLUSTER-2']);
  assert.deepEqual(skipped.gaps, []);
});

test('debate_time is a coverage gap and a rules-only row, not a missing answer', async (t) => {
  const root = sourceTree({ 'src/lib.rs': 'let v = check();\n' });
  const out = temp();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  const claim = { ...finding('Solo check', ['src/lib.rs:1']), reviewerId: 'alice', vendor: 'anthropic', auditor: 'alice-s1-auth', claimId: 'alice-s1-auth#Solo check' };
  let calls = 0;
  const plan = {
    out, claims: [claim], reader: sourceReader(root), maxClusters: 25, rounds: 2, seed: 1, phaseMs: 0, turnMs: 180000,
    reviewers: [
      { id: 'alice', vendor: 'anthropic', model: 'opus' },
      { id: 'bob', vendor: 'openai', model: 'gpt' },
    ],
    voices: new Map([['alice', async () => { calls += 1; }], ['bob', async () => { calls += 1; }]]),
    vendors: new Map([['alice', 'anthropic'], ['bob', 'openai']]),
    orchestrator: codex,
    judgeVoice: () => { throw new Error('no judge'); },
  };
  const state = await debateStage(plan);
  assert.equal(calls, 0);
  assert.deepEqual(state.gaps, []);
  assert.equal(state.unheard.length, 1);
  assert.equal(state.clusters.find((row) => state.unheard.includes(row.id)).status, 'QUEUED');
  const judged = await adjudicateStage(plan, state);
  assert.equal(judged.missing.length, 0);
  assert.equal(judged.rows[0].judge.reviewerId, 'rules');
  assert.equal(judged.rows[0].finalStatus, 'LIKELY');
  assert.match(judged.rows[0].rationale, /debate_time/);
  const written = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'clusters.json'), 'utf8'));
  assert.ok(written.coverageGaps.some((gap) => gap.reason === 'debate_time' && gap.clusterId === state.unheard[0]));
  assert.equal(written.clusters.some((row) => row.status === 'CAPPED'), false);
});

test('bridgeVoice forwards the turn signal to execute', async () => {
  const controller = new AbortController();
  let seen;
  const ctx = { output: os.tmpdir(), execute: async (call) => { seen = call.signal; return { code: 1, failure: { reason: 'session_failed' } }; } };
  const answer = await bridgeVoice(ctx, { id: 'cli-claude-opus' })({ role: 'challenge', round: 1, cluster: { id: 'CLUSTER-1' }, turns: [], anonId: 'Reviewer A', signal: controller.signal });
  assert.equal(seen, controller.signal);
  assert.equal(answer.unavailable, 'session_failed');
});

function planWith(judgeVoice, extra = {}) {
  return { orchestrator: claude, reviewers: [claude, codex, grok], turnMs: 60000, judgeVoice, ...extra };
}

test('DISPUTED is retried once on a different vendor, and a resolving answer is adopted', async () => {
  const seen = [];
  const { row, gap, trace } = await adjudicateWithRetry(cluster(['openai']), argued, planWith((choice) => async () => {
    seen.push(choice.reviewer.id);
    return seen.length === 1
      ? { finalStatus: 'DISPUTED', rationale: 'Both sides cite the line.' }
      : { finalStatus: 'REFUTED', rationale: 'The refutation holds.' };
  }));
  assert.deepEqual(seen, [claude.id, grok.id]);
  assert.equal(row.finalStatus, 'REFUTED');
  assert.equal(row.judge.reviewerId, grok.id);
  assert.equal(row.judge.alternate, true);
  assert.deepEqual(Object.keys(row.judge).sort(), ['alternate', 'reviewerId', 'vendor']);
  assert.equal(gap, null);
  assert.match(row.rationale, new RegExp(`No agreement from ${claude.id}. Retried with ${grok.id}`));
  assert.equal(trace[1].template, 'judge-retry');
  assert.equal(validate('adjudication', row).ok, true);
});

test('a second DISPUTED stays DISPUTED and keeps the first judge', async () => {
  const { row, gap, trace } = await adjudicateWithRetry(cluster(['openai']), argued, planWith(() => async () => ({ finalStatus: 'DISPUTED', rationale: 'Both sides cite the line.' })));
  assert.equal(row.finalStatus, 'DISPUTED');
  assert.equal(row.judge.reviewerId, claude.id);
  assert.match(row.rationale, new RegExp(`Retried with ${grok.id}: still disputed`));
  assert.equal(gap, undefined);
  assert.equal(trace.filter((entry) => entry.template === 'judge-retry').length, 1);
});

test('an unanswered judge is replaced, and a second answer clears the gap', async () => {
  let n = 0;
  const { row, gap } = await adjudicateWithRetry(cluster(['openai']), argued, planWith(() => async () => {
    n += 1;
    return n === 1 ? { unavailable: 'session_failed' } : { finalStatus: 'REFUTED', rationale: 'The refutation holds.' };
  }));
  assert.equal(n, 2);
  assert.equal(gap, null);
  assert.equal(row.finalStatus, 'REFUTED');
  assert.equal(row.judge.vendor, 'xai');
  assert.match(row.rationale, /^No answer from /);
});

test('a replacement that also does not answer keeps the single first gap', async () => {
  let n = 0;
  const { row, gap, trace } = await adjudicateWithRetry(cluster(['openai']), argued, planWith(() => async () => { n += 1; return { unavailable: 'session_failed' }; }));
  assert.equal(n, 2);
  assert.equal(gap.reason, 'judge_unavailable');
  assert.equal(row.judge.reviewerId, claude.id);
  assert.equal(trace.at(-1).stop, 'unavailable');
});

test('the same-vendor model is the replacement when no other vendor is independent', async () => {
  const seen = [];
  const { row } = await adjudicateWithRetry(cluster(['openai']), argued, planWith((choice) => async () => {
    seen.push(choice.reviewer.id);
    return seen.length === 1
      ? { finalStatus: 'DISPUTED', rationale: 'Both sides cite the line.' }
      : { finalStatus: 'LIKELY', rationale: 'Keep the single-source finding.' };
  }, { reviewers: [claude, openrouterClaude], alternate: null }));
  assert.deepEqual(seen, [claude.id, openrouterClaude.id]);
  assert.equal(row.judge.reviewerId, openrouterClaude.id);
  assert.equal(row.finalStatus, 'LIKELY');
});

test('with no other independent judge the first DISPUTED stands, and the scripted judge is not replaced', async () => {
  let calls = 0;
  const alone = await adjudicateWithRetry(cluster(['openai']), argued, planWith(() => async () => { calls += 1; return { finalStatus: 'DISPUTED', rationale: 'Both sides cite the line.' }; }, { reviewers: [claude, codex] }));
  assert.equal(calls, 1);
  assert.equal(alone.row.finalStatus, 'DISPUTED');
  assert.equal(alone.trace.length, 1);
  const scripted = await adjudicateWithRetry(cluster(['scripted']), [], { orchestrator: judge, reviewers: [claude], turnMs: 60000, judgeVoice: () => { throw new Error('no model'); } });
  assert.equal(scripted.row.finalStatus, 'LIKELY');
  assert.equal(scripted.trace.length, 1);
});

test('createExecute aborts the review when either the turn signal or the run signal aborts', async (t) => {
  const output = temp();
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  for (const dir of ['harness/identities', 'harness/assignments', 'sessions']) fs.mkdirSync(path.join(output, dir), { recursive: true });
  const reviewer = { id: claude.id, model: 'opus', family: 'cli', provider: 'claude' };
  const runOf = (signal) => ({
    output, reviewerById: new Map([[claude.id, reviewer]]), sourceDigest: 'abc', dockerBin: 'docker',
    budgets: {}, prices: null, signal, session: { container: 'box' }, resume: null,
  });
  const review = ({ signal }) => new Promise((resolve) => {
    const finish = () => resolve({ code: 130, elapsedMs: 1, failureReason: 'cancelled' });
    if (signal?.aborted) finish();
    else signal.addEventListener('abort', finish, { once: true });
  });
  const turn = new AbortController();
  let seen;
  const pending = createExecute({ ...runOf(new AbortController().signal), review: (options) => { seen = options.signal; return review(options); } })({
    name: 'turn-1', agent: claude.id, role: 'debater', prompt: 'p', assignment: { kind: 'debate-turn' }, signal: turn.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.aborted, false);
  turn.abort();
  const first = await pending;
  assert.equal(seen.aborted, true);
  assert.equal(first.failure.reason, 'cancelled');

  const runAbort = new AbortController();
  const call = new AbortController();
  let secondSignal;
  const pendingRun = createExecute({ ...runOf(runAbort.signal), review: (options) => { secondSignal = options.signal; return review(options); } })({
    name: 'turn-2', agent: claude.id, role: 'debater', prompt: 'p', assignment: { kind: 'debate-turn' }, signal: call.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  runAbort.abort();
  await pendingRun;
  assert.equal(secondSignal.aborted, true);
  assert.equal(call.signal.aborted, false);
});
