import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callBridgeTool, parseBridgeArgs, renderMarkdownFromFindings } from './docker-mcp-bridge.mjs';
import { readCanonicalSubmission, deriveSubmission } from './audit-submission.mjs';
import { readReportJson } from './report-contract.mjs';

function fixture(t, role = 'auditor') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-commit-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'harness'));
  const identity = { name: role === 'auditor' ? 'agy-s3-logic' : 'crosscheck-agy', agent: 'agy', role, model: 'fixture-model', sourceDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), ...(role === 'auditor' ? { surface: 'S3' } : {}) };
  const ctx = { reportDir: root, role, surface: 'S3', auditor: role === 'auditor' ? identity.name : '', agent: 'agy', container: '', submissionIdentity: identity };
  return { root, identity, ctx };
}
const report = () => ({ findings: [{ title: 'Inert evidence fixture', surface: 'S3', severity: 'low', confidence: 'probable', location: ['src/rules.rs:12'], impact: 'Fixture impact', preconditions: 'Fixture only', analysis: 'Source analysis of the fixture rule.', validation: 'Source inspection only; no test run.', fix: 'Require authorization' }], verified_safe: [], markdown_summary: 'Static fixture only; no actual security audit was performed.' });

test('one MCP commit is authoritative and repeated identical submissions are idempotent', async t => {
  const f = fixture(t);
  const input = report();
  await callBridgeTool(f.ctx, 'submit_audit_report', { report_json: JSON.stringify(input) });
  const first = readCanonicalSubmission(f.root, f.identity.name, f.identity);
  await callBridgeTool(f.ctx, 'submit_audit_report', { verified_safe: [], findings: input.findings, markdown_summary: input.markdown_summary });
  const second = readCanonicalSubmission(f.root, f.identity.name, f.identity);
  assert.equal(first.hash, second.hash);
  assert.equal(first.committedAt, second.committedAt);
  await assert.rejects(callBridgeTool(f.ctx, 'submit_audit_report', { findings: [], verified_safe: [] }), /already committed/);
  assert.equal(readReportJson(f.root, `auditors/${f.identity.name}.json`).length, 2);
});

test('canonical reports are bound to source, model, role and assignment', async t => {
  const f = fixture(t);
  await callBridgeTool(f.ctx, 'submit_audit_report', report());
  for (const patch of [{ sourceDigest: 'c'.repeat(64) }, { assignmentDigest: 'd'.repeat(64) }, { model: 'other-model' }, { role: 'crosscheck' }]) {
    assert.throws(() => readCanonicalSubmission(f.root, f.identity.name, { ...f.identity, ...patch }));
  }
  const file = path.join(f.root, 'submissions', `${f.identity.name}.json`);
  const receipt = JSON.parse(fs.readFileSync(file));
  receipt.report.payload[0].impact = 'Tampered payload';
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.throws(() => readCanonicalSubmission(f.root, f.identity.name, f.identity), /hash mismatch/);
});

test('derived JSON and markdown can be rebuilt from the committed report without model output', async t => {
  const f = fixture(t);
  await callBridgeTool(f.ctx, 'submit_audit_report', report());
  const receipt = readCanonicalSubmission(f.root, f.identity.name, f.identity);
  fs.rmSync(path.join(f.root, 'auditors'), { recursive: true });
  deriveSubmission(f.root, receipt, renderMarkdownFromFindings);
  assert.equal(readReportJson(f.root, `auditors/${f.identity.name}.json`)[0].title, 'Inert evidence fixture');
  assert.match(fs.readFileSync(path.join(f.root, 'auditors', `${f.identity.name}.md`), 'utf8'), /Findings \(1\)/);
});

test('bridge role cannot be crossed by calling an unadvertised submission tool', async t => {
  const f = fixture(t, 'crosscheck');
  await assert.rejects(callBridgeTool(f.ctx, 'submit_audit_report', report()), /bridge role/);
  const auditor = fixture(t);
  await assert.rejects(callBridgeTool(auditor.ctx, 'submit_crosscheck_report', { verdicts: [] }), /bridge role/);
});

