import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { portBase, slugify, worktreeEnv } from './worktree-env.mjs';

const TOOL = new URL('./worktree-env.mjs', import.meta.url).pathname;

test('slugs for the database and the reports directory', () => {
  assert.equal(slugify('wave/w03-api-reviewers', '_'), 'wave_w03_api_reviewers');
  assert.equal(slugify('wave/w03-api-reviewers', '-'), 'wave-w03-api-reviewers');
  assert.throws(() => slugify('///', '_'));
});

test('env for wave/w03-api-reviewers', () => {
  const env = worktreeEnv('wave/w03-api-reviewers');
  assert.equal(env.DATABASE_URL, 'postgres://localhost:5432/omniswarm_wave_w03_api_reviewers');
  assert.equal(env.OMNI_REPORTS_DIR, 'reports/wt-wave-w03-api-reviewers');
  const base = Number(env.OMNI_PORT_BASE);
  assert.ok(base >= 4100 && base <= 4900 && base % 100 === 0);
  assert.equal(Number(env.OMNI_API_PORT), base + 1);
  assert.equal(Number(env.OMNI_LANDING_PORT), base + 173);
});

test('port base is stable and every value is in range', () => {
  assert.equal(portBase('wave/w01-reviewer-registry'), portBase('wave/w01-reviewer-registry'));
  for (let i = 0; i < 200; i++) { const b = portBase(`branch-${i}`); assert.ok(b >= 4100 && b <= 4900 && b % 100 === 0); }
  assert.ok(new Set(Array.from({ length: 200 }, (_, i) => portBase(`branch-${i}`))).size > 1);
});

test('long branch names stay within the Postgres identifier limit and stay distinct', () => {
  const a = worktreeEnv(`wave/${'a'.repeat(80)}-one`).DATABASE_URL.split('/').pop();
  const b = worktreeEnv(`wave/${'a'.repeat(80)}-two`).DATABASE_URL.split('/').pop();
  assert.ok(a.length <= 63 && b.length <= 63);
  assert.notEqual(a, b);
});

test('CLI writes .env.worktree: two branches differ, a rerun is identical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'));
  const run = (branch, name) => { const out = path.join(dir, name); const r = spawnSync(process.execPath, [TOOL, '--branch', branch, '--out', out], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return fs.readFileSync(out, 'utf8'); };
  const a1 = run('wave/w03-api-reviewers', 'a');
  const a2 = run('wave/w03-api-reviewers', 'a2');
  const b = run('wave/w08-intake-api', 'b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^OMNI_PORT_BASE=\d{4}$/m);
  assert.match(a1, /^DATABASE_URL=.*\/omniswarm_wave_w03_api_reviewers$/m);
  assert.match(a1, /^OMNI_REPORTS_DIR=reports\/wt-wave-w03-api-reviewers$/m);
  assert.notEqual(spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
