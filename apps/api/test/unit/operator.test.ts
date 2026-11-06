// Local operator argv, path checks, dashboard password compare, and the PDF stub. No database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { authenticateDashboard, passwordsMatch } from '../../src/modules/dashboard/credentials.ts';
import { assertDashboardChain } from '../../src/modules/dashboard/dashboard.service.ts';
import { assertNormalizedAbsolute, localAuditArgv, localAuditCommand, localAuditEnv, localExitStatus } from '../../src/modules/operator/local-audit.ts';
import { assertLocalOperator, resolveLocalDirectory } from '../../src/modules/operator/local-job.service.ts';
import { parseGitHubInput } from '../../src/modules/quote/repo-url.ts';
import { AppError } from '../../src/shared/errors.ts';
import { ensureReportPdf, reportPdfBytes } from '../../src/shared/report-pdf.ts';

const BASE = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', SESSION_SECRET: 's'.repeat(40), INTAKE_RECIPIENT: 'omniswarm.testnet', CONTRACT_ID: 'registry.testnet',
};

function appError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof AppError);
    return error;
  }
  assert.fail('expected AppError');
}

test('dashboard password has no env default; local mode follows NODE_ENV unless LOCAL_MODE is set', () => {
  const dev = loadConfig('api', BASE);
  assert.equal(dev.dashboard.login, null);
  assert.equal(dev.dashboard.password, null);
  assert.equal(dev.localMode, true);
  assert.equal(loadConfig('api', { ...BASE, LOCAL_MODE: '0' }).localMode, false);
  assert.equal(loadConfig('api', { ...BASE, LOCAL_MODE: '1' }).localMode, true);
  const prod = loadConfig('api', {
    ...BASE, NODE_ENV: 'production', ADMIN_TOKEN: 't'.repeat(40), RPC_URLS: 'https://rpc.example', HOSTED_PRESET: 'hosted',
  });
  assert.equal(prod.localMode, false);
  assert.equal(prod.dashboard.password, null);
  assert.equal(loadConfig('api', { ...BASE, NODE_ENV: 'production', ADMIN_TOKEN: 't'.repeat(40), RPC_URLS: 'https://rpc.example', HOSTED_PRESET: 'hosted', LOCAL_MODE: '1' }).localMode, true);
});

test('login compare: right password, wrong password, and a different length', () => {
  assert.equal(passwordsMatch('operator', 'operator'), true);
  assert.equal(passwordsMatch('operat0r', 'operator'), false);
  assert.equal(passwordsMatch('x', 'operator'), false);
  const dev = { env: 'test' as const, dashboard: { login: null, password: null } };
  assert.equal(authenticateDashboard(dev, 'operator', 'operator'), 'operator');
  assert.equal(appError(() => authenticateDashboard(dev, 'operator', 'operat0r')).code, 'UNAUTHORIZED');
  assert.equal(appError(() => authenticateDashboard(dev, 'operator', 'x')).message, 'Sign in failed');
  assert.equal(appError(() => authenticateDashboard(dev, 'nope', 'operator')).code, 'UNAUTHORIZED');
  assert.equal(appError(() => authenticateDashboard(dev, 'A', 'operator')).code, 'UNAUTHORIZED');
  const prod = { env: 'production' as const, dashboard: { login: null, password: null } };
  const unconfigured = appError(() => authenticateDashboard(prod, 'operator', 'operator'));
  assert.equal(unconfigured.code, 'FORBIDDEN');
  assert.equal(unconfigured.message, 'Dashboard login is not configured');
  const named = { env: 'production' as const, dashboard: { login: 'ops', password: 's3cret-pass' } };
  assert.equal(authenticateDashboard(named, 'ops', 's3cret-pass'), 'ops');
  assert.equal(appError(() => authenticateDashboard(named, 'operator', 'operator')).code, 'UNAUTHORIZED');
});

