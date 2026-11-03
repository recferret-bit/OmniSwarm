import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (args, env = {}) => spawnSync(path.join(ROOT, 'bin', 'audit'), args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180_000 });

test('plan lists key, openrouter and scripted reviewers without printing a key', () => {
  const result = run(['run', '--repo', 'scripts/demo-fixture', '--reviewers', 'key:zai:glm-5.3,openrouter:qwen/qwen3.8-max-0902,scripted:baseline', '--surface', 's1', '--plan'], { ZAI_API_KEY: 'zk-secret', OPENROUTER_API_KEY: 'or-secret' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /key-zai-glm-5-3\s+key\s+zai\s+glm-5\.3\s+yes/);
  assert.match(result.stdout, /env ZAI_API_KEY,ZAI_BASE_URL/);
  assert.match(result.stdout, /openrouter\s+alibaba\s+qwen\/qwen3\.8-max-0902/);
  assert.match(result.stdout, /scripted-baseline\s+scripted\s+scripted/);
  assert.equal(result.stdout.includes('zk-secret'), false);
  assert.equal(result.stdout.includes('or-secret'), false);
});

test('demo refuses a foreign repo and the host snapshot stamps the banner', () => {
  const refused = run(['demo', '--repo', '/tmp/x']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /demo runs only the bundled fixture/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'w03-demo-'));
  fs.rmSync(out, { recursive: true });
  const demo = run(['demo', '--no-docker', '--surface', 's1', '--out', out]);
  assert.equal(demo.status, 0, `${demo.stderr}\n${demo.stdout}`);
  const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /DEMO — not a review/);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.demo, true);
  const submissions = fs.readdirSync(path.join(out, 'submissions'));
  assert.equal(submissions.length, 4);
  const bridgeLog = fs.readdirSync(path.join(out, 'harness')).find((name) => name.startsWith('bridge-scripted-'));
  assert.ok(bridgeLog);
  assert.match(fs.readFileSync(path.join(out, 'harness', bridgeLog), 'utf8'), /read_file/);
});

test('check-agents --reviewers reports a missing openrouter key', () => {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  const missing = spawnSync(path.join(ROOT, 'bin', 'audit'), ['check-agents', '--reviewers', 'openrouter:qwen/qwen3.8-max-0902'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /openrouter: OPENROUTER_API_KEY missing/);
  const present = spawnSync(path.join(ROOT, 'bin', 'audit'), ['check-agents', '--reviewers', 'openrouter:qwen/qwen3.8-max-0902'], { cwd: ROOT, encoding: 'utf8', env: { ...env, OPENROUTER_API_KEY: 'or-test' } });
  assert.equal(present.status, 0, present.stderr);
  assert.match(present.stdout, /openrouter: key present/);
  assert.equal(present.stdout.includes('or-test'), false);
});
