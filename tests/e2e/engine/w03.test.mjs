import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../../packages/schemas/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (args, env = {}) => spawnSync(path.join(ROOT, 'bin', 'audit'), args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 180_000 });

test('plan lists nearai and scripted reviewers without printing a key', () => {
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'nearai:Qwen/Qwen3.8-Max,scripted:baseline', '--surface', 's1', '--plan'], { NEARAI_API_KEY: 'nk-secret' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nearai-qwen-qwen3-8-max\s+nearai\s+alibaba\s+Qwen\/Qwen3\.8-Max/);
  assert.match(result.stdout, /env NEARAI_API_KEY\s+transport api-acp/);
  assert.match(result.stdout, /scripted-baseline\s+scripted\s+scripted/);
  assert.equal(result.stdout.includes('nk-secret'), false);
});

test('removed providers are refused at plan time', () => {
  const zai = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'key:zai:glm-5.3', '--surface', 's1', '--plan'], { ZAI_API_KEY: 'zk-stale' });
  assert.notEqual(zai.status, 0);
  assert.match(`${zai.stdout}\n${zai.stderr}`, /unknown provider zai/);
  const openrouter = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'openrouter:qwen/qwen3.8-max-0902', '--surface', 's1', '--plan']);
  assert.notEqual(openrouter.status, 0);
  assert.match(openrouter.stderr, /invalid reviewer spec/);
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
  // The host demo debates the committed submissions like the Docker demo: scripted judge, then the general review.
  const json = (rel) => JSON.parse(fs.readFileSync(path.join(out, rel), 'utf8'));
  const adjudication = json('debate/adjudication.json');
  assert.ok(adjudication.length > 0 && json('debate/clusters.json').clusters.length >= adjudication.length);
  assert.ok(adjudication.every((row) => row.judge.reviewerId === 'scripted-judge' || row.judge.reviewerId === 'triage'));
  assert.ok(fs.readdirSync(path.join(out, 'debate', 'round-1')).length > 0);
  assert.equal(validate('general-review', json('general-review.json')).ok, true);
  assert.equal(json('reviewers/index.json').groups.flatMap((g) => g.vendors.flatMap((v) => v.reviewers)).length, 4);
  const scored = json('findings-and-scores.json');
  assert.ok(scored.length > 0 && scored.every((row) => typeof row.finalStatus === 'string'), 'finalStatus reaches findings-and-scores.json');
});

// Demo step 2: the documented replay command, with the documented RELATIVE OMNI_HTTP_REPLAY.
// The nearai identity carries an `org/model` id, which audit-submission.mjs validates with validModelId.
test('a replayed nearai run reads, searches and submits through the bridge', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'w03-replay-'));
  fs.rmSync(out, { recursive: true });
  const result = run(['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'nearai:Qwen/Qwen3.8-Max', '--surface', 's1', '--passes', '1', '--out', out], {
    OMNI_DEMO_HOST: '1', OMNI_HTTP_REPLAY: 'engine/scripts/provider-fixtures/w03', NEARAI_API_KEY: 'nk-test',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const submissions = fs.readdirSync(path.join(out, 'submissions'));
  assert.ok(submissions.includes('nearai-qwen-qwen3-8-max-s1-auth.json'));
  const usage = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', 'nearai-qwen-qwen3-8-max', 's1-pass-1.json'), 'utf8'));
  assert.equal(usage.stop, 'submitted');
  // NEAR AI reports no usage.cost and no prices.nearai entry is configured: the run is unpriced, not free.
  assert.equal(usage.costSource, 'none');
  const tools = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'bridge-nearai-qwen-qwen3-8-max-s1-auth.json'), 'utf8')).map((row) => row.tool);
  assert.deepEqual(tools, ['read_file', 'search_code', 'submit_audit_report']);
  const committed = JSON.parse(fs.readFileSync(path.join(out, 'submissions', 'nearai-qwen-qwen3-8-max-s1-auth.json'), 'utf8'));
  assert.equal(JSON.stringify(committed).includes('src/lib.rs:30'), true);
  for (const name of fs.readdirSync(out, { recursive: true })) {
    const file = path.join(out, name);
    if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('nk-test'), false, `${name} contains a key`);
  }
});

test('check-agents --reviewers reports a missing NEAR AI key', () => {
  const env = { ...process.env };
  delete env.NEARAI_API_KEY;
  const missing = spawnSync(path.join(ROOT, 'bin', 'audit'), ['check-agents', '--reviewers', 'nearai:Qwen/Qwen3.8-Max'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /nearai: NEARAI_API_KEY missing/);
  const present = spawnSync(path.join(ROOT, 'bin', 'audit'), ['check-agents', '--reviewers', 'nearai:Qwen/Qwen3.8-Max'], { cwd: ROOT, encoding: 'utf8', env: { ...env, NEARAI_API_KEY: 'nk-test' } });
  assert.equal(present.status, 0, present.stderr);
  assert.match(present.stdout, /nearai: key present/);
  assert.equal(present.stdout.includes('nk-test'), false);
});
