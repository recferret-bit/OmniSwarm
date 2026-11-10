import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adjudicate } from './verify-and-adjudicate.mjs';
import { loadAuditors } from './report-contract.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const finding = (extra = {}) => ({
  title: 'Review evidence label is overstated', surface: 'S1', severity: 'high',
  confidence: 'confirmed', location: ['src/report.ts:12'], impact: 'Report could mislead.',
  preconditions: 'Source review only', attack: [], poc: '', fix: 'Use an assertion label.', ...extra,
});
const controls = (rows = []) => ({ verified_safe: rows });

// Minimal valid report directory; mirrors the fixture in report-contract.test.mjs.
function fixture(t, agents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adjudicate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'auditors'));
  fs.mkdirSync(path.join(dir, 'harness'));
  fs.writeFileSync(path.join(dir, 'harness/sandbox.md'), '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  const meta = { agents, surface: 's1', models: Object.fromEntries(agents.map((a) => [a, 'requested-model'])), workerExits: {}, crosscheckExits: {}, stageFailures: [], finalized: true };
  const put = (rel, value) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  put('meta.json', meta);
  const save = (adapter, data) => {
    const name = `${adapter}-s1-auth`;
    meta.workerExits[name] = 0;
    put(`auditors/${name}.json`, data);
    fs.writeFileSync(path.join(dir, 'auditors', `${name}.md`), 'Source review only.\n');
    put('meta.json', meta);
  };
  const cross = (verdictFor) => {
    const { assignments } = loadAuditors(dir);
    for (const [adapter, ids] of Object.entries(assignments)) {
      meta.crosscheckExits[adapter] = 0;
      put(`auditors/crosscheck-${adapter}.json`, ids.map((id) => ({ id, verdict: verdictFor(adapter, id), reason: 'Source statement only.', evidence: ['src/report.ts:12'] })));
    }
    put('meta.json', meta);
  };
  return { dir, save, cross, put, meta };
}

test('single vendor claim is MODEL_ASSERTION', async (t) => {
  const f = fixture(t, ['claude']);
  f.save('claude', [finding(), controls()]);
  const r = await adjudicate(f.dir);
  assert.equal(r.exitCode, 0);
  assert.equal(r.health.state, 'validated_outputs');
  assert.equal(r.scoredFindings.length, 1);
  assert.equal(r.scoredFindings[0].status, 'MODEL_ASSERTION');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'findings-and-scores.json'))), r.scoredFindings);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'))).state, 'validated_outputs');
});

test('two vendors on the same claim are MODEL_AGREEMENT', async (t) => {
  const f = fixture(t, ['claude', 'codex']);
  f.save('claude', [finding(), controls()]);
  f.save('codex', [finding(), controls()]);
  const r = await adjudicate(f.dir);
  assert.equal(r.scoredFindings[0].status, 'MODEL_AGREEMENT');
  assert.deepEqual(r.scoredFindings[0].vendors.sort(), ['anthropic', 'openai']);
  assert.equal(r.exitCode, 2, 'missing cross-checks make the report incomplete');
});

test('refuting cross-check from another vendor yields REFUTED_REVIEW', async (t) => {
  const f = fixture(t, ['claude', 'codex']);
  f.save('claude', [finding({ title: 'Claude-only claim' }), controls()]);
  f.save('codex', [finding({ title: 'Unrelated codex claim', surface: 'S1', location: ['src/other.ts:99'] }), controls()]);
  f.cross(() => 'refuted');
  const r = await adjudicate(f.dir);
  assert.equal(r.exitCode, 0, r.health.errors.join('; '));
  assert.ok(r.scoredFindings.length >= 1);
  for (const row of r.scoredFindings) {
    assert.equal(row.status, 'REFUTED_REVIEW');
    assert.equal(row.score, 0);
    assert.ok(row.reviews.length >= 1);
  }
  assert.equal(r.health.security.state, 'not_certified');
});

