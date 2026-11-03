import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClusters } from './debate-cluster.mjs';
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

test('the queue is ordered by severity weight times disagreement and caps at the limit', () => {
  const rows = [
    claim('a', 'v1', 'Low', 2, { severity: 'low' }),
    claim('b', 'v1', 'Medium', 10, { severity: 'medium' }),
    claim('c', 'v1', 'Split', 20, { severity: 'medium' }), claim('d', 'v1', 'Split', 20, { severity: 'low' }),
    claim('e', 'v1', 'High', 30, { severity: 'high' }),
    claim('f', 'v1', 'Critical', 40, { severity: 'critical' }),
  ];
  const built = buildClusters(rows, { reader, maxClusters: 3 });
  // critical 5, high 4, split medium 3*(1+1)=6, medium 3, low 2.
  assert.deepEqual(built.clusters.filter((row) => row.status === 'QUEUED').map((row) => row.primaryTitle), ['Split', 'Critical', 'High']);
  assert.deepEqual(built.clusters.filter((row) => row.status === 'CAPPED').map((row) => row.primaryTitle), ['Medium', 'Low']);
  assert.deepEqual(built.coverageGaps.map((row) => row.reason), ['debate_cap', 'debate_cap']);
});
