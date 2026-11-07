import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costLedger } from './bridge-budget.mjs';
import { runReviewerPasses } from './reviewer-pass-loop.mjs';
import { budgetHealth } from './verification-health.mjs';

const REVIEWER = 'key-zai-glm-5-3';
const BUDGETS = { passes: 2, toolBudget: 5, maxCostUsd: 1 };
const usage = (out, surface, pass) => JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', REVIEWER, `${surface}-pass-${pass}.json`), 'utf8'));

// A stand-in for one API pass: it books its spend on the run ledger like api-acp-agent.mjs and commits a report.
function pricedPass(out, name, cost, seen) {
  return async ({ pass }) => {
    seen.push(`${name}:${pass}`);
    await costLedger(out, REVIEWER).add(cost);
    fs.mkdirSync(path.join(out, 'submissions'), { recursive: true });
    fs.writeFileSync(path.join(out, 'submissions', `${name}.json`), '{}');
    return { code: 0 };
  };
}

test('a reviewer whose run spend already reached the ceiling runs no pass, and budget health records it', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-ceiling-'));
  await costLedger(out, REVIEWER).add(1.5);
  const seen = [];
  const loop = await runReviewerPasses({ out, name: `${REVIEWER}-s1-auth`, reviewerId: REVIEWER, surface: 'S1', budgets: BUDGETS, runPass: pricedPass(out, 'x', 0, seen) });
  assert.deepEqual(seen, [], 'no pass ran');
  assert.equal(loop.result.skipped, true);
  for (const pass of [1, 2]) assert.equal(usage(out, 's1', pass).skipped, 'cost_ceiling');
  assert.deepEqual(loop.health, [{ reviewer: REVIEWER, job: `${REVIEWER}-s1-auth`, pass: 1, stop: 'cost', reason: 'cost_ceiling', submitted: false, spentUsd: 1.5, maxCostUsd: 1 }]);
  assert.deepEqual(budgetHealth(loop.health), { state: 'INCOMPLETE', budgetStops: [], errors: [`${REVIEWER}: budget_exhausted_without_submission`] });
});

test('spend on one surface counts against the same reviewer on its other surfaces and later passes', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-ceiling-surfaces-'));
  const seen = [];
  const first = await runReviewerPasses({ out, name: 's1-job', reviewerId: REVIEWER, surface: 'S1', budgets: BUDGETS, runPass: pricedPass(out, 's1-job', 1.2, seen) });
  // A fresh ceilings set: the second surface runs in another process or after a resume.
  const second = await runReviewerPasses({ out, name: 's2-job', reviewerId: REVIEWER, surface: 'S2', budgets: BUDGETS, ceilings: new Set(), runPass: pricedPass(out, 's2-job', 1.2, seen) });
  assert.deepEqual(seen, ['s1-job:1'], 'pass 2 of S1 and all of S2 are skipped');
  assert.equal(first.passesCompleted, 1);
  assert.equal(usage(out, 's1', 2).skipped, 'cost_ceiling');
  assert.equal(usage(out, 's2', 1).skipped, 'cost_ceiling');
  const health = budgetHealth([...first.health, ...second.health]);
  assert.deepEqual(health.budgetStops.map((row) => [row.job, row.pass, row.reason, row.spentUsd]), [['s1-job', 2, 'cost_ceiling', 1.2]]);
  assert.deepEqual(health.errors, [`${REVIEWER}: budget_exhausted_without_submission`], 'S2 has no report');
});

test('a later pass that submits nothing restores the archived report and does not count as completed', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-restore-'));
  const name = 'job';
  const seen = [];
  const loop = await runReviewerPasses({
    out, name, reviewerId: REVIEWER, surface: 'S1', budgets: { ...BUDGETS, maxCostUsd: null },
    runPass: async ({ pass }) => {
      seen.push(pass);
      if (pass === 1) {
        fs.mkdirSync(path.join(out, 'submissions'), { recursive: true });
        fs.writeFileSync(path.join(out, 'submissions', `${name}.json`), '{"pass":1}\n');
      }
      return { code: 0, stopReason: 'end_turn' };
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(loop.passesCompleted, 1);
  assert.equal(fs.readFileSync(path.join(out, 'submissions', `${name}.json`), 'utf8'), '{"pass":1}\n');
  assert.equal(fs.existsSync(path.join(out, 'submissions', `${name}-pass-1.json`)), true);
  assert.equal(usage(out, 's1', 2).submitted, false);
});

test('without a ceiling every pass runs', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-no-ceiling-'));
  const seen = [];
  await runReviewerPasses({ out, name: 'job', reviewerId: REVIEWER, surface: 'S1', budgets: { ...BUDGETS, maxCostUsd: null }, runPass: pricedPass(out, 'job', 5, seen) });
  assert.deepEqual(seen, ['job:1', 'job:2']);
});
