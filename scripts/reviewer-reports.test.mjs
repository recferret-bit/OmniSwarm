import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../packages/schemas/index.mjs';
import { deriveReviewerReports } from './reviewer-reports.mjs';
import { loadPhases, runPhases } from './orchestrator-phases.mjs';
import { SCRIPTS, builtinWithReport, finding, phaseContext, reportRun } from './debate-test-run.mjs';
import { writeJson, writeText } from './report-util-files.mjs';

const node = (script, args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });

test('a reviewer report validates and an unknown family is rejected', () => {
  const sample = {
    reviewer: { id: 'key-zai-glm-5-3', family: 'key', provider: 'zai', vendor: 'zai', model: 'glm-5.3' },
    status: 'COMPLETE', gaps: [], surfaces: ['S1'], findings: [], verified_safe: [],
  };
  assert.equal(validate('reviewer-report', sample).ok, true);
  assert.equal(validate('reviewer-report', { ...sample, reviewer: { ...sample.reviewer, family: 'foo' } }).ok, false);
});

test('a labelled reviewer whose id extends another one keeps its own jobs, gaps and unique counts', () => {
  const { out } = reportRun(['scripted:baseline', 'scripted:baseline#scripted-baseline-x'], {
    'scripted-baseline': { findings: [finding('Shared', ['src/a.rs:1']), finding('Solo', ['src/b.rs:9'], { severity: 'low' })] },
    'scripted-baseline-x': { findings: [finding('Shared', ['src/a.rs:1'])] },
  });
  writeJson(out, 'workers.json', { jobs: [
    { name: 'scripted-baseline-s1-auth', adapter: 'scripted-baseline', surface: 'S1', state: 'collected' },
    { name: 'scripted-baseline-x-s1-auth', adapter: 'scripted-baseline-x', surface: 'S1', state: 'failed', failure: { reason: 'model_mismatch' } },
  ] });
  node('verify-and-adjudicate.mjs', [out]);
  deriveReviewerReports(out);
  const base = JSON.parse(fs.readFileSync(path.join(out, 'reviewers', 'scripted-baseline', 'report.json'), 'utf8'));
  assert.equal(base.status, 'COMPLETE');
  const x = JSON.parse(fs.readFileSync(path.join(out, 'reviewers', 'scripted-baseline-x', 'report.json'), 'utf8'));
  assert.deepEqual(x.gaps, [{ surface: 'S1', reason: 'model_mismatch' }]);
  const rows = JSON.parse(fs.readFileSync(path.join(out, 'reviewers', 'index.json'), 'utf8')).groups[0].vendors[0].reviewers;
  // Both reviewers share the scripted vendor, so both clusters are single-vendor; the stub usage has no cost.
  assert.deepEqual(rows.map((r) => [r.id, r.findings, r.uniqueFindings, r.costSource]), [['scripted-baseline', 2, 2, 'none'], ['scripted-baseline-x', 1, 1, 'none']]);
  const html = fs.readFileSync(path.join(out, 'reviewers', 'scripted-baseline', 'report.html'), 'utf8');
  assert.match(html, /class="finding-priority"/);
  assert.match(html, /data-filter="high"/);
  assert.match(html, /cost —|· —/);
  assert.match(fs.readFileSync(path.join(out, 'reviewers.html'), 'utf8'), /cost —/);
});

test('a reviewer-reports phase failure is a stage failure, so the run reads INCOMPLETE', async () => {
  const { out, reviewers } = reportRun(['cli:claude:opus'], { 'cli-claude-opus': { findings: [finding('Bug', ['src/a.ts:1'])] } });
  writeText(out, 'reviewers', 'not a directory');
  const ctx = phaseContext({ out, reviewers, target: out });
  await runPhases(await loadPhases({ builtin: builtinWithReport(out), dir: SCRIPTS }), ctx);
  assert.ok(ctx.stageFailures.some((s) => s.startsWith('phase_failed:reviewer-reports:')), ctx.stageFailures.join());
  const checked = node('report-contract.mjs', [out]);
  assert.equal(checked.status, 2);
  assert.match(checked.stderr, /One or more review stages failed/);
});

test('a render-time derivation failure marks report-health INCOMPLETE and still writes report.html', () => {
  const { out } = reportRun(['cli:claude:opus'], { 'cli-claude-opus': { findings: [finding('Bug', ['src/a.ts:1'])] } });
  writeText(out, 'harness/sandbox.md', '# Sandbox\n| fixture | impossible | none |\n');
  writeText(out, 'reviewers', 'not a directory');
  const rendered = node('generate-html-report.mjs', [out]);
  assert.equal(rendered.status, 2, rendered.stderr);
  const health = JSON.parse(fs.readFileSync(path.join(out, 'report-health.json'), 'utf8'));
  assert.equal(health.state, 'incomplete');
  assert.ok(health.errors.some((e) => e.startsWith('reviewer-reports:')), health.errors.join());
  assert.match(fs.readFileSync(path.join(out, 'report.html'), 'utf8'), /<h3>Bug<\/h3>/);
});
