import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, findBrowser, printableHtml } from '../../../engine/scripts/report-pdf.mjs';
import { runOfflineDebate } from '../../../engine/scripts/debate-run.mjs';
import { read, renderV2 } from '../../../engine/scripts/report-cards-fixtures.mjs';
import { reportRun, finding } from '../../../engine/scripts/debate-test-run.mjs';
import { writeText } from '../../../engine/scripts/report-util-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SENTENCE = /Model agreement and passing checks do not certify security\./;
const IDS = ['cli-claude-opus', 'key-zai-glm-5-3', 'openrouter-qwen-qwen3-8-max-0902', 'openrouter-anthropic-claude-opus-5-5', 'scripted-baseline'];
const render = (dir) => spawnSync(process.execPath, [path.join(ROOT, 'engine', 'scripts', 'generate-html-report.mjs'), dir], { cwd: ROOT, encoding: 'utf8' });

function railLabels(html) {
  const nav = html.match(/<nav aria-label="Report">([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'missing rail');
  return [...nav[1].matchAll(/<span>([^<]*)<\/span>([^<]*)/g)].map((match) => `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

test('a v2 run grows the rail, the hero, the debate card and the reviewer pages', () => {
  const dir = renderV2();
  const html = read(dir, 'report.html');
  assert.deepEqual(railLabels(html).slice(0, 6), ['01 Overview', '02 Findings', '03 By model', '04 Evidence', '05 Cross-check', '06 General review']);
  assert.match(html, SENTENCE);
  assert.match(html, /id="general-review-hero"/);
  assert.match(html, /<a href="#finding-CLUSTER-1">Missing owner check<\/a>/);
  assert.match(html, /<details id="finding-CLUSTER-1"/);
  const card = html.slice(html.indexOf('<details id="finding-CLUSTER-1"'), html.indexOf('<details id="finding-', html.indexOf('<details id="finding-CLUSTER-1"') + 10));
  for (const text of [/<summary>Debate<\/summary>/, /devil's advocate/, /✗ quote_not_found/, /✗ unchecked/, /conformity suspect/, /Verified quotes disagree/, /data-status="DISPUTED"/]) assert.match(card, text);
  assert.match(html, /Agreed check[\s\S]{0,200}0 rounds/);
  assert.match(html, /<li>CLUSTER-3 debate_cap<\/li>/);
  assert.match(html, /Not debated \(cap\)/);
  const table = html.slice(html.indexOf('id="crosscheck"'), html.indexOf('id="general-review"'));
  assert.equal((table.match(/<tr data-status=/g) || []).length, JSON.parse(read(dir, 'debate/clusters.json')).clusters.length);
  assert.match(table, /<td>zai<\/td><td>yes<\/td>/);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const index = read(dir, 'reviewers.html');
  const order = ['cli', 'key', 'openrouter', 'scripted'].map((family) => index.indexOf(`data-family="${family}"`));
  assert.ok(order.every((at) => at >= 0), order.join(','));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(index, /openrouter-qwen-qwen3-8-max-0902[\s\S]*?cost —/);
  assert.match(index, /cost \$0\.41/);
  assert.match(index, /reviewers\/scripted-baseline\/report\.html/);
  for (const id of IDS) assert.equal(fs.existsSync(path.join(dir, 'reviewers', id, 'report.html')), true, id);
  const own = read(dir, 'reviewers/cli-claude-opus/report.html');
  assert.match(own, /<h3>Missing owner check<\/h3>/);
  assert.match(own, /<h3>Unchecked arithmetic<\/h3>/);
  assert.match(own, /<summary>Debate<\/summary>/);
  assert.match(own, /id="search-box"/);
  assert.equal(read(dir, 'reviewers/scripted-baseline/report.html').includes('Missing owner check'), false);
  const model = read(dir, 'findings-by-model.html');
  assert.equal((model.match(/<th scope="row">/g) || []).length, IDS.length);
  for (const id of IDS) assert.match(model, new RegExp(`<th scope="row">${id}</th>`));
  assert.match(model, /<th scope="row">cli-claude-opus<\/th><td>[^]*?<\/td><td>1<\/td><td>0<\/td><td>1<\/td><td>2<\/td><td>COMPLETE<\/td>/);
  assert.equal(PAGES.some(([page]) => page === 'reviewers.html'), true);
  const printed = printableHtml(html);
  assert.match(printed, /05<\/span> Cross-check/);
  assert.match(printed, /06<\/span> General review/);
  const browser = findBrowser();
  if (!browser) return;
  const pdf = spawnSync(path.join(ROOT, 'bin', 'audit'), ['pdf', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, CHROME_PATH: browser } });
  assert.equal(pdf.status, 0, pdf.stderr);
  for (const name of ['report.pdf', 'findings-by-model.pdf', 'reviewers.pdf', 'reviewers/cli-claude-opus/report.pdf']) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', name);
  }
});

test('a v2 run without general-review.json shows the incomplete banner and no hero', () => {
  const dir = renderV2({ before: (d) => fs.rmSync(path.join(d, 'general-review.json')) });
  const html = read(dir, 'report.html');
  assert.match(html, /General review not run — report INCOMPLETE/);
  assert.equal(html.includes('id="general-review-hero"'), false);
});

test('a legacy-meta run with a debate keeps its by-model rows when reviewers/index.json is absent', async () => {
  // The W07-20 scenario: a run whose meta predates meta.reviewers, debated on a golden repo.
  const { out } = reportRun(['cli:claude:opus'], { 'cli-claude-opus': { findings: [finding('withdraw has no owner check', ['src/lib.rs:27'])] } });
  const meta = JSON.parse(read(out, 'meta.json'));
  delete meta.reviewers;
  writeText(out, 'meta.json', JSON.stringify(meta));
  writeText(out, 'harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  await runOfflineDebate(out, path.join(ROOT, 'engine/eval/golden/near-escrow'));
  const rendered = render(out);
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  assert.equal(fs.existsSync(path.join(out, 'reviewers', 'index.json')), false);
  const model = read(out, 'findings-by-model.html');
  assert.match(model, /<th scope="row">cli-claude-opus \(cli\)|<th scope="row">cli-claude-opus</);
  assert.equal(model.includes('reviewers/index.json is missing'), false);
  const html = read(out, 'report.html');
  const clusters = JSON.parse(read(out, 'debate/clusters.json')).clusters;
  const table = html.slice(html.indexOf('id="crosscheck"'), html.indexOf('id="general-review"'));
  assert.equal((table.match(/<tr data-status=/g) || []).length, clusters.length);
  assert.match(html, SENTENCE);
  assert.match(html, /data-status="LIKELY"/);
});
