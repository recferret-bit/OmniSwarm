import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SWEEP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'secret-sweep.sh');
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', ...args], { cwd, encoding: 'utf8' });
// Built at runtime so no key shape is ever written into this repository.
const fake = { openrouter: `sk-or-v1-${'0123456789abcdef'.repeat(4)}`, xai: `xai-${'Ab3'.repeat(26)}`, zai: `${'9f'.repeat(16)}.${'Zq7'.repeat(5)}x`, env: `OPENROUTER_API_KEY=${'K7'.repeat(20)}` };

// files: {rel: text}, committed in one commit; `later` is committed then deleted, so it lives only in history.
function repo(files, later = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-repo-'));
  git(dir, 'init', '-q');
  const commit = (entries) => {
    for (const [rel, text] of Object.entries(entries)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fixture');
  };
  commit({ 'README.md': 'fixture\n', ...files });
  if (later) { commit(later); for (const rel of Object.keys(later)) fs.rmSync(path.join(dir, rel)); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'remove'); }
  return dir;
}

const sweep = (dir, env = {}) => spawnSync('bash', [SWEEP], { cwd: dir, encoding: 'utf8', env: { ...process.env, SECRET_SWEEP_NO_GITLEAKS: '1', ...env } });

test('a clean repository with short test shapes and .env.example passes', () => {
  const result = sweep(repo({ 'apps/api/.env.example': 'ZAI_API_KEY=\n', 'test.mjs': "const k = 'sk-proj-AAAAAAAAAAAAAAAAAAAA'; const e = { XAI_API_KEY: 'dummy-fixture-only' };\n" }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /secret sweep ok/);
});

test('OpenRouter, xAI, Z.ai and env-assigned provider keys fail, also when only history holds them', () => {
  for (const [name, value] of Object.entries(fake)) {
    const result = sweep(repo({}, { 'src/config.js': `export const key = "${value}";\n` }));
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /secret pattern matched git history/, name);
  }
});

test('every tracked env file except .env.example fails, as do reports/ and runtime/node_modules/', () => {
  for (const rel of ['.env', '.env.local', 'apps/web/.env.production', 'reports/run/meta.json', 'runtime/node_modules/x/index.js']) {
    const result = sweep(repo({ [rel]: 'x\n' }));
    assert.equal(result.status, 1, rel);
    assert.match(result.stderr, /tracked reports\/, pocs\/, runtime\/node_modules\/ or an env file/, rel);
  }
});

test('a tracked env file passes only when every line is a NEXT_PUBLIC_* assignment', () => {
  const pub = '# public\nNEXT_PUBLIC_NETWORK=testnet\n\nNEXT_PUBLIC_API_MOCK=0\n';
  assert.equal(sweep(repo({ 'apps/web/.env': pub, 'apps/web/.env.development': pub })).status, 0);
  for (const body of [`${pub}SESSION_SECRET=abc\n`, 'API_ORIGIN=http://127.0.0.1:8080\n', 'export NEXT_PUBLIC_X=1\n']) {
    const result = sweep(repo({ 'apps/web/.env': body }));
    assert.equal(result.status, 1, body);
    assert.match(result.stderr, /or an env file/, body);
  }
});

test('gitleaks runs when installed, and its finding fails the sweep', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gitleaks-'));
  fs.writeFileSync(path.join(bin, 'gitleaks'), '#!/bin/sh\nif [ "$1" = version ]; then echo 8.30.1; exit 0; fi\necho "leak" >&2\nexit 3\n', { mode: 0o755 });
  const result = sweep(repo({}), { SECRET_SWEEP_NO_GITLEAKS: '', PATH: `${bin}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gitleaks found a secret/);
});
