import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PHASE_NAMES, loadPhases, runPhases } from './orchestrator-phases.mjs';

const calls = [];
const builtin = Object.fromEntries(['prepare', 'tests', 'review', 'crosscheck', 'report'].map((name) => [name, async () => { calls.push(name); }]));
const emptyDir = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'phases-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('the registry lists every phase in order and stubs the later waves', async (t) => {
  assert.deepEqual(PHASE_NAMES, ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report']);
  const phases = await loadPhases({ builtin, dir: emptyDir(t) });
  assert.deepEqual(phases.map((p) => p.name), PHASE_NAMES);
  assert.deepEqual(phases.filter((p) => p.stub).map((p) => p.name), ['debate', 'adjudicate', 'general-review']);
  await assert.rejects(loadPhases({ builtin: { ...builtin, review: undefined }, dir: emptyDir(t) }), /no implementation/);
});

test('phase files replace a stub or add a phase after a named one, without editing the orchestrator', async (t) => {
  const dir = emptyDir(t);
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-debate.mjs'), "export const phase = { name: 'debate', async run(ctx) { ctx.log.push('debate'); } };\n");
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-probe.mjs'), "export const phase = { name: 'probe', after: 'crosscheck', async run(ctx) { ctx.log.push('probe'); } };\n");
  const phases = await loadPhases({ builtin, dir });
  assert.deepEqual(phases.map((p) => p.name), ['prepare', 'tests', 'review', 'crosscheck', 'probe', 'debate', 'adjudicate', 'general-review', 'report']);
  const ctx = { log: [] };
  await runPhases(phases, ctx);
  assert.deepEqual(ctx.log, ['probe', 'debate']);
});

test('bad phase files are rejected', async (t) => {
  const dir = emptyDir(t);
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-tests.mjs'), "export const phase = { name: 'tests', async run() {} };\n");
  await assert.rejects(loadPhases({ builtin, dir }), /cannot replace the built-in/);
  fs.rmSync(path.join(dir, 'orchestrator-phase-tests.mjs'));
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-lost.mjs'), "export const phase = { name: 'lost', after: 'nowhere', async run() {} };\n");
  await assert.rejects(loadPhases({ builtin, dir }), /"after" must name an existing phase/);
  fs.rmSync(path.join(dir, 'orchestrator-phase-lost.mjs'));
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-wrong.mjs'), "export const phase = { name: 'other', async run() {} };\n");
  await assert.rejects(loadPhases({ builtin, dir }), /must export phase/);
});

test('a failed required phase skips the rest, still tears down once and runs report', async (t) => {
  const log = [];
  const phases = await loadPhases({
    builtin: { ...builtin, review: async () => { throw new Error('boom'); }, crosscheck: async () => { log.push('crosscheck'); }, report: async () => { log.push('report'); } },
    dir: emptyDir(t),
  });
  const ctx = { stageFailures: [], teardown: async () => { log.push('teardown'); }, fail: (error) => { log.push(`fail:${error.message}`); } };
  const { failed } = await runPhases(phases, ctx);
  assert.equal(failed, true);
  assert.deepEqual(log, ['fail:boom', 'teardown', 'report']);
});

test('an optional phase failure is recorded but does not stop the run', async (t) => {
  const dir = emptyDir(t);
  fs.writeFileSync(path.join(dir, 'orchestrator-phase-general-review.mjs'), "export const phase = { name: 'general-review', optional: true, async run() { throw new Error('nope'); } };\n");
  const log = [];
  const phases = await loadPhases({ builtin: { ...builtin, report: async () => { log.push('report'); } }, dir });
  const ctx = { stageFailures: [] };
  const { failed } = await runPhases(phases, ctx);
  assert.equal(failed, false);
  assert.deepEqual(ctx.stageFailures, ['phase_failed:general-review:nope']);
  assert.deepEqual(log, ['report']);
});
