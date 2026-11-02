import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBeforeCall, decideCall, loadBudget } from './bridge-budget.mjs';

test('reads count and submits do not, and a new bridge continues the count', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
  fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
  const hook = createBeforeCall({ reportDir: root, reviewerId: 'scripted-lazy', surface: 'S1', pass: 1, toolBudget: 40 });
  for (let i = 0; i < 7; i++) await hook({ pendingArgs: { path: `src/f${i}.rs` } }, 'read_file');
  await hook({ pendingArgs: {} }, 'submit_audit_report');
  const saved = loadBudget(root, 'scripted-lazy');
  assert.equal(saved.passes['s1:1'].calls, 7);
  assert.equal(saved.passes['s1:1'].filesRead.length, 7);
  const resumed = createBeforeCall({ reportDir: root, reviewerId: 'scripted-lazy', surface: 'S1', pass: 1, toolBudget: 40 });
  await resumed({ pendingArgs: { path: 'src/more.rs' } }, 'read_file');
  assert.equal(loadBudget(root, 'scripted-lazy').passes['s1:1'].calls, 8);
});

test('N=2 returns finalize text for three calls and then an error; submit still works', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-grace-'));
  fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
  const hook = createBeforeCall({ reportDir: root, reviewerId: 'r', surface: 'S1', pass: 1, toolBudget: 2 });
  assert.equal(await hook({ pendingArgs: { path: 'a.rs' } }, 'read_file'), null);
  assert.equal(await hook({ pendingArgs: { path: 'b.rs' } }, 'read_file'), null);
  for (const left of [3, 2, 1]) {
    const verdict = await hook({ pendingArgs: {} }, 'read_file');
    assert.match(verdict.text, new RegExp(`budget exhausted: call submit_audit_report now \\(${left} calls left\\)`));
  }
  await assert.rejects(hook({ pendingArgs: {} }, 'read_file'), /budget_exhausted/);
  assert.equal(await hook({ pendingArgs: {} }, 'submit_audit_report'), null);
  const record = loadBudget(root, 'r').passes['s1:1'];
  assert.equal(record.calls, 2);
  assert.ok(record.finalizeOnlyAt);
  assert.equal(decideCall({ calls: 2, graceUsed: 3, filesRead: [] }, { tool: 'read_file', toolBudget: 2 }).error, 'budget_exhausted');
});
