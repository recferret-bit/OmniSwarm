import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBeforeCall, decideCall, loadBudget } from './bridge-budget.mjs';
import { withFileLock } from './fs-lock.mjs';

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
  // The refusal is recorded for the session owner, and stays recorded after a submit.
  assert.equal(record.exhausted, true);
  assert.ok(Date.parse(record.exhaustedAt));
  assert.equal(decideCall({ calls: 2, graceUsed: 3, filesRead: [] }, { tool: 'read_file', toolBudget: 2 }).error, 'budget_exhausted');
});

test('one reviewer on several surfaces in parallel bridges never loses a count', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-race-'));
  fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
  const module = new URL('./bridge-budget.mjs', import.meta.url).href;
  const [bridges, calls] = [4, 25];
  const child = (surface) => new Promise((resolve, reject) => {
    const program = `const { createBeforeCall } = await import(${JSON.stringify(module)});
      const hook = createBeforeCall({ reportDir: ${JSON.stringify(root)}, reviewerId: 'cli-claude-opus', surface: '${surface}', pass: 1, toolBudget: 200 });
      for (let i = 0; i < ${calls}; i++) await hook({ pendingArgs: { path: 'f' + i + '.rs' } }, 'read_file');`;
    const proc = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (chunk) => { err += chunk; });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all(Array.from({ length: bridges }, (_, i) => child(`S${i + 1}`)));
  const saved = loadBudget(root, 'cli-claude-opus');
  for (let i = 1; i <= bridges; i++) assert.equal(saved.passes[`s${i}:1`]?.calls, calls, `surface s${i}`);
  assert.deepEqual(fs.readdirSync(path.join(root, 'harness')).filter((name) => name.includes('.lock')), [], 'every lock is released');
});

test('a lock left by a dead process is broken; a live holder is waited for', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-lock-'));
  const lock = path.join(dir, 'x.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: new Date().toISOString() }));
  assert.equal(await withFileLock(lock, () => 'taken'), 'taken');
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  await assert.rejects(withFileLock(lock, () => 'never', { waitMs: 50, staleMs: 60_000 }), /timed out/);
  assert.equal(await withFileLock(lock, () => 'aged out', { waitMs: 1000, staleMs: 0 }), 'aged out');
});
