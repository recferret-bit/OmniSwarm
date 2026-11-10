// --scope full|web2|web3|infra: one layer per run. Surfaces and jobs, the plan, the guidance and lead files a
// reviewer sees, the bridge argument, and the submit refusal of a finding outside the layer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeStackAndPlans, renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { readCanonicalSubmission } from './audit-submission.mjs';
import { callBridgeTool, parseBridgeArgs } from './docker-mcp-bridge.mjs';
import { scopeNote } from './harness-layers.mjs';
import { localAuditArgs, parseLocalArgs } from './local-cli.mjs';
import { buildAuditorPrompt, readHarnessContext } from './orchestrator-prompts.mjs';
import { SURFACES } from './orchestrator-surfaces.mjs';
import { assignJobs, expectedJobNames, normalizeScope, selectSurfaces } from './reviewer-plan-assign.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codes = (rows) => rows.map((row) => row.code);
const reviewers = ['cli:claude:opus', 'cli:codex:gpt-6.1-sol'].map(parseReviewerSpec);

// A target with one file per layer, scanned once: backend (web2), contract (web3), compose (infra).
function target() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-target-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('backend/package.json', '{"dependencies":{"express":"^4"}}');
  put('backend/src/server.js', "const app = require('express')();\napp.get('/x', (req, res) => res.send(eval(req.query.q)));\n");
  put('contracts/vault/Cargo.toml', '[package]\nname = "vault"\n[dependencies]\nnear-sdk = "5.1.0"\n');
  put('contracts/vault/src/lib.rs', 'pub fn set_owner() {}\n');
  put('infra/docker-compose.yml', 'services:\n  api:\n    privileged: true\n');
  return root;
}
function reportWith(profile) {
  const report = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-report-'));
  fs.mkdirSync(path.join(report, 'harness'));
  fs.writeFileSync(path.join(report, 'harness', 'stack-profile.json'), JSON.stringify(profile));
  for (const [name, text] of Object.entries({ 'node.md': '# Node leads\nx', 'near.md': '# NEAR leads\nx', 'web.md': '# Web leads\nx', 'config.md': '# Infra leads\nx', 'deps.md': '# Dependency leads\nx' })) fs.writeFileSync(path.join(report, 'harness', name), text);
  return report;
}
const profile = analyzeStackAndPlans(target());

test('full, web2 and web3 review all six surfaces; infra reviews the four that have infra checks', () => {
  assert.deepEqual(codes(selectSurfaces('all')), codes(SURFACES));
  for (const scope of ['full', 'web2', 'web3', undefined, '']) assert.equal(selectSurfaces('all', scope).length, 6, String(scope));
  assert.deepEqual(codes(selectSurfaces('all', 'infra')), ['S1', 'S4', 'S5', 'S6']);
  assert.deepEqual(codes(selectSurfaces('s4', 'infra')), ['S4']);
  assert.deepEqual(codes(selectSurfaces('config', 'INFRA')), ['S4']);
  assert.equal(assignJobs({ reviewers, scope: 'infra' }).length, 8);
  assert.equal(assignJobs({ reviewers, scope: 'web3' }).length, 12);
  assert.equal(assignJobs({ reviewers }).length, 12);
});

test('an unknown scope and a surface outside the scope are refused', () => {
  assert.throws(() => normalizeScope('evm'), /Unknown scope: evm\. Valid: full, web2, web3, infra/);
  assert.throws(() => selectSurfaces('all', 'everything'), /Unknown scope/);
  assert.throws(() => selectSurfaces('s2', 'infra'), /Surface s2 has no infra checks; the infra scope reviews S1, S4, S5, S6/);
  assert.throws(() => selectSurfaces('s3', 'infra'), /no infra checks/);
  assert.throws(() => selectSurfaces('s9', 'web2'), /Unknown surface/);
});

