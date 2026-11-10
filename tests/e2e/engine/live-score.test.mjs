// The live-eval scorer (engine/eval/score.mjs, live.mjs). It turns a finished report on the fullstack fixture
// into recall, decoy and per-reviewer numbers. Exercised here on hand-built rows and on a scripted run; a real
// run is started by the operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPanel } from '../../../engine/eval/panel.mjs';
import { copyWithoutKey, expectedFor } from '../../../engine/eval/live.mjs';
import { isRefuted, renderScore, scoreReport, statusOf } from '../../../engine/eval/score.mjs';
import { loadPhases, runPhases } from '../../../engine/scripts/orchestrator-phases.mjs';
import { SCRIPTS, builtinWithReport, phaseContext, runFromPanel, tempDir } from '../../../engine/scripts/debate-test-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(ROOT, 'engine', 'eval', 'golden', 'fullstack-dapp');
const LIVE = path.join(ROOT, 'engine', 'eval', 'live.mjs');

const KEY = {
  bugs: [
    { file: 'api/a.js', startLine: 10, endLine: 10, class: 'sqli', title: 'SQL built from the query', severity: 'high', layer: 'web2' },
    { file: 'chain/v.rs', startLine: 40, endLine: 40, class: 'signer', title: 'authority is not a signer', severity: 'critical', layer: 'web3' },
    { file: 'infra/c.yml', startLine: 5, endLine: 5, class: 'sock', title: 'Docker socket mounted', severity: 'high', layer: 'infra' },
  ],
  decoys: [{ file: 'api/a.js', startLine: 30, endLine: 30, reason: 'bound parameter', claim: 'lookup builds SQL', layer: 'web2' }],
};
const row = (title, locations, extra = {}) => ({ title, locations, severity: 'high', status: 'MODEL_ASSERTION', layer: 'web2', auditors: ['cli-claude-opus-s1-auth'], ...extra });

test('a kept bug counts once however many rows and reviewers reported it, within three lines', () => {
  const score = scoreReport([
    row('SQL injection', ['api/a.js:10'], { finalStatus: 'CONFIRMED', auditors: ['cli-claude-opus-s2-input', 'cli-codex-gpt-6-1-sol-s2-input'] }),
    row('Query concatenation', ['api/a.js:12'], { finalStatus: 'LIKELY', auditors: ['cli-grok-grok-4-7-s2-input'] }),
    row('Authority unchecked', ['chain/v.rs:43', 'chain/other.rs:1'], { finalStatus: 'LIKELY', severity: 'critical', layer: 'web3', auditors: ['cli-codex-gpt-6-1-sol-s1-auth'] }),
  ], KEY);
  assert.deepEqual([score.totals.found, score.totals.kept, score.totals.recall, score.totals.lostInDebate], [2, 2, 0.67, 0]);
  assert.deepEqual(score.missed.map((m) => m.at), ['infra/c.yml:5']);
  assert.deepEqual([score.layers.web2.recall, score.layers.web3.recall, score.layers.infra.recall], [1, 1, 0]);
  const by = Object.fromEntries(score.reviewers.map((r) => [r.id, r]));
  assert.deepEqual([by['cli-claude-opus'].found, by['cli-codex-gpt-6-1-sol'].found, by['cli-grok-grok-4-7'].found], [1, 2, 1]);
  assert.equal(by['cli-codex-gpt-6-1-sol'].unique, 1, 'only codex found the web3 bug');
  assert.deepEqual(by['cli-codex-gpt-6-1-sol'].byLayer, { web2: 1, web3: 1, infra: 0 });
  assert.deepEqual(score.severity, { exact: 2, within1: 2, under: 0, over: 0 });
  assert.equal(score.totals.precisionOnKey, 1);
});

