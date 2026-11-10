import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClusters, sameDefect } from './debate-cluster.mjs';
import { sourceReader } from './debate-citations.mjs';
import { finding, sourceTree } from './debate-test-run.mjs';

const lines = Array.from({ length: 60 }, (_, i) => `let v${i} = check_${i}();`).join('\n');
const reader = sourceReader(sourceTree({ 'src/lib.rs': `${lines}\n` }));
const claim = (reviewerId, vendor, title, line, extra = {}) => ({ ...finding(title, [`src/lib.rs:${line}`], extra), reviewerId, vendor, auditor: `${reviewerId}-s1-auth`, claimId: `${reviewerId}-s1-auth#${title}` });

test('two vendors with checkable lines are AGREED; one vendor or a bad line is queued', () => {
  const built = buildClusters([
    claim('alice', 'anthropic', 'Bug', 1), claim('bob', 'openai', 'Bug', 1),
    claim('carol', 'anthropic', 'Solo', 5),
    claim('dave', 'anthropic', 'Gone', 99), claim('erin', 'openai', 'Gone', 99),
  ], { reader });
  const by = Object.fromEntries(built.clusters.map((row) => [row.primaryTitle, row]));
  assert.deepEqual([by.Bug.status, by.Bug.rounds], ['AGREED', 0]);
  assert.deepEqual(by.Bug.vendors, ['anthropic', 'openai']);
  assert.equal(by.Solo.status, 'QUEUED');
  assert.equal(by.Gone.status, 'QUEUED');
  assert.equal(by.Gone.citationsOk, false);
});

test('the queue is ordered by severity, then severity disagreement, and caps at the limit', () => {
  const rows = [
    claim('a', 'v1', 'Low', 2, { severity: 'low' }),
    claim('b', 'v1', 'Medium', 10, { severity: 'medium' }),
    claim('c', 'v1', 'Split', 20, { severity: 'medium' }), claim('d', 'v1', 'Split', 20, { severity: 'low' }),
    claim('e', 'v1', 'High', 30, { severity: 'high' }),
    claim('f', 'v1', 'Critical', 40, { severity: 'critical' }),
  ];
  const built = buildClusters(rows, { reader, maxClusters: 3 });
  // critical 5, high 4, split medium 3.5, medium 3, low 2: a disputed medium never outranks a critical.
  assert.deepEqual(built.clusters.filter((row) => row.status === 'QUEUED').map((row) => row.primaryTitle), ['Critical', 'High', 'Split']);
  assert.deepEqual(built.clusters.filter((row) => row.status === 'CAPPED').map((row) => row.primaryTitle), ['Medium', 'Low']);
  assert.deepEqual(built.coverageGaps.map((row) => row.reason), ['debate_cap', 'debate_cap']);
});

// Two files, so claims from different reviewers on nearby lines of both merge structurally (cluster-findings.mjs).
const two = sourceReader(sourceTree({ 'src/pay.rs': `${lines}\n`, 'src/auth.rs': `${lines}\n` }));
const wide = (reviewerId, vendor, title, at, extra = {}) => ({ ...finding(title, [`src/pay.rs:${at}`, `src/auth.rs:${at}`], extra), reviewerId, vendor, auditor: `${reviewerId}-s1-auth`, claimId: `${reviewerId}-s1-auth#${title}` });
const statusOf = (claims) => { const [row, ...rest] = buildClusters(claims, { reader: two }).clusters; assert.equal(rest.length, 0, 'one cluster'); return [row.status, row.agreement]; };

test('agreement skips the debate only when two vendors report the same defect on the same line', () => {
  // Same line, same surface, different wording: agreement.
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 10), wide('bob', 'openai', 'Any caller can drain the vault', 10)]), ['AGREED', 'same_claim']);
  // Same line, different surfaces, but the titles name the same thing: agreement.
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw skips the owner comparison', 10), wide('bob', 'openai', 'Owner comparison absent in withdraw', 10, { surface: 'S3' })]), ['AGREED', 'same_claim']);
});

test('claims that only sit close together are merged but still debated', () => {
  // Adjacent lines with unrelated titles: merged for the report (cluster-findings sameSite), not an agreement.
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Payout races the balance update', 10, { surface: 'S3' }), wide('bob', 'openai', 'Destination account is caller supplied', 11, { surface: 'S2' })]), ['QUEUED', 'merged_only']);
  // The same statement, two different defects (different surface, unrelated titles).
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Payout races the balance update', 10, { surface: 'S3' }), wide('bob', 'openai', 'Destination account is caller supplied', 10, { surface: 'S2' })]), ['QUEUED', 'merged_only']);
  // Two reviewers of one vendor agreeing with each other is not agreement.
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 10), wide('amy', 'anthropic', 'Withdraw has no owner comparison', 10)]), ['QUEUED', 'single_vendor']);
  // The same defect on a line that is not in the snapshot.
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 99), wide('bob', 'openai', 'Withdraw has no owner comparison', 99)]), ['QUEUED', 'same_claim']);
});

test('the same subject two lines apart is agreement; the same title three lines apart too; four lines apart is two clusters', () => {
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 10), wide('bob', 'openai', 'Withdraw has no owner comparison', 12)]), ['AGREED', 'same_claim']);
  assert.deepEqual(statusOf([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 10), wide('bob', 'openai', 'No owner comparison in withdraw', 13)]), ['AGREED', 'same_claim']);
  const far = buildClusters([wide('alice', 'anthropic', 'Withdraw has no owner comparison', 10), wide('bob', 'openai', 'Withdraw has no owner comparison', 40)], { reader: two });
  assert.equal(far.clusters.length, 2);
});

test('sameDefect needs a shared line and a shared subject', () => {
  const a = { title: 'Missing signer check on authority', surface: 'S1', location: ['a.rs:5'] };
  assert.equal(sameDefect(a, { title: 'anything', surface: 'S1', location: ['a.rs:5'] }), true);
  assert.equal(sameDefect(a, { title: 'anything', surface: 'S1', location: ['a.rs:6'] }), false);
  assert.equal(sameDefect(a, { title: 'Authority is not a signer', surface: 'S3', location: ['a.rs:5'] }), true);
  // "missing" and "check" are noise words: they do not make two titles the same subject.
  assert.equal(sameDefect(a, { title: 'Missing overflow check', surface: 'S3', location: ['a.rs:5'] }), false);
  assert.equal(sameDefect({ title: 'x', location: ['a.rs:5'] }, { title: 'y', location: ['a.rs:5'] }), false);
});