test('identity file cannot point outside the report or silently change reviewer identity', t => {
  const f = fixture(t);
  const file = path.join(f.root, 'identity.json');
  fs.writeFileSync(file, JSON.stringify(f.identity));
  const flags = ['--report-dir', f.root, '--role', 'auditor', '--agent', 'agy', '--auditor', 'agy-s3-logic', '--surface', 'S3', '--identity-file', file];
  assert.deepEqual(parseBridgeArgs(flags).submissionIdentity, f.identity);
  assert.throws(() => parseBridgeArgs([...flags.slice(0, -1), '/tmp/outside-identity.json']));
  fs.writeFileSync(file, JSON.stringify({ ...f.identity, agent: 'grok' }));
  assert.throws(() => parseBridgeArgs(flags));
});

test('R-09: every submit requires a submission identity; there is no direct-write path', async t => {
  for (const [role, name, args] of [['auditor', 'submit_audit_report', report()], ['crosscheck', 'submit_crosscheck_report', { verdicts: [] }]]) {
    const f = fixture(t, role);
    delete f.ctx.submissionIdentity;
    await assert.rejects(callBridgeTool(f.ctx, name, args), /IDENTITY_REQUIRED/);
    assert.equal(fs.existsSync(path.join(f.root, 'auditors')), false);
    assert.equal(fs.existsSync(path.join(f.root, 'submissions')), false);
  }
});

test('R-09: exploit steps, PoCs and missing evidence are refused for every identity, whatever its workflow field', async t => {
  const f = fixture(t);
  const withAttack = report(); withAttack.findings[0].attack = ['step one'];
  await assert.rejects(callBridgeTool(f.ctx, 'submit_audit_report', withAttack), /not exploit steps or PoCs/);
  const withPoc = report(); withPoc.findings[0].poc = 'curl http://x';
  await assert.rejects(callBridgeTool(f.ctx, 'submit_audit_report', withPoc), /not exploit steps or PoCs/);
  const noEvidence = report(); noEvidence.verified_safe = [{ control: 'c', holds: true }];
  await assert.rejects(callBridgeTool(f.ctx, 'submit_audit_report', noEvidence), /requires evidence/);
  assert.equal(fs.existsSync(path.join(f.root, 'submissions')), false);
});

test('W02-02: the bridge accepts reviewer ids listed in harness/reviewers.json and refuses any other with IDENTITY_UNKNOWN', t => {
  const f = fixture(t);
  const id = 'openrouter-qwen-qwen3-8-max';
  const identity = { ...f.identity, name: `${id}-s3-logic`, agent: id };
  const identityFile = path.join(f.root, 'identity.json');
  fs.writeFileSync(identityFile, JSON.stringify(identity));
  fs.writeFileSync(path.join(f.root, 'harness/reviewers.json'), JSON.stringify({ version: 1, reviewers: [{ id }, { id: 'cli-claude-opus' }] }));
  const flags = ['--report-dir', f.root, '--role', 'auditor', '--agent', id, '--auditor', identity.name, '--surface', 'S3', '--identity-file', identityFile, '--reviewers-file', path.join(f.root, 'harness/reviewers.json')];
  assert.equal(parseBridgeArgs(flags).submissionIdentity.agent, id);
  // Same pattern-valid id, but not a reviewer of this run.
  const rogue = { ...identity, name: 'rogue-s3-logic', agent: 'rogue' };
  fs.writeFileSync(identityFile, JSON.stringify(rogue));
  const rogueFlags = flags.map(flag => flag === id ? 'rogue' : flag === identity.name ? rogue.name : flag);
  assert.throws(() => parseBridgeArgs(rogueFlags), /IDENTITY_UNKNOWN/);
  // The reviewers file cannot be taken from outside the report directory.
  assert.throws(() => parseBridgeArgs([...flags.slice(0, -1), '/tmp/reviewers.json']));
  // A run without the flag keeps the pattern-only check, so older callers still start.
  fs.writeFileSync(identityFile, JSON.stringify(identity));
  assert.doesNotThrow(() => parseBridgeArgs(flags.slice(0, -2)));
});
