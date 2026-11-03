// Engine exit contract (W09-01/13), report hash (W09-11) and publish (W09-10).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EngineRunResult } from '../../src/engine/port.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { classify } from '../../src/worker/classify.ts';
import { snapshot } from '../../src/worker/progress-tailer.ts';
import { publishReport, removeTree } from '../../src/worker/publish.ts';
import { hashReportDir, maxSeverity } from '../../src/worker/report.ts';

const FIXTURE = path.join(APP_ROOT, 'test/fixtures/engine-report');
const ok: EngineRunResult = { exitCode: 0, signal: null, timedOut: false, aborted: false, spawnError: null, durationMs: 1 };

function outDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

const finished = { 'meta.json': { finalized: true, stageFailures: [] }, 'findings-and-scores.json': [], 'report-health.json': { state: 'validated_outputs' } };

test('exit contract: the run outcomes map to completed, infra_failed, engine_error or operator_error', () => {
  const cases: Array<[string, EngineRunResult, Record<string, unknown>, string]> = [
    ['complete', ok, finished, 'completed'],
    ['incomplete report, exit 2', { ...ok, exitCode: 2 }, { ...finished, 'report-health.json': { state: 'incomplete' } }, 'completed'],
    ['sandbox lost', { ...ok, exitCode: 1 }, { 'meta.json': { finalized: true, stageFailures: ['sandbox_unavailable'] } }, 'infra_failed'],
    ['orchestrator died', { ...ok, exitCode: 1 }, { 'meta.json': { finalized: true, stageFailures: ['sandbox_or_orchestrator:boom'] } }, 'infra_failed'],
    ['provider outage', { ...ok, exitCode: 1 }, { 'meta.json': { finalized: true, stageFailures: [], providerFailures: { glm: 'usage_limit' } } }, 'infra_failed'],
    ['our timeout', { ...ok, exitCode: null, timedOut: true }, {}, 'infra_failed'],
    ['crash, no report', { ...ok, exitCode: 1 }, {}, 'engine_error'],
    ['exit 0 but never finalized', ok, { ...finished, 'meta.json': { finalized: false } }, 'engine_error'],
    ['missing binary', { ...ok, exitCode: null, spawnError: 'ENOENT' }, {}, 'operator_error'],
  ];
  for (const [name, result, files, kind] of cases) assert.equal(classify(result, outDir(files)).kind, kind, name);
  assert.deepEqual(classify({ ...ok, exitCode: 2 }, outDir({ ...finished, 'report-health.json': { state: 'incomplete' } })), { kind: 'completed', incomplete: true });
});

test('the report hash ignores formatting and changes with content', () => {
  const findings = [{ id: 'F-1', title: 'A', severity: 'high', nested: { b: 1, a: 2 } }];
  const general = { riskPosture: 'moderate', topFindings: [] };
  const pretty = outDir({ 'findings-and-scores.json': JSON.stringify(findings, null, 4), 'general-review.json': JSON.stringify(general, null, 2) });
  const compact = outDir({ 'findings-and-scores.json': JSON.stringify([{ nested: { a: 2, b: 1 }, severity: 'high', title: 'A', id: 'F-1' }]), 'general-review.json': general });
  assert.equal(hashReportDir(pretty), hashReportDir(compact));
  const changed = outDir({ 'findings-and-scores.json': [{ ...findings[0], title: 'B' }], 'general-review.json': general });
  assert.notEqual(hashReportDir(changed), hashReportDir(compact));
  assert.equal(maxSeverity(FIXTURE), 'medium');
  assert.equal(maxSeverity(path.join(FIXTURE, 'variants/findings')), 'critical');
});

test('publish copies without private files, is read-only, and the first publication wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'published-'));
  const id = '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10';
  const source = outDir({ ...Object.fromEntries(['meta.json', 'findings-and-scores.json', 'general-review.json', 'report.html', 'reviewers/index.json',
    'sessions/scripted-baseline.jsonl', 'harness/sandbox-run/out.txt'].map((name) => [name, fs.readFileSync(path.join(FIXTURE, name), 'utf8')])), 'engine.log': 'x' });
  fs.symlinkSync('/etc/passwd', path.join(source, 'leak'));
  const first = publishReport({ reportsRoot: root, requestId: id, sourceDir: source, repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'scripted' });
  assert.equal(first.created, true);
  const files = JSON.parse(fs.readFileSync(path.join(first.dir, 'published.json'), 'utf8')).files;
  assert.deepEqual(files, ['findings-and-scores.json', 'general-review.json', 'meta.json', 'report.html', 'reviewers/index.json']);
  assert.ok(!fs.existsSync(path.join(first.dir, 'leak')), 'symlinks are never published');
  assert.equal(fs.statSync(first.dir).mode & 0o777, 0o555);
  assert.equal(fs.statSync(path.join(first.dir, 'reviewers')).mode & 0o777, 0o555);
  assert.equal(fs.statSync(path.join(first.dir, 'report.html')).mode & 0o777, 0o444);
  const other = outDir({ 'findings-and-scores.json': [{ id: 'different' }] });
  const second = publishReport({ reportsRoot: root, requestId: id, sourceDir: other, repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), preset: 'scripted' });
  assert.equal(second.created, false);
  assert.equal(second.reportSha256, first.reportSha256, 'a re-run never replaces a published report');
  removeTree(root);
});

test('progress snapshots follow the report files', () => {
  assert.deepEqual(snapshot(outDir({})), { phase: 'starting', percent: 5 });
  const reviewing = outDir({ 'meta.json': { finalized: false }, 'workers.json': { jobs: [{ name: 'a', state: 'collected' }, { name: 'b', state: 'running' }] } });
  assert.deepEqual(snapshot(reviewing), { phase: 'review', reviewer: 'b', percent: 40 });
  assert.deepEqual(snapshot(outDir({ ...finished })), { phase: 'report', percent: 100 });
});