test('a refuted bug is lost, a refuted decoy is clean, an open decoy is a false positive', () => {
  const score = scoreReport([
    row('SQL injection', ['api/a.js:10'], { finalStatus: 'REFUTED' }),
    row('Socket', ['infra/c.yml:5'], { status: 'REFUTED_REVIEW', layer: 'infra' }),
    row('Lookup builds SQL', ['api/a.js:30'], { finalStatus: 'LIKELY', auditors: ['cli-grok-grok-4-7-s2-input'] }),
  ], KEY);
  assert.deepEqual([score.totals.found, score.totals.kept, score.totals.lostInDebate], [2, 0, 2]);
  assert.deepEqual(score.lost.map((l) => l.at), ['api/a.js:10', 'infra/c.yml:5']);
  assert.deepEqual([score.totals.decoysReported, score.totals.decoysKept, score.totals.decoyFalsePositiveRate], [1, 1, 1]);
  assert.equal(score.totals.precisionOnKey, 0);
  assert.equal(score.reviewers.find((r) => r.id === 'cli-grok-grok-4-7').decoysReported, 1);
  const refutedDecoy = scoreReport([row('Lookup builds SQL', ['api/a.js:30'], { finalStatus: 'REFUTED' })], KEY);
  assert.deepEqual([refutedDecoy.totals.decoysReported, refutedDecoy.totals.decoysKept, refutedDecoy.totals.precisionOnKey], [1, 0, null]);
});

test('a finding on a bug is not counted against a decoy two lines away, and one row can cover two bugs', () => {
  const close = { bugs: [{ file: 'a.js', startLine: 10, endLine: 10, title: 'bug', severity: 'high', layer: 'web2' }, { file: 'a.js', startLine: 50, endLine: 50, title: 'second', severity: 'high', layer: 'web2' }], decoys: [{ file: 'a.js', startLine: 12, endLine: 12, reason: 'r', claim: 'c', layer: 'web2' }] };
  const onBug = scoreReport([row('On the bug', ['a.js:10'])], close);
  assert.deepEqual([onBug.totals.kept, onBug.totals.decoysReported], [1, 0]);
  const onDecoy = scoreReport([row('On the decoy', ['a.js:12'])], close);
  assert.deepEqual([onDecoy.totals.kept, onDecoy.totals.decoysKept], [0, 1]);
  // Exactly between the two: the seeded bug wins the tie.
  const between = scoreReport([row('Between', ['a.js:11'])], close);
  assert.deepEqual([between.totals.kept, between.totals.decoysKept], [1, 0]);
  const both = scoreReport([row('Two places', ['a.js:10', 'a.js:51'])], close);
  assert.deepEqual([both.totals.kept, both.totals.decoysReported], [2, 0]);
});

test('rows off the key are unlisted, not false positives; far lines, other files and bad locations do not match', () => {
  const score = scoreReport([
    row('Four lines away', ['api/a.js:14']),
    row('Same line, another file', ['api/b.js:10']),
    row('No location', []),
    row('Not a location', ['api/a.js']),
  ], KEY);
  assert.deepEqual([score.totals.found, score.totals.decoysReported, score.totals.unlisted, score.totals.unlistedOpen], [0, 0, 4, 4]);
  assert.equal(score.totals.precisionOnKey, null, 'no row on the key: precision is undefined, not zero');
  assert.equal(score.missed.length, 3);
  const empty = scoreReport([], KEY);
  assert.deepEqual([empty.totals.rows, empty.totals.recall, empty.totals.unlisted, empty.reviewers.length], [0, 0, 0, 0]);
});

