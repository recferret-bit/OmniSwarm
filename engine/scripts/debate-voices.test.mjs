// What a model judge is shown, and how a debate turn that never arrives is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bridgeJudge } from './debate-voices.mjs';
import { runRounds } from './debate-rounds.mjs';

const cite = { file: 'src/lib.rs', startLine: 30, endLine: 30, quote: 'let next = self.balance.saturating_sub(amount);', valid: true };
const cluster = {
  id: 'CLUSTER-1', status: 'QUEUED', primaryTitle: 'withdraw has no owner check', severity: 'high', surface: 'S1', authors: ['author'], anchors: [],
  evidence: [{ ...cite, startLine: 30 }],
};
const turn = (anonId, round, role, verdict, argument, extra = {}) => ({ round, role, anonId, verdict, argument, citations: [cite], discarded: false, conformitySuspect: false, ...extra });

test('the judge brief leaves discarded turns out and marks conformity-suspect turns', async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-judge-brief-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  let prompt = '';
  const ctx = { output: out, execute: async (call) => { prompt = call.prompt; return { code: 1, failure: { reason: 'session_failed' } }; } };
  const turns = [
    turn('Reviewer A', 1, 'challenge', 'upheld', 'The guard is missing at the cited line.'),
    turn('Reviewer B', 1, 'challenge', 'refuted', 'DISCARDED-ARGUMENT without a valid quote.', { discarded: true, reason: 'no_valid_citation', citations: [{ ...cite, valid: false }] }),
    turn('Reviewer C', 2, 'defend', 'refuted', 'SUSPECT-ARGUMENT copied the earlier refutation.', { conformitySuspect: true }),
  ];
  const answer = await bridgeJudge(ctx, { id: 'judge' })({ cluster, turns, judge: { reviewerId: 'judge' }, validArguments: [], discardedArguments: [] });
  assert.deepEqual(answer, { unavailable: 'session_failed' });
  assert.match(prompt, /Reviewer A, round 1 \(challenge\): upheld/);
  assert.doesNotMatch(prompt, /DISCARDED-ARGUMENT|Reviewer B/);
  const suspect = prompt.split('\n').find((line) => line.includes('SUSPECT-ARGUMENT'));
  assert.match(suspect, /\[conformity suspect: the verdict changed without new evidence; it carries no weight\]/);
  assert.doesNotMatch(prompt.split('\n').find((line) => line.includes('Reviewer A')), /conformity suspect/);
});

test('an expected debate turn that never arrives is a gap and a missing trace row', async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-missing-turn-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const voices = new Map([
    ['author', async () => { throw new Error('authors do not speak in round 1'); }],
    ['silent', async () => ({ unavailable: 'nothing_committed' })],
    ['garbled', async () => ({ verdict: 'upheld' })],
  ]);
  const result = await runRounds({ out, clusters: [cluster], voices, vendors: new Map(), reader: null, rounds: 2 });
  const anon = result.anonymization.clusters['CLUSTER-1'];
  assert.deepEqual(result.trace.map(({ anonId, round, stop, reason }) => ({ anonId, round, stop, reason })).sort((a, b) => a.anonId.localeCompare(b.anonId)), [
    { anonId: anon.garbled, round: 1, stop: 'missing', reason: 'invalid_turn' },
    { anonId: anon.silent, round: 1, stop: 'missing', reason: 'nothing_committed' },
  ].sort((a, b) => a.anonId.localeCompare(b.anonId)));
  assert.ok(result.trace.every((row) => row.phase === 'debate' && row.clusterId === 'CLUSTER-1' && ['challenge', 'devil-advocate'].includes(row.template)));
  assert.equal(result.gaps.length, 2);
});
