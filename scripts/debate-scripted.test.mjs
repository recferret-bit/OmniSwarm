import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { debateBudgetDecision, toolDefinitions as debaterTools } from './bridge-tools-debater.mjs';
import { acceptGeneralReview, toolDefinitions as orchestratorTools } from './bridge-tools-orchestrator.mjs';
import { runGolden } from './debate-run.mjs';

test('scripted debate discards bad quotes, marks lazy, and stops early', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'debate-'));
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = runGolden(path.join(repo, 'eval/golden/near-escrow'), out, { rounds: 3, seed: 1 });
  const round1 = fs.readdirSync(path.join(out, 'debate', 'round-1')).map((name) => JSON.parse(fs.readFileSync(path.join(out, 'debate', 'round-1', name), 'utf8')));
  const debated = result.clusters.filter((row) => row.status === 'QUEUED').map((row) => row.id);
  for (const id of debated) assert.equal(round1.filter((row) => row.clusterId === id && row.devilAdvocate).length, 1);
  const citations = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'citations.json'), 'utf8'));
  assert.ok(citations.some((row) => row.valid === false));
  const round2 = fs.readdirSync(path.join(out, 'debate', 'round-2')).map((name) => JSON.parse(fs.readFileSync(path.join(out, 'debate', 'round-2', name), 'utf8')));
  assert.ok(round2.some((row) => row.conformitySuspect));
  const adjudication = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'adjudication.json'), 'utf8'));
  assert.ok(adjudication.some((row) => row.finalStatus === 'LIKELY'));
  assert.match(fs.readFileSync(path.join(out, 'general-review.md'), 'utf8'), /Model agreement and passing checks do not certify security\./);
  assert.equal(JSON.stringify(round1).match(/claude|codex|grok|glm|qwen/), null);
});

test('the debater budget and the orchestrator tool list are closed', () => {
  assert.equal(debaterTools().length, 5);
  assert.equal(debaterTools().some((tool) => tool.name === 'run_existing_tests'), false);
  let record = { calls: 0 };
  for (let i = 0; i < 12; i++) record = debateBudgetDecision(record, 'read_file').record;
  assert.match(debateBudgetDecision(record, 'read_file').text, /submit_debate_turn/);
  assert.equal(orchestratorTools().some((tool) => tool.name === 'run_existing_tests'), false);
  assert.throws(() => acceptGeneralReview({ topFindings: [{ clusterId: 'NOPE' }] }, ['CLUSTER-1']), /new_finding_in_general_review/);
});