test('a report is validated against the jobs its own scope launched', () => {
  const names = (meta) => expectedJobNames({ surface: 'all', assign: 'matrix', ...meta }, reviewers);
  assert.equal(names({ scope: 'infra' }).length, 8);
  assert.equal(names({ scope: 'infra' }).some((name) => /-s[23]-/.test(name)), false);
  assert.equal(names({}).length, 12, 'a report that predates --scope is a full run');
  assert.deepEqual(names({ scope: 'bogus' }), [], 'an unreadable scope expects no job rather than guessing');
});

test('scoped guidance shows one layer, says what the other layers are, and a full run shows them all', () => {
  const full = renderSurfaceSkillGuidance('S1', profile);
  assert.match(full, /#### Web2:[\s\S]+#### Web3:[\s\S]+#### Infra:/);
  assert.doesNotMatch(full, /This run reviews the/);
  for (const [scope, own, others] of [['web2', '#### Web2:', ['#### Web3:', '#### Infra:']], ['web3', '#### Web3:', ['#### Web2:', '#### Infra:']], ['infra', '#### Infra:', ['#### Web2:', '#### Web3:']]]) {
    const text = renderSurfaceSkillGuidance('S1', profile, scope);
    assert.ok(text.includes(own), scope);
    for (const other of others) assert.equal(text.includes(other), false, `${scope} hides ${other}`);
    assert.ok(text.includes(scopeNote(scope)), scope);
    assert.ok(renderReviewPlansMarkdown(profile, 'S1', scope).includes(scopeNote(scope)), scope);
  }
  // 'full' and an unknown value are not a restriction.
  assert.equal(renderSurfaceSkillGuidance('S1', profile, 'full'), full);
  assert.equal(scopeNote('full'), '');
  assert.equal(scopeNote('evm'), '');
  assert.doesNotMatch(renderReviewPlansMarkdown(profile, 'S1'), /This run reviews the/);
});

test('a scoped reviewer gets the lead files of its own layer only', () => {
  const report = reportWith(profile);
  const leads = (surface, scope) => [...readHarnessContext(report, surface, scope).matchAll(/^### (\w+(?: \w+)?) Leads$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(leads('S4', ''), ['Infra', 'NEAR', 'Node']);
  assert.deepEqual(leads('S4', 'web2'), ['Node']);
  assert.deepEqual(leads('S4', 'web3'), ['NEAR']);
  assert.deepEqual(leads('S4', 'infra'), ['Infra']);
  // Wallet-signing leads live in web.md, so web2 and web3 both see it; infra does not.
  assert.deepEqual(leads('S6', 'web3'), ['NEAR', 'Web']);
  assert.deepEqual(leads('S6', 'web2'), ['Node', 'Web']);
  assert.deepEqual(leads('S6', 'infra'), []);
  // Dependency leads belong to every layer.
  for (const scope of ['web2', 'web3', 'infra']) assert.ok(leads('S5', scope).includes('Dependency'), scope);
  const prompt = buildAuditorPrompt({ targetName: 't', auditorName: 'a-s4-config', surface: SURFACES[3], reportDir: report, scope: 'infra' });
  assert.ok(prompt.includes(`Scope: ${scopeNote('infra')}`));
  assert.doesNotMatch(buildAuditorPrompt({ targetName: 't', auditorName: 'a-s4-config', surface: SURFACES[3], reportDir: report }), /^Scope:/m);
});

test('the bridge and audit local carry the scope; a bad value is refused before anything starts', () => {
  assert.equal(parseBridgeArgs(['--scope', 'web3']).scope, 'web3');
  assert.equal(parseBridgeArgs([]).scope, 'full');
  assert.throws(() => parseBridgeArgs(['--scope', 'everything']), /Unknown scope/);
  const panel = { reviewers: ['cli:claude:opus'], orchestrator: 'cli:claude:opus' };
  assert.deepEqual(localAuditArgs(panel, parseLocalArgs(['--repo', '/x', '--scope', 'infra'])).slice(-2), ['--scope', 'infra']);
  assert.equal(localAuditArgs(panel, parseLocalArgs(['--repo', '/x'])).includes('--scope'), false);
  assert.throws(() => parseLocalArgs(['--scope']), /needs a value/);
  const run = (args) => spawnSync(path.join(ROOT, 'bin', 'audit'), ['run', '--repo', 'engine/scripts/demo-fixture', '--reviewers', 'scripted:baseline', '--plan', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OMNI_DEMO: '1' } });
  const infra = run(['--scope', 'infra']);
  assert.equal(infra.status, 0, infra.stderr);
  assert.match(infra.stdout, / Scope:    infra/);
  assert.match(infra.stdout, /Assignment: matrix \(4 jobs\)/);
  assert.match(run([]).stdout, / Scope:    full/);
  const bad = run(['--scope', 'evm']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unknown scope: evm/);
  assert.equal(run(['--scope', 'infra', '--surface', 's2']).status, 2);
});

function auditor(t, scope) {
  const root = reportWith(profile);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = { name: 'agy-s4-config', agent: 'agy', role: 'auditor', model: 'fixture-model', sourceDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), surface: 'S4' };
  return { root, identity, ctx: { reportDir: root, role: 'auditor', surface: 'S4', auditor: identity.name, agent: 'agy', container: '', submissionIdentity: identity, ...(scope ? { scope } : {}) } };
}
const claim = (title, location) => ({ title, surface: 'S4', severity: 'low', confidence: 'probable', location, impact: 'i', preconditions: 'p', analysis: 'a', validation: 'v', fix: 'f' });
const submit = (ctx, findings) => callBridgeTool(ctx, 'submit_audit_report', { findings, verified_safe: [], markdown_summary: 'Reviewed the scoped layer. Out of scope: nothing.' });
const INFRA = claim('Privileged container', ['infra/docker-compose.yml:3']);
const WEB2 = claim('eval of a query parameter', ['backend/src/server.js:2']);
const WEB3 = claim('set_owner has no caller check', ['contracts/vault/src/lib.rs:1']);

test('a scoped run commits findings of its own layer, including one that cites another layer for context', async (t) => {
  const f = auditor(t, 'infra');
  await submit(f.ctx, [INFRA, claim('Compose passes the secret the backend logs', ['infra/docker-compose.yml:2', 'backend/src/server.js:1'])]);
  assert.equal(readCanonicalSubmission(f.root, f.identity.name, f.identity).report.payload.length, 3);
  const empty = auditor(t, 'web3');
  await submit(empty.ctx, []);
  assert.equal(readCanonicalSubmission(empty.root, empty.identity.name, empty.identity).report.payload.length, 1);
});

test('a scoped run refuses a finding that cites another layer first, names it, and commits nothing', async (t) => {
  const f = auditor(t, 'infra');
  await assert.rejects(submit(f.ctx, [INFRA, WEB2, WEB3]), (error) => {
    assert.match(error.message, /out_of_scope: this run reviews the infra layer only/);
    assert.match(error.message, /"eval of a query parameter" \(backend\/src\/server\.js:2, web2\)/);
    assert.match(error.message, /"set_owner has no caller check" \(contracts\/vault\/src\/lib\.rs:1, web3\)/);
    assert.doesNotMatch(error.message, /Privileged container/);
    return true;
  });
  assert.equal(fs.existsSync(path.join(f.root, 'submissions')), false, 'nothing was committed, so the reviewer can submit again');
  // Citing the other layer first, with the in-scope file second, is still that other layer's finding.
  await assert.rejects(submit(f.ctx, [claim('Backend first', ['backend/src/server.js:1', 'infra/docker-compose.yml:2'])]), /out_of_scope/);
  await submit(f.ctx, [INFRA]);
  for (const [scope, wrong] of [['web2', WEB3], ['web3', INFRA], ['web3', WEB2]]) {
    await assert.rejects(submit(auditor(t, scope).ctx, [wrong]), /out_of_scope/, `${scope} refuses ${wrong.location[0]}`);
  }
});

test('a full run, and a run with no scope, commits findings of every layer', async (t) => {
  for (const scope of ['full', undefined]) {
    const f = auditor(t, scope);
    await submit(f.ctx, [INFRA, WEB2, WEB3]);
    assert.equal(readCanonicalSubmission(f.root, f.identity.name, f.identity).report.payload.length, 4, String(scope));
  }
});