test('verified-safe rows keep their evidence and carry provenance', async (t) => {
  const f = fixture(t, ['claude']);
  f.save('claude', [controls([{ control: 'Owner check', how_attacked: 'Read handler', holds: true, evidence: 'src/a.ts:5 checks the signer' }])]);
  const r = await adjudicate(f.dir);
  assert.equal(r.verifiedSafe.length, 1);
  assert.equal(r.verifiedSafe[0].evidence, 'src/a.ts:5 checks the signer');
  assert.equal(r.verifiedSafe[0].provenance, 'model_assertion');
  assert.equal(r.verifiedSafe[0].auditor, 'claude-s1-auth');
});

test('incomplete report yields exitCode 2 and writes report-health.json', async (t) => {
  const f = fixture(t, ['claude', 'grok']);
  f.save('claude', [controls()]);
  const r = await adjudicate(f.dir);
  assert.equal(r.exitCode, 2);
  assert.equal(r.health.state, 'incomplete');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, 'report-health.json'))).state, 'incomplete');
});

test('CLI wrapper keeps exit code and output', (t) => {
  const f = fixture(t, ['claude']);
  f.save('claude', [finding(), controls()]);
  const ok = spawnSync(process.execPath, [path.join(scripts, 'verify-and-adjudicate.mjs'), f.dir], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /Output validation: validated_outputs; 1 model-claim clusters/);
  const h = fixture(t, ['claude', 'grok']);
  h.save('claude', [controls()]);
  const bad = spawnSync(process.execPath, [path.join(scripts, 'verify-and-adjudicate.mjs'), h.dir], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /INCOMPLETE/);
});

test('a review by a reviewer of the author\'s own vendor is ignored, whatever the reviewer ids (R-17c)', async (t) => {
  const f = fixture(t, ['cli-claude-opus', 'openrouter-anthropic-x']);
  f.meta.reviewers = [
    { id: 'cli-claude-opus', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'requested-model' },
    { id: 'openrouter-anthropic-x', family: 'openrouter', provider: 'openrouter', vendor: 'anthropic', model: 'requested-model' },
  ];
  f.put('meta.json', f.meta);
  f.save('cli-claude-opus', [finding({ title: 'Opus-only claim' }), controls()]);
  f.save('openrouter-anthropic-x', [controls()]);
  f.cross(() => 'refuted');
  const r = await adjudicate(f.dir);
  const row = r.scoredFindings.find((x) => x.title === 'Opus-only claim');
  assert.equal(row.status, 'MODEL_ASSERTION', 'same-vendor refutation must not count');
  assert.deepEqual(row.reviews, []);
  assert.deepEqual(row.vendors, ['anthropic']);
});

test('two vendors whose claims only merged on nearby lines are not MODEL_AGREEMENT', async (t) => {
  // Structural merge: both cite two files within three lines of each other, with no line in common.
  const f = fixture(t, ['claude', 'codex']);
  f.save('claude', [finding({ title: 'Payout races the balance update', location: ['src/pay.ts:10', 'src/ledger.ts:20'] }), controls()]);
  f.save('codex', [finding({ title: 'Payout races the balance update', location: ['src/pay.ts:12', 'src/ledger.ts:22'] }), controls()]);
  f.cross(() => 'upheld');
  const [row, ...rest] = (await adjudicate(f.dir)).scoredFindings;
  assert.equal(rest.length, 0, 'one merged cluster');
  assert.deepEqual(row.vendors.sort(), ['anthropic', 'openai']);
  assert.notEqual(row.status, 'MODEL_AGREEMENT');
});

test('two vendors on the same line and surface are MODEL_AGREEMENT whatever their wording', async (t) => {
  // The different-surface, different-subject case is covered on sameDefect in debate-cluster.test.mjs; one
  // auditor file holds one surface, so it cannot be built here.
  const at = ['src/pay.ts:10', 'src/ledger.ts:20'];
  const f = fixture(t, ['claude', 'codex']);
  f.save('claude', [finding({ title: 'Payout races the balance update', location: at }), controls()]);
  f.save('codex', [finding({ title: 'Double spend on withdraw', location: at }), controls()]);
  const rows = (await adjudicate(f.dir)).scoredFindings;
  assert.deepEqual(rows.map((row) => row.status), ['MODEL_AGREEMENT']);
});
