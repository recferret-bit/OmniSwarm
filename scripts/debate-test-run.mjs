// Test seam (imported by *.test.mjs only): a finalized report directory with committed auditor files, and a
// stand-in for the orchestrator's execute() that answers through the real bridge handlers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest } from './agent-session-store.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { bridgeRole } from './bridge-tools-registry.mjs';
import { writeJson, writeText } from './report-util-files.mjs';

export const SCRIPTS = path.dirname(new URL(import.meta.url).pathname);

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function sourceTree(files) {
  const root = tempDir('debate-src-');
  for (const [rel, text] of Object.entries(files)) writeText(root, rel, text);
  return root;
}

export const finding = (title, location, extra = {}) => ({
  title, surface: 'S1', severity: 'high', confidence: 'probable', location, impact: 'impact', preconditions: 'none',
  analysis: 'analysis', validation: 'source inspection', attack: [], poc: '', fix: 'fix', ...extra,
});

// specs: reviewer spec strings. filed: {reviewerId: {findings: [...], verified_safe: [...]}} for surface S1.
export function reportRun(specs, filed = {}) {
  const out = tempDir('debate-run-');
  const reviewers = specs.map(parseReviewerSpec);
  const auditors = reviewers.map((r) => `${r.id}-s1-auth`);
  writeJson(out, 'meta.json', {
    name: 'fixture', mode: 'local', source: 'fixture', surface: 's1', agents: reviewers.map((r) => r.id),
    models: Object.fromEntries(reviewers.map((r) => [r.id, r.model])), reviewers, auditors,
    workerExits: Object.fromEntries(auditors.map((a) => [a, 0])), crosscheckExits: {}, stageFailures: [], finalized: true,
  });
  for (const reviewer of reviewers) {
    const own = filed[reviewer.id] || {};
    writeJson(out, `auditors/${reviewer.id}-s1-auth.json`, [...(own.findings || []), { verified_safe: own.verified_safe || [] }]);
    writeText(out, `auditors/${reviewer.id}-s1-auth.md`, 'Source review only.\n');
  }
  return { out, reviewers };
}

// answer(task, assignment) -> tool args for the role's submit, or null to commit nothing.
export function fakeExecute(out, answer, calls = []) {
  return async ({ name, agent, role, assignment }) => {
    calls.push({ name, agent, role, assignment });
    writeJson(out, `harness/assignments/${name}.json`, assignment);
    const args = answer({ name, agent, role }, assignment);
    if (!args) return { code: 0 };
    const submit = role === 'debater' ? 'submit_debate_turn' : assignment.kind === 'judge' ? 'submit_adjudication' : 'submit_general_review';
    const ctx = { role, reportDir: out, submissionIdentity: { name, agent, role, assignmentDigest: digest(assignment) } };
    await bridgeRole(role).handlers[submit](ctx, args);
    return { code: 0 };
  };
}

const noop = async () => {};
export const BUILTIN = Object.fromEntries(['prepare', 'tests', 'review', 'crosscheck', 'report'].map((name) => [name, noop]));

// Like the orchestrator's report phase: the final meta carries the run's stage failures.
export function builtinWithReport(out) {
  return { ...BUILTIN, async report(ctx) {
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
    writeJson(out, 'meta.json', { ...meta, stageFailures: [...ctx.stageFailures] });
  } };
}

// A finalized run whose auditors are the eval panel's scripted submissions on one golden repo.
export function runFromPanel(panel) {
  const filed = Object.fromEntries(panel.reports.map(({ name, data }) => [name.replace(/-s1-auth$/, ''), { findings: data.slice(0, -1), verified_safe: data.at(-1).verified_safe }]));
  return reportRun(panel.reviewers.map((r) => `scripted:${r.provider}`), filed);
}

export function phaseContext({ out, reviewers, target, orchestrator = null, alternateJudge = null, execute, rounds = 2 }) {
  return {
    request: { target, orchestrator: typeof orchestrator === 'string' && orchestrator !== 'recommended' ? parseReviewerSpec(orchestrator) : orchestrator, alternateJudge },
    output: out, reviewers, surfaceArg: 's1', jobs: [], stageFailures: [],
    budgets: { passes: 1, toolBudget: 10, debate: { rounds, toolBudget: 12, maxClusters: 25 } },
    execute: execute || (async () => ({ code: 1, failure: { reason: 'process_error' } })),
  };
}