test('severity and layer disagreements are counted, and the debate status wins over the peer status', () => {
  const score = scoreReport([
    row('Under-rated', ['chain/v.rs:40'], { severity: 'low', layer: 'web2' }),
    row('Over by one', ['api/a.js:10'], { severity: 'critical' }),
  ], KEY);
  assert.deepEqual(score.severity, { exact: 0, within1: 1, under: 1, over: 0 });
  assert.equal(score.totals.layerMismatch, 1);
  assert.equal(statusOf({ status: 'REFUTED_REVIEW', finalStatus: 'LIKELY' }), 'LIKELY');
  assert.equal(isRefuted({ status: 'REFUTED_REVIEW', finalStatus: 'LIKELY' }), false);
  assert.equal(isRefuted({ status: 'UPHELD_REVIEW', finalStatus: 'REFUTED' }), true);
  assert.equal(isRefuted({}), false);
  const text = renderScore(score);
  assert.match(text, /Seeded bugs kept after review and debate: \*\*2 of 3\*\*/);
  assert.match(text, /## Missed \(1\)\n\n- infra\/c\.yml:5 \[infra, high\] Docker socket mounted/);
});

test('prepare hands over the fixture without its answer key, and a scoped key holds one layer', () => {
  const target = copyWithoutKey(FIXTURE, path.join(tempDir('live-prepare-'), 'target'));
  assert.equal(fs.existsSync(path.join(target, 'expected.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'contracts/evm/src/TipVault.sol')), true);
  const all = expectedFor();
  for (const scope of ['web2', 'web3', 'infra']) {
    const cut = expectedFor(scope);
    assert.ok(cut.bugs.length > 0 && cut.bugs.every((bug) => bug.layer === scope), scope);
    assert.ok(cut.decoys.every((decoy) => decoy.layer === scope), scope);
  }
  assert.equal(expectedFor('web2').bugs.length + expectedFor('web3').bugs.length + expectedFor('infra').bugs.length, all.bugs.length);
  assert.equal(expectedFor('everything').bugs.length, all.bugs.length);
});

test('the scorer runs end to end on a scripted review of the fixture, and refuses a directory with no report', async () => {
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
  const panel = await runPanel(FIXTURE, expected, tempDir('live-panel-'));
  const { out, reviewers } = runFromPanel(panel);
  // The layer map a real run records, so each scored row carries its layer.
  const scan = spawnSync(process.execPath, [path.join(SCRIPTS, 'harness.mjs'), '--target', FIXTURE, '--out', path.join(out, 'harness'), '--no-deps'], { encoding: 'utf8' });
  assert.equal(scan.status, 0, scan.stderr);
  const ctx = phaseContext({ out, reviewers, target: FIXTURE, orchestrator: 'scripted:judge', rounds: 2 });
  ctx.budgets.debate.maxClusters = 200;
  await runPhases(await loadPhases({ builtin: builtinWithReport(out), dir: SCRIPTS }), ctx);
  spawnSync(process.execPath, [path.join(SCRIPTS, 'generate-html-report.mjs'), out], { encoding: 'utf8' });
  const score = scoreReport(JSON.parse(fs.readFileSync(path.join(out, 'findings-and-scores.json'), 'utf8')), expected);
  assert.deepEqual([score.totals.kept, score.totals.decoysKept, score.totals.lostInDebate, score.totals.unlisted, score.totals.layerMismatch], [expected.bugs.length, 0, 0, 0, 0]);
  assert.equal(score.totals.decoysReported, expected.decoys.length);
  for (const layer of ['web2', 'web3', 'infra']) assert.equal(score.layers[layer].recall, 1, layer);
  // The lazy reviewer submits nothing and the wrong one reports only a decoy.
  const by = Object.fromEntries(score.reviewers.map((r) => [r.id, r]));
  assert.equal(by['scripted-wrong'].found, 0);
  assert.equal(by['scripted-wrong'].decoysReported, 1);
  assert.equal(by['scripted-lazy'], undefined);
  const cli = spawnSync(process.execPath, [LIVE, 'score', out, '--scope', 'infra'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /# Live eval: fullstack-dapp, infra scope/);
  assert.match(cli.stdout, new RegExp(`\\*\\*${expected.bugs.filter((b) => b.layer === 'infra').length} of ${expected.bugs.filter((b) => b.layer === 'infra').length}\\*\\*`));
  const missing = spawnSync(process.execPath, [LIVE, 'score', tempDir('live-empty-')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /has not produced scored findings/);
  assert.equal(spawnSync(process.execPath, [LIVE, 'prepare', '--scope', 'evm'], { cwd: ROOT, encoding: 'utf8' }).status, 2);
});
