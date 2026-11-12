import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateCluster, pickJudge } from './debate-judge.mjs';
import { classifyArgument, rulesVerdict } from './debate-rules.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';

const [claude, codex, grok, sonnet, judge] = ['cli:claude:opus', 'cli:codex:gpt-5.5', 'cli:grok:grok-4', 'cli:claude:sonnet', 'scripted:judge'].map(parseReviewerSpec);
const cluster = (vendors, extra = {}) => ({ id: 'CLUSTER-1', status: 'QUEUED', severity: 'high', vendors, citationsOk: true, ...extra });
const ok = { file: 'src/lib.rs', startLine: 2, endLine: 2, quote: 'x', valid: true };
const turn = (anonId, verdict, citations, extra = {}) => ({ anonId, round: 1, verdict, citations, discarded: false, conformitySuspect: false, ...extra });

test('the judge never shares a vendor with an author; the alternate takes over, else no independent judge', () => {
  const reviewers = [claude, codex, grok];
  assert.equal(pickJudge(cluster(['openai']), { orchestrator: claude, reviewers }).record.alternate, false);
  const alt = pickJudge(cluster(['anthropic']), { orchestrator: claude, reviewers });
  assert.deepEqual(alt.record, { reviewerId: codex.id, vendor: 'openai', alternate: true });
  assert.equal(pickJudge(cluster(['anthropic', 'openai']), { orchestrator: claude, alternate: grok, reviewers }).record.vendor, 'xai');
  for (const authors of [['anthropic'], ['anthropic', 'openai'], ['openai', 'xai']]) {
    const choice = pickJudge(cluster(authors), { orchestrator: claude, alternate: grok, reviewers });
    if (choice) assert.equal(authors.includes(choice.record.vendor), false, authors.join());
  }
  assert.equal(pickJudge(cluster(['anthropic']), { orchestrator: claude, reviewers: [claude, sonnet] }), null);
});

test('with no independent judge the cluster stays DISPUTED and says why', async () => {
  const { row } = await adjudicateCluster(cluster(['anthropic']), [], null, () => { throw new Error('no judge call'); });
  assert.equal(row.finalStatus, 'DISPUTED');
  assert.match(row.rationale, /^no_independent_judge/);
});

test('a model judge cannot refute a single-source finding without a valid refutation', async () => {
  const choice = pickJudge(cluster(['openai']), { orchestrator: claude, reviewers: [claude, codex] });
  const voice = () => async () => ({ finalStatus: 'REFUTED', severity: 'high', rationale: 'I do not believe it.' });
  const { row } = await adjudicateCluster(cluster(['openai']), [turn('Reviewer A', 'upheld', [ok])], choice, voice);
  assert.equal(row.finalStatus, 'LIKELY');
  assert.match(row.rationale, /do not support REFUTED/);
});

test('the scripted judge is the citation rules and only runs as the demo exception', async () => {
  const choice = pickJudge(cluster(['scripted']), { orchestrator: judge, reviewers: [] });
  assert.equal(choice.rules, true);
  const { row } = await adjudicateCluster(cluster(['scripted']), [turn('Reviewer A', 'refuted', [ok])], choice, () => { throw new Error('no model call'); });
  assert.equal(row.finalStatus, 'REFUTED');
});

test('arguments without a valid citation are discarded and a copied flip is kept but carries no weight', () => {
  const seen = new Set(['src/lib.rs:2-2']);
  assert.equal(classifyArgument({ verdict: 'refuted', citations: [{ ...ok, valid: false }] }).discarded, true);
  assert.equal(classifyArgument({ verdict: 'insufficient_evidence', citations: [] }).discarded, false);
  const copied = classifyArgument({ verdict: 'refuted', citations: [ok] }, { seen, previous: 'upheld' });
  assert.deepEqual([copied.discarded, copied.conformitySuspect, copied.verdictChanged], [false, true, true]);
  const fresh = classifyArgument({ verdict: 'refuted', citations: [{ ...ok, startLine: 3, endLine: 3 }] }, { seen, previous: 'upheld' });
  assert.equal(fresh.conformitySuspect, false);
  assert.equal(rulesVerdict(cluster(['openai']), [{ ...copied, speakerVendor: 'xai' }]), 'LIKELY');
  assert.equal(rulesVerdict(cluster(['openai']), [{ ...fresh, speakerVendor: 'xai' }]), 'REFUTED');
  assert.equal(rulesVerdict(cluster(['openai']), [turn('Reviewer B', 'upheld', [ok], { speakerVendor: 'xai' })]), 'CONFIRMED');
  assert.equal(rulesVerdict(cluster(['openai'], { citationsOk: false }), []), 'INSUFFICIENT_EVIDENCE');
});