test('local paths reject .., relative paths, and missing directories', () => {
  const missing = path.join(os.tmpdir(), `omni-missing-${process.pid}`);
  for (const input of ['../etc', 'relative/dir', '/tmp/../etc', missing, '-/tmp', '--repo']) {
    assert.equal(appError(() => resolveLocalDirectory(input)).code, 'VALIDATION_ERROR', input);
  }
  const file = path.join(os.tmpdir(), `omni-file-${process.pid}`);
  fs.writeFileSync(file, 'x');
  try {
    assert.equal(appError(() => resolveLocalDirectory(file)).code, 'VALIDATION_ERROR');
  } finally {
    fs.rmSync(file, { force: true });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-local-'));
  try {
    assert.equal(resolveLocalDirectory(dir), fs.realpathSync(dir));
    assert.equal(resolveLocalDirectory(`${dir}${path.sep}`), fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(assertNormalizedAbsolute('/var/reviews/repo'), '/var/reviews/repo');
});

test('local audit argv is the fixed flag list and never --rpc', () => {
  const out = '/var/reviews/out';
  const repo = '/var/reviews/repo';
  assert.deepEqual(localAuditArgv({ kind: 'path', target: repo, outDir: out }), [
    'run', '--repo', repo, '--reviewers', 'scripted:baseline', '--passes', '1', '--tool-budget', '10', '--out', out,
  ]);
  const sha = 'a'.repeat(40);
  assert.deepEqual(localAuditArgv({ kind: 'github', repo: 'near/near-sdk-rs', ref: sha, outDir: out }), [
    'run', '--github', 'near/near-sdk-rs', '--ref', sha, '--reviewers', 'scripted:baseline', '--passes', '1', '--tool-budget', '10', '--out', out,
  ]);
  const command = localAuditCommand('/opt/omniswarm', localAuditArgv({ kind: 'path', target: repo, outDir: out }));
  assert.equal(command[0], path.join('/opt/omniswarm', 'bin/audit'));
  assert.equal(command.includes('--rpc'), false);
  assert.equal(command.includes('--github'), false);
  assert.deepEqual(Object.keys(localAuditEnv({ PATH: '/usr/bin', HOME: '/home/op', LANG: 'C', TMPDIR: '/tmp', ZAI_API_KEY: 'secret', DATABASE_URL: 'postgres://x' })).sort(),
    ['HOME', 'LANG', 'PATH', 'TMPDIR']);
  assert.throws(() => localAuditArgv({ kind: 'path', target: 'relative', outDir: out }));
  assert.throws(() => localAuditArgv({ kind: 'path', target: '/tmp/../etc', outDir: out }));
  assert.throws(() => localAuditArgv({ kind: 'github', repo: 'near/near-sdk-rs', ref: '--rpc', outDir: out }));
  assert.deepEqual(localExitStatus(2, true), { status: 'done', error: null });
  assert.deepEqual(localExitStatus(2, false), { status: 'failed', error: 'audit exited 2' });
  assert.deepEqual(localExitStatus(1, false), { status: 'failed', error: 'audit exited 1' });
});

test('loopback gate: local mode and 127.0.0.1, ::1, or ::ffff:127.0.0.1 only', () => {
  const on = { localMode: true };
  assert.doesNotThrow(() => assertLocalOperator(on, '127.0.0.1'));
  assert.doesNotThrow(() => assertLocalOperator(on, '::1'));
  assert.doesNotThrow(() => assertLocalOperator(on, '::ffff:127.0.0.1'));
  assert.equal(appError(() => assertLocalOperator(on, '10.1.2.3')).code, 'FORBIDDEN');
  assert.equal(appError(() => assertLocalOperator(on, '0.0.0.0')).code, 'FORBIDDEN');
  assert.equal(appError(() => assertLocalOperator({ localMode: false }, '127.0.0.1')).code, 'FORBIDDEN');
  assert.equal(appError(() => assertDashboardChain({ chain: { adapter: 'near' } })).message, 'Dashboard jobs use the mock chain until NEAR sign-in is connected');
  assert.doesNotThrow(() => assertDashboardChain({ chain: { adapter: 'mock' } }));
});

test('github input accepts owner/name and github.com URLs', () => {
  assert.deepEqual(parseGitHubInput('near/near-sdk-rs'), { repo: 'near/near-sdk-rs', ref: null });
  assert.deepEqual(parseGitHubInput('near/near-sdk-rs@master'), { repo: 'near/near-sdk-rs', ref: 'master' });
  assert.deepEqual(parseGitHubInput('near/near-sdk-rs/tree/master'), { repo: 'near/near-sdk-rs', ref: 'master' });
  assert.deepEqual(parseGitHubInput('https://github.com/near/near-sdk-rs/tree/master'), { repo: 'near/near-sdk-rs', ref: 'master' });
  assert.equal(appError(() => parseGitHubInput('../etc')).code, 'REPO_INVALID');
  assert.equal(appError(() => parseGitHubInput('https://gitlab.com/near/near-sdk-rs')).code, 'REPO_INVALID');
});

test('the PDF stub is a one-page %PDF document', () => {
  const bytes = reportPdfBytes();
  const text = bytes.toString('latin1');
  assert.equal(text.startsWith('%PDF-1.1'), true);
  assert.equal(text.includes('OmniSwarm report'), true);
  assert.equal(text.includes('%%EOF'), true);
  const start = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  assert.ok(start?.[1]);
  assert.equal(text.slice(Number(start[1]), Number(start[1]) + 4), 'xref');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pdf-'));
  try {
    ensureReportPdf(dir, '/no/such/engine');
    const pdf = fs.readFileSync(path.join(dir, 'report.pdf'));
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    fs.writeFileSync(path.join(dir, 'report.pdf'), Buffer.from('%PDF-1.1 existing'));
    ensureReportPdf(dir, '/no/such/engine');
    assert.equal(fs.readFileSync(path.join(dir, 'report.pdf'), 'utf8'), '%PDF-1.1 existing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
