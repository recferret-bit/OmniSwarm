import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHAPES = path.join(ROOT, 'tools', 'secret-shapes.txt');
const SWEEP = path.join(ROOT, 'tools', 'secret-sweep.sh');
const HYGIENE = path.join(ROOT, 'infra', 'deploy', 'log-hygiene.sh');
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', ...args], { cwd, encoding: 'utf8' });

// One runtime-built sample per shared rule, so no key shape is ever written into this repository.
const SAMPLES = {
  'github-token': [`ghp_${'Z'.repeat(36)}`, `github_pat_${'A1_'.repeat(21)}`],
  'provider-key': [`sk-ant-${'a1'.repeat(21)}`, `sk-proj-${'B2'.repeat(21)}`, `sk-or-v1-${'0123456789abcdef'.repeat(4)}`, `xai-${'Ab3'.repeat(24)}`, `${'9f'.repeat(16)}.${'Zq7'.repeat(5)}x`],
  'provider-env-key': [`ZAI_API_KEY=${'K7'.repeat(16)}`, `OPENROUTER_API_KEY: "${'Q9'.repeat(16)}"`],
};

const sharedRules = () => fs.readFileSync(SHAPES, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.slice(0, line.indexOf('|')));

function sweep(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shapes-repo-'));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'config.txt'), `${text}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  const result = spawnSync('bash', [SWEEP], { cwd: dir, encoding: 'utf8', env: { ...process.env, SECRET_SWEEP_NO_GITLEAKS: '1' } });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

// log-hygiene.sh against an engine worker.log, with journalctl and docker stubbed to print nothing.
function hygiene(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shapes-logs-'));
  const bin = path.join(dir, 'bin');
  const etc = path.join(dir, 'etc');
  const runs = path.join(dir, 'runs', 'req-1');
  for (const sub of [bin, etc, runs]) fs.mkdirSync(sub, { recursive: true });
  for (const tool of ['journalctl', 'docker']) fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(etc, 'worker.env'), `RUNS_ROOT=${path.join(dir, 'runs')}\n`);
  fs.writeFileSync(path.join(runs, 'worker.log'), `${text}\n`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, OMNI_ETC: etc, OMNI_PROJECT: 'shapes-test', OMNI_ALERT_WEBHOOK_URL: '' };
  const result = spawnSync('bash', [HYGIENE], { encoding: 'utf8', env });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test('both scripts read the key shapes from tools/secret-shapes.txt instead of their own copies', () => {
  for (const script of [SWEEP, HYGIENE]) {
    const text = fs.readFileSync(script, 'utf8');
    assert.match(text, /secret-shapes\.txt/, script);
    for (const prefix of ['ghp_', 'sk-or-v1-', 'xai-', 'API_KEY|AUTH_TOKEN']) assert.equal(text.includes(prefix), false, `${path.basename(script)} still holds ${prefix}`);
  }
  assert.deepEqual(sharedRules().sort(), Object.keys(SAMPLES).sort(), 'every shared rule has a sample here');
});

test('every shared shape fails the history sweep and is a log-hygiene hit, named by its rule only', () => {
  for (const [rule, values] of Object.entries(SAMPLES)) {
    for (const value of values) {
      const swept = sweep(value);
      assert.equal(swept.status, 1, `sweep ${rule}: ${swept.stderr}`);
      assert.match(swept.stderr, /secret pattern matched git history/);
      const scanned = hygiene(`clone failed: ${value}`);
      assert.equal(scanned.status, 1, `hygiene ${rule}: ${scanned.stdout}${scanned.stderr}`);
      assert.match(scanned.stdout, new RegExp(`^HIT ${rule} in run:req-1_worker\\.log$`, 'm'));
      assert.equal(`${scanned.stdout}${scanned.stderr}`.includes(value), false, 'log-hygiene printed the secret');
    }
  }
});

test('short shapes and clean logs pass both', () => {
  const inert = "const k = 'sk-proj-AAAAAAAAAAAAAAAAAAAA'; ZAI_API_KEY=dummy-fixture-only";
  assert.equal(sweep(inert).status, 0);
  const scanned = hygiene(inert);
  assert.equal(scanned.status, 0, scanned.stdout + scanned.stderr);
  assert.match(scanned.stdout, /^clean: /m);
});
