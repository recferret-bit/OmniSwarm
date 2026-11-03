import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runPanel } from '../eval/panel.mjs';
import { adjudicate } from './verify-and-adjudicate.mjs';
import { loadPhases, runPhases } from './orchestrator-phases.mjs';
import { SCRIPTS, builtinWithReport, phaseContext, reportRun, runFromPanel, tempDir, finding } from './debate-test-run.mjs';

const GOLDEN = path.join(SCRIPTS, '..', 'eval', 'golden', 'near-escrow');
const expected = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'expected.json'), 'utf8'));
const at = (item) => (row) => row.locations.some((loc) => loc === `${item.file}:${item.startLine}`);

test('findings-and-scores rows carry the debate outcome, joined by claim id', async () => {
  const panel = await runPanel(GOLDEN, expected, tempDir('panel-'));
  const { out, reviewers } = runFromPanel(panel);
  const ctx = phaseContext({ out, reviewers, target: GOLDEN, orchestrator: 'scripted:judge' });
  await runPhases(await loadPhases({ builtin: builtinWithReport(out), dir: SCRIPTS }), ctx);
  assert.deepEqual(ctx.stageFailures, []);
  const { scoredFindings } = await adjudicate(out);
  const debate = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'clusters.json'), 'utf8')).clusters;
  for (const row of scoredFindings) {
    const cluster = debate.find((c) => c.id === row.debateClusterId);
    assert.ok(cluster.claimIds.every((id) => row.claimIds.includes(id)), row.title);
    assert.ok(row.finalStatus && row.judge && Number.isInteger(row.debateRounds) && row.severityReason, row.title);
  }
  for (const bug of expected.bugs) assert.equal(scoredFindings.find(at(bug)).finalStatus, 'LIKELY', bug.title);
  for (const decoy of expected.decoys) {
    const row = scoredFindings.find(at(decoy));
    assert.equal(row.finalStatus, 'REFUTED', decoy.claim);
    assert.equal(row.score, 0);
  }
  assert.equal(scoredFindings.at(-1).finalStatus, 'REFUTED');
});

test('a run without debate/ keeps today\'s rows', async () => {
  const { out } = reportRun(['cli:claude:opus'], { 'cli-claude-opus': { findings: [finding('Bug', ['src/a.ts:1'])] } });
  const { scoredFindings } = await adjudicate(out);
  assert.equal(Object.hasOwn(scoredFindings[0], 'finalStatus'), false);
  assert.equal(Object.hasOwn(scoredFindings[0], 'debateClusterId'), false);
  assert.equal(scoredFindings[0].status, 'MODEL_ASSERTION');
});
