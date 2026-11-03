import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(ROOT, 'scripts', 'report-fixtures', 'w05-run');
const run = (script, args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w05-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

test('demo steps derive one folder per reviewer and keep the run complete', () => {
  const dir = copyFixture();
  const derived = run('reviewer-reports.mjs', [dir]);
  assert.equal(derived.status, 0, derived.stderr);
  for (const id of ['cli-claude-opus', 'key-zai-glm-5-3', 'openrouter-qwen-qwen3-8-max', 'scripted-baseline']) {
    for (const name of ['report.json', 'report.md', 'report.html', 'usage.json']) {
      assert.equal(fs.existsSync(path.join(dir, 'reviewers', id, name)), true, name);
    }
    assert.ok(fs.readdirSync(path.join(dir, 'reviewers', id, 'passes')).length > 0);
  }
  const html = fs.readFileSync(path.join(dir, 'reviewers', 'key-zai-glm-5-3', 'report.html'), 'utf8');
  assert.match(html, /Approach 2 · API key · vendor zai · model glm-5\.3 · 2 passes · 63 calls · \$0\.41/);
  assert.match(html, /Content-Security-Policy/);
  const nonce = html.match(/script-src &#39;nonce-([A-Za-z0-9+/=]{32,})&#39;/)[1];
  assert.match(html, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">`));
  assert.match(html, /id="search-box"/);
  const index = fs.readFileSync(path.join(dir, 'reviewers.html'), 'utf8');
  for (const heading of ['Local subscriptions', 'API keys', 'OpenRouter', 'Demo']) assert.match(index, new RegExp(heading));
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'reviewers', 'key-zai-glm-5-3', 'report.json'), 'utf8'));
  assert.deepEqual(report.findings.map((row) => row.claimId), ['key-zai-glm-5-3-s2-input#0', 'key-zai-glm-5-3-s3-logic#0']);
  assert.ok(report.findings.every((row) => row.status === 'MODEL_ASSERTION'));
  const usage = JSON.parse(fs.readFileSync(path.join(dir, 'reviewers', 'scripted-baseline', 'usage.json'), 'utf8'));
  assert.equal(usage.totals.calls, 10);
  const roll = JSON.parse(fs.readFileSync(path.join(dir, 'reviewers', 'by-provider', 'openrouter-alibaba.json'), 'utf8'));
  assert.deepEqual(roll.reviewers, ['openrouter-qwen-qwen3-8-max']);
  const checked = run('report-contract.mjs', [dir]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /COMPLETE/);
});

test('a missing surface stays in the index as INCOMPLETE', () => {
  const dir = copyFixture();
  fs.rmSync(path.join(dir, 'submissions', 'key-zai-glm-5-3-s2-input.json'));
  assert.equal(run('reviewer-reports.mjs', [dir]).status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'reviewers', 'key-zai-glm-5-3', 'report.json'), 'utf8'));
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.gaps[0].surface, 'S2');
  assert.match(fs.readFileSync(path.join(dir, 'reviewers.html'), 'utf8'), /key-zai-glm-5-3/);
  assert.match(fs.readFileSync(path.join(dir, 'reviewers.html'), 'utf8'), /INCOMPLETE/);
});

test('missing usage files become one stub pass per surface', () => {
  const dir = copyFixture();
  fs.rmSync(path.join(dir, 'harness', 'usage', 'scripted-baseline'), { recursive: true });
  assert.equal(run('reviewer-reports.mjs', [dir]).status, 0);
  const usage = JSON.parse(fs.readFileSync(path.join(dir, 'reviewers', 'scripted-baseline', 'usage.json'), 'utf8'));
  assert.equal(usage.passes.length, 3);
  assert.ok(usage.passes.every((row) => row.stop === 'submitted'));
});

test('an unexpected auditor file is still rejected and a bad reviewer report is named', () => {
  const dir = copyFixture();
  run('reviewer-reports.mjs', [dir]);
  fs.writeFileSync(path.join(dir, 'auditors', 'stray.json'), '{}\n');
  const stray = run('report-contract.mjs', [dir]);
  assert.equal(stray.status, 2);
  assert.match(stray.stderr, /unexpected auditor stray/);
  fs.rmSync(path.join(dir, 'auditors', 'stray.json'));
  fs.writeFileSync(path.join(dir, 'reviewers', 'cli-claude-opus', 'report.json'), '{"reviewer":{"family":"foo"}}\n');
  const bad = run('report-contract.mjs', [dir]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /reviewers\/cli-claude-opus\/report\.json/);
});
