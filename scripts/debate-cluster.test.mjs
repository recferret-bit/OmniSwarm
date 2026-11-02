import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClusters } from './debate-cluster.mjs';

test('a two-vendor cited cluster is AGREED and the queue caps at 25', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clusters-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'lib.rs'), 'fn bug() { missing check }\n');
  const agreed = buildClusters([
    { auditor: 'alice', title: 'Bug', surface: 'S1', severity: 'high', location: ['src/lib.rs:1'], quote: 'missing check', claimId: 'a#0' },
    { auditor: 'bob', title: 'Bug', surface: 'S1', severity: 'high', location: ['src/lib.rs:1'], quote: 'missing check', claimId: 'b#0' },
  ], { sourceRoot: root, vendors: { alice: 'anthropic', bob: 'openai' } });
  assert.equal(agreed.clusters[0].status, 'AGREED');
  assert.equal(agreed.clusters[0].rounds, 0);
  const many = Array.from({ length: 30 }, (_, i) => ({ auditor: `r${i}`, title: `Bug ${i}`, surface: 'S1', severity: i % 2 ? 'high' : 'low', location: ['src/lib.rs:1'], quote: 'nope', claimId: `r${i}#0` }));
  const capped = buildClusters(many, { sourceRoot: root, maxClusters: 25, vendors: Object.fromEntries(many.map((row) => [row.auditor, row.auditor])) });
  assert.equal(capped.clusters.filter((row) => row.status === 'QUEUED').length, 25);
  assert.equal(capped.coverageGaps.length, 5);
  assert.ok(capped.coverageGaps.every((row) => row.reason === 'debate_cap'));
});
