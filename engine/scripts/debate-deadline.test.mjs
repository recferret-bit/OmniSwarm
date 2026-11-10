// Debate wall clock and the one replacement judge. A started turn that times out is a missing answer.
// A cluster the phase clock never starts is a coverage gap and is judged from citations only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bridgeVoice } from './debate-voices.mjs';
import { runRounds } from './debate-rounds.mjs';
import { adjudicateStage, debateStage, generalReviewStage } from './debate-run.mjs';
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

test('threshold fallback skips remaining clusters after maxUnanswered, adjudicates via rules after maxJudgeUnavailable, and writes general-review files when summaryVoice is unavailable', async (t) => {
  const root = sourceTree({ 'src/a.rs': 'let a = 1;\n', 'src/b.rs': 'let b = 2;\n', 'src/c.rs': 'let c = 3;\n' });
  const out = temp();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  const claims = ['a', 'b', 'c'].map((f) => ({ ...finding(`Issue ${f}`, [`src/${f}.rs:1`]), reviewerId: 'alice', vendor: 'anthropic', auditor: 'alice-s1-auth', claimId: `alice-s1-auth#Issue ${f}` }));
  let debateCalls = 0;
  let judgeCalls = 0;
  const plan = {
    out, claims, reader: sourceReader(root), maxClusters: 25, rounds: 2, seed: 1, phaseMs: 60000, turnMs: 60000,
    maxJudgeUnavailable: 1,
    scope: ['S1', 'S2'], failedSurfaces: new Set(['S2']),
    reviewers: [
      { id: 'alice', vendor: 'anthropic', model: 'opus' },
      { id: 'bob', vendor: 'openai', model: 'gpt' },
    ],
    voices: new Map([
      ['alice', async () => ({ unavailable: 'no_answer' })],
      ['bob', async () => { debateCalls += 1; return { unavailable: 'no_answer' }; }],
    ]),
    vendors: new Map([['alice', 'anthropic'], ['bob', 'openai']]),
    orchestrator: codex,
    judgeVoice: () => async () => { judgeCalls += 1; return { unavailable: 'judge_down' }; },
    summaryVoice: async () => ({ unavailable: 'cancelled' }),
    usage: new Map(),
    methodology: { reviewers: ['alice', 'bob'], orchestrator: codex.id, passes: 2, toolBudget: 40, debateRounds: 2 },
  };
  const debated = await runRounds({
    out, clusters: [1, 2, 3].map((i) => ({ id: `CLUSTER-${i}`, status: 'QUEUED', severity: 'high', authors: ['alice'], anchors: [], evidence: [], vendors: ['anthropic'], citationsOk: true })),
    voices: plan.voices, vendors: plan.vendors, reader: plan.reader, rounds: 2, maxUnanswered: 1,
  });
  assert.equal(debateCalls, 1, 'stops calling voices once maxUnanswered threshold is reached');
  assert.deepEqual(debated.skipped, ['CLUSTER-2', 'CLUSTER-3']);

  const state = await debateStage(plan);
  const adjudicated = await adjudicateStage(plan, state);
  assert.equal(judgeCalls, 2, 'stops calling judgeVoice after first cluster retry fails (maxJudgeUnavailable=1) and adjudicates remaining clusters by rules');
  assert.equal(adjudicated.rows.length, 3);
  assert.match(adjudicated.rows[1].rationale, /judge_threshold/);
  assert.match(adjudicated.rows[2].rationale, /judge_threshold/);

  await assert.rejects(generalReviewStage(plan, adjudicated), /general_review_unavailable: cancelled/);
  assert.equal(fs.existsSync(path.join(out, 'general-review.json')), true, 'general-review.json is still written on fallback');
  assert.equal(fs.existsSync(path.join(out, 'general-review.md')), true, 'general-review.md is still written on fallback');
  const general = JSON.parse(fs.readFileSync(path.join(out, 'general-review.json'), 'utf8'));
  assert.match(general.executiveSummary, /Open questions and limitations:/);
  assert.match(fs.readFileSync(path.join(out, 'general-review.md'), 'utf8'), /## Coverage & limitations/);

  // Even when summaryVoice succeeds, threshold adjudications, partial passes and incomplete surfaces are appended to executiveSummary.
  const out2 = temp();
  t.after(() => fs.rmSync(out2, { recursive: true, force: true }));
  const okPlan = { ...plan, out: out2, maxUnanswered: 1, partialSurfaces: ['alice-s1-auth (1/2 passes)'], summaryVoice: async () => ({ executiveSummary: 'Synthesized by orchestrator.', openDisagreements: [] }) };
  const state2 = await debateStage(okPlan);
  assert.deepEqual(state2.coverageGaps.map((g) => g.reason), ['debate_threshold', 'debate_threshold']);
  const adj2 = await adjudicateStage(okPlan, state2);
  assert.match(adj2.rows[1].rationale, /debate_threshold/);
  const gen2 = await generalReviewStage(okPlan, adj2);
  assert.match(gen2.executiveSummary, /Synthesized by orchestrator\. Open questions and limitations:/);
  assert.match(gen2.executiveSummary, /incomplete surfaces: S2/);
  assert.match(gen2.executiveSummary, /partial passes \(restored earlier pass or budget limit\): alice-s1-auth \(1\/2 passes\)/);
  const md2 = fs.readFileSync(path.join(out2, 'general-review.md'), 'utf8');
  assert.match(md2, /- \d+ cluster\(s\) adjudicated by deterministic citation rules; incomplete surfaces: S2; partial passes/);
});

test('per-speaker threshold isolates one failing reviewer while healthy reviewers finish all clusters, and providerFailures skips doomed debate sessions', async (t) => {
  const root = sourceTree({ 'src/lib.rs': 'let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\n' });
  const out = temp();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  const reader = sourceReader(root);
  const clusters = [1, 2, 3, 4].map((i) => ({
    id: `CLUSTER-${i}`, status: 'QUEUED', severity: 'high', authors: ['alice'],
    anchors: [{ file: 'src/lib.rs', line: i }],
    evidence: [{ file: 'src/lib.rs', startLine: i, endLine: i, quote: `let ${['a', 'b', 'c', 'd'][i - 1]} = ${i};`, valid: true }],
    vendors: ['anthropic'], citationsOk: true,
  }));
  let brokenCalls = 0;
  let healthyCalls = 0;
  const voices = new Map([
    ['alice', async () => ({ verdict: 'upheld', argument: 'Author.', citations: [] })],
    ['broken', async () => { brokenCalls += 1; return { unavailable: 'debate_turn_timeout' }; }],
    ['healthy', async ({ cluster: c }) => {
      healthyCalls += 1;
      const line = Number(c.id.split('-')[1]);
      return { verdict: 'upheld', argument: 'Verified.', citations: [{ file: 'src/lib.rs', startLine: line, endLine: line, quote: `= ${line};` }] };
    }],
  ]);
  const res = await runRounds({ out, clusters, voices, vendors: new Map([['alice', 'anthropic'], ['broken', 'xai'], ['healthy', 'openai']]), reader, rounds: 1, maxUnanswered: 6, maxSpeakerUnanswered: 2 });
  assert.equal(brokenCalls, 2, 'broken speaker stops being called after maxSpeakerUnanswered (2) consecutive failures');
  assert.equal(healthyCalls, 8, 'healthy speaker still debates all 4 clusters: its own turn and the devil\'s advocate turn on each');
  assert.deepEqual(res.skipped, []);
  assert.ok(res.gaps.some((g) => g.reason === 'speaker_threshold'));

  let executeCalls = 0;
  const ctx = {
    output: out, providerFailures: {},
    execute: async () => { executeCalls += 1; return { code: 1, failure: { reason: 'usage_limit' } }; },
  };
  const voice = bridgeVoice(ctx, { id: 'cli-grok-grok-4' });
  const first = await voice({ role: 'challenge', round: 1, cluster: { id: 'CLUSTER-1' }, turns: [], anonId: 'Reviewer A' });
  const second = await voice({ role: 'challenge', round: 1, cluster: { id: 'CLUSTER-2' }, turns: [], anonId: 'Reviewer A' });
  assert.equal(first.unavailable, 'usage_limit');
  assert.equal(second.unavailable, 'usage_limit');
  assert.equal(executeCalls, 1, 'second call short-circuits on recorded providerFailures[agent]');
});
