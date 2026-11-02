import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, findBrowser, printableHtml } from '../../scripts/report-pdf.mjs';
import { runGolden } from '../../scripts/debate-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = path.join(ROOT, 'scripts');
const SENTENCE = 'Model agreement and passing checks do not certify security.';

function buildV2(dir) {
  const built = spawnSync(process.execPath, [path.join(scripts, 'report-fixtures', 'v2-build.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const rendered = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
}

function railLabels(html) {
  const nav = html.match(/<nav aria-label="Report">([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'missing rail');
  return [...nav[1].matchAll(/<span>([^<]*)<\/span>([^<]*)/g)].map((match) => `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

test('a v2 fixture grows the rail, the hero, the debate card and the reviewer index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w07-v2-'));
  buildV2(dir);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  const labels = railLabels(html);
  assert.deepEqual(labels.slice(0, 6), ['01 Overview', '02 Findings', '03 By model', '04 Evidence', '05 Cross-check', '06 General review']);
  assert.match(html, new RegExp(SENTENCE.replace(/[.]/g, '\\.')));
  assert.match(html, /id="general-review-hero"/);
  const finding = html.slice(html.indexOf('Missing owner check') - 400, html.indexOf('Unchecked arithmetic'));
  assert.match(finding, /<summary>Debate<\/summary>/);
  assert.match(finding, /devil's advocate/);
  assert.match(finding, /quote_not_found/);
  assert.match(finding, /conformity suspect/);
  assert.match(finding, /Verified quotes disagree/);
  assert.match(finding, /data-status="DISPUTED"/);
  assert.match(html, /data-status="AGREED"/);
  assert.match(html, /Agreed check[\s\S]{0,200}0 rounds/);
  assert.match(html, /CLUSTER-9 debate_cap/);
  assert.match(html, /Not debated \(cap\)/);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const index = fs.readFileSync(path.join(dir, 'reviewers.html'), 'utf8');
  const order = ['cli', 'key', 'openrouter', 'scripted'].map((family) => index.indexOf(`data-family="${family}"`));
  assert.ok(order.every((at) => at >= 0), order.join(','));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(index, /cost —/);
  assert.match(index, /reviewers\/scripted-baseline\/report\.html/);
  for (const id of ['cli-claude-opus', 'key-zai-glm-5-3', 'openrouter-qwen-qwen3-8-max', 'openrouter-anthropic-claude-opus', 'scripted-baseline']) {
    assert.equal(fs.existsSync(path.join(dir, 'reviewers', id, 'report.html')), true, id);
  }
  const own = fs.readFileSync(path.join(dir, 'reviewers/cli-claude-opus/report.html'), 'utf8');
  assert.match(own, /Missing owner check/);
  assert.equal(own.includes('Unchecked arithmetic') || own.includes('Missing owner check'), true);
  const other = fs.readFileSync(path.join(dir, 'reviewers/scripted-baseline/report.html'), 'utf8');
  assert.equal(other.includes('Missing owner check'), false);
  const model = fs.readFileSync(path.join(dir, 'findings-by-model.html'), 'utf8');
  for (const id of ['cli-claude-opus', 'key-zai-glm-5-3', 'openrouter-qwen-qwen3-8-max', 'openrouter-anthropic-claude-opus']) {
    assert.match(model, new RegExp(`<th scope="row">${id}</th>`));
  }
  assert.equal(PAGES.some(([page]) => page === 'reviewers.html'), true);
  const printed = printableHtml(html);
  assert.match(printed, /05<\/span> Cross-check/);
  assert.match(printed, /06<\/span> General review/);
  const browser = findBrowser();
  if (browser) {
    const pdf = spawnSync(path.join(ROOT, 'bin', 'audit'), ['pdf', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, CHROME_PATH: browser } });
    assert.equal(pdf.status, 0, pdf.stderr);
    for (const name of ['report.pdf', 'findings-by-model.pdf', 'reviewers.pdf']) {
      const bytes = fs.readFileSync(path.join(dir, name));
      assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', name);
      assert.ok(bytes.length > 1000, name);
    }
  }
});

test('a v2 run without general-review.json shows the incomplete banner and no hero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w07-gap-'));
  const built = spawnSync(process.execPath, [path.join(scripts, 'report-fixtures', 'v2-build.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  fs.rmSync(path.join(dir, 'general-review.json'));
  const rendered = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /General review not run — report INCOMPLETE/);
  assert.equal(html.includes('id="general-review-hero"'), false);
});

test('w06-run renders every debate cluster in the cross-check table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w07-w06-'));
  fs.mkdirSync(path.join(dir, 'auditors'));
  fs.mkdirSync(path.join(dir, 'harness'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    name: 'w06', mode: 'local', source: 'fixture', date: '2026-11-02T00:00:00Z', finalized: true, surface: 's1',
    agents: ['claude'], models: { claude: 'opus' }, auditors: ['claude-s1-auth'],
    workerExits: { 'claude-s1-auth': 0 }, crosscheckExits: {}, stageFailures: [],
  }));
  fs.writeFileSync(path.join(dir, 'auditors/claude-s1-auth.json'), JSON.stringify([
    { title: 'Missing owner check', surface: 'S1', severity: 'high', confidence: 'confirmed', location: ['src/lib.rs:16'], impact: 'withdraw', preconditions: 'balance', analysis: 'missing check', validation: 'source', attack: [], poc: '', fix: 'compare owner' },
    { verified_safe: [] },
  ]));
  fs.writeFileSync(path.join(dir, 'auditors/claude-s1-auth.md'), 'Source review only.\n');
  fs.writeFileSync(path.join(dir, 'harness/sandbox.md'), '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  runGolden(path.join(ROOT, 'eval/golden/near-escrow'), dir, { rounds: 2, seed: 1 });
  const rendered = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  const clusters = JSON.parse(fs.readFileSync(path.join(dir, 'debate/clusters.json'), 'utf8'));
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  const table = html.slice(html.indexOf('id="crosscheck"'), html.indexOf('id="general-review"'));
  const rows = table.match(/<tr data-status=/g) || [];
  assert.equal(rows.length, clusters.clusters.length);
  assert.match(html, new RegExp(SENTENCE.replace(/[.]/g, '\\.')));
  const adjudication = JSON.parse(fs.readFileSync(path.join(dir, 'debate/adjudication.json'), 'utf8'));
  for (const cluster of clusters.clusters) assert.ok(cluster.id && cluster.primaryTitle, cluster.id);
  for (const row of adjudication) assert.ok(row.finalStatus && row.rationale, row.clusterId);
});
