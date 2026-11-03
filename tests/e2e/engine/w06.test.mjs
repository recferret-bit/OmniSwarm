import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGolden } from '../../../scripts/debate-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the plan prints the orchestrator, debate rounds and the cluster cap', () => {
  const result = spawnSync(path.join(ROOT, 'bin', 'audit'), ['run', '--repo', 'eval/golden/near-escrow', '--reviewers', 'scripted:baseline,scripted:paranoid,scripted:wrong,scripted:lazy', '--orchestrator', 'recommended', '--surface', 's1', '--plan'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, OMNI_DEMO: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /debate rounds 2 \(max 3\)/);
  assert.match(result.stdout, /debate cluster cap 25/);
  assert.match(result.stdout, /Orchestrator: recommended/);
});

test('scripted debate writes clusters, anonymized rounds, discarded quotes and a general review', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'w06-'));
  runGolden(path.join(ROOT, 'eval/golden/near-escrow'), out, { rounds: 3, seed: 1, reviewers: ['scripted-baseline', 'scripted-paranoid', 'scripted-wrong', 'scripted-lazy'] });
  const clusters = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'clusters.json'), 'utf8'));
  assert.ok(clusters.clusters.length >= 1);
  const round1 = fs.readdirSync(path.join(out, 'debate', 'round-1'));
  assert.ok(round1.every((name) => name.startsWith('Reviewer ')));
  assert.equal(JSON.stringify(fs.readdirSync(path.join(out, 'debate', 'round-1'))).includes('glm'), false);
  const citations = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'citations.json'), 'utf8'));
  assert.ok(citations.some((row) => row.valid === false));
  const adjudication = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'adjudication.json'), 'utf8'));
  assert.ok(adjudication.some((row) => row.finalStatus === 'LIKELY'));
  assert.match(fs.readFileSync(path.join(out, 'general-review.md'), 'utf8'), /Model agreement and passing checks do not certify security\./);
  const trace = fs.readFileSync(path.join(out, 'debate', 'trace.jsonl'), 'utf8');
  assert.match(trace, /"template":"judge"/);
  assert.match(trace, /"template":"general_review"/);
  assert.throws(() => runGolden(path.join(ROOT, 'eval/golden/near-escrow'), path.join(out, 'fault'), { fault: 'general-review', reviewers: [{ id: 'scripted-baseline' }] }));
  const health = JSON.parse(fs.readFileSync(path.join(out, 'fault', 'report-health.json'), 'utf8'));
  assert.equal(health.state, 'INCOMPLETE');
});
