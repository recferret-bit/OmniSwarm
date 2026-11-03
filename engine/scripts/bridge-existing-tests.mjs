// list_existing_tests and run_existing_tests. Only catalogued suites run; the runner rebuilds each command itself.
// A suite runs on a fresh per-run copy of the sealed source and every process it leaves behind is killed (R-02).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testCounts, missingTestArtifact } from './scanner-evidence.mjs';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { REVIEW_WORKFLOW, selectExistingTest, EXISTING_TEST_RUNNER } from './review-workflow.mjs';
import { withExistingTestLock } from './existing-test-lock.mjs';
import { selectTestArtifacts } from './test-artifacts.mjs';
import { SUITE_PATH, dockerClientEnv, runProgram } from './bridge-container.mjs';
import { PREPARE_RUN_SCRIPT, SUITE_CLEANUP_SCRIPT } from './bridge-programs.mjs';
import { sha256Hex } from './hash-util.mjs';

const TEST_OUTPUT_BYTES = 2 * 1024 * 1024;
const TEST_RESPONSE_CHARS = 48 * 1024;

function clipForModel(text) {
  if (!text || text.length <= TEST_RESPONSE_CHARS) return text || '(empty)';
  const head = Math.floor(TEST_RESPONSE_CHARS / 4);
  return `${text.slice(0, head)}\n[... ${text.length - TEST_RESPONSE_CHARS} characters omitted; full output is retained as evidence ...]\n${text.slice(text.length - (TEST_RESPONSE_CHARS - head))}`;
}

function existingTestResponse(id, code, failureDetail, output, provenance) {
  return `Existing test ${id}; exit code: ${code}${provenance ? ` (${provenance})` : ''}${failureDetail ? `\n${failureDetail}` : ''}\nSTDOUT:\n${clipForModel(output.stdout)}\nSTDERR:\n${clipForModel(output.stderr)}`;
}

// Only a hash-matched coordinator run for the same suite and source is reused.
function recordedVerificationRun(reportDir, testId, sourceDigest) {
  try {
    const row = readReportJson(reportDir, 'harness/existing-test-results-verification.json').findLast(item => item?.testId === testId && item.sourceDigest === sourceDigest);
    if (!row || !Number.isSafeInteger(row.exitCode) || !/^harness\/existing-test-output-verification-\d+\.json$/.test(row.evidenceFile)) return null;
    const evidence = readReportJson(reportDir, row.evidenceFile, 40 * 1024 * 1024);
    if (sha256Hex(JSON.stringify(evidence)) !== row.evidenceHash || typeof evidence.stdout !== 'string' || typeof evidence.stderr !== 'string') return null;
    return { row, evidence };
  } catch { return null; }
}

// Validate every catalog row before advertising it; commands are reconstructed from the row, never taken from the caller.
function loadCatalog(ctx, name, args) {
  if (Object.keys(args).some(key => name === 'list_existing_tests' || key !== 'test_id')) throw new Error('Existing test tools accept only a catalogued test_id');
  const catalog = readReportJson(ctx.reportDir, 'harness/existing-tests.json');
  const entries = catalog.tests?.map(entry => selectExistingTest(catalog, entry.id, ctx.submissionIdentity?.sourceDigest));
  if (!entries || catalog.workflow !== REVIEW_WORKFLOW) throw new Error('Existing test catalog unavailable');
  return { catalog, entries };
}

function assertOffline(ctx) {
  const inspected = spawnSync(ctx.dockerBin, ['inspect', '--format', '{"running":{{json .State.Running}},"mode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}}}', ctx.container], { encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024, env: dockerClientEnv() });
  let network;
  try { network = JSON.parse(inspected.stdout); } catch { throw new Error('Cannot verify offline test containment'); }
  if (inspected.status !== 0 || network.running !== true || typeof network.mode !== 'string' || network.mode === 'host' || network.mode.startsWith('container:') || !network.networks || Object.keys(network.networks).some(key => key !== 'none')) throw new Error('Tests require a network-disconnected container');
}

// R-02: the suite runs on a fresh copy of the sealed source, never in the tree reviewers read.
async function runOnFreshCopy(ctx, entry) {
  const runDir = `/work/runs/${crypto.randomBytes(8).toString('hex')}`;
  const prepared = await runProgram(ctx, PREPARE_RUN_SCRIPT, [runDir], { cwd: '/', timeoutMs: 10 * 60_000 });
  let result, cleanup = { killed: [], survivors: [] };
  try {
    if (prepared.code !== 0) throw new Error(`Cannot prepare a per-run copy of the sealed source: ${prepared.stderr.slice(0, 300)}`);
    result = await runProgram(ctx, EXISTING_TEST_RUNNER, [`${runDir}/src`], { cwd: runDir, path: SUITE_PATH, input: JSON.stringify(entry), timeoutMs: entry.timeoutMs + 10_000, maxBytes: TEST_OUTPUT_BYTES, keepTail: true });
  } finally {
    const cleaned = await runProgram(ctx, SUITE_CLEANUP_SCRIPT, [runDir], { cwd: '/', timeoutMs: 60_000 });
    try { cleanup = JSON.parse(cleaned.stdout); } catch { cleanup = { killed: [], survivors: [], cleanupFailed: true }; }
  }
  const dependencies = ['sealed', 'unsealed'].includes(prepared.stdout.trim()) ? prepared.stdout.trim() : 'unknown';
  return { result, cleanup, dependencies };
}

function recordRun(ctx, key, catalog, entry, { result, cleanup, dependencies }, failureDetail) {
  const file = `harness/existing-test-results-${key}.json`;
  let prior = []; try { prior = readReportJson(ctx.reportDir, file); } catch { /* first test */ }
  const sequence = Math.max(-1, ...prior.map(row => Number(row.evidenceFile?.match(/-(\d+)\.json$/)?.[1] ?? -1))) + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Invalid existing test evidence sequence');
  const evidenceFile = `harness/existing-test-output-${key}-${sequence}.json`;
  const evidence = JSON.stringify({ stdout: result.stdout, stderr: result.stderr, ...(result.omittedBytes ? { omittedBytes: result.omittedBytes } : {}) });
  writeReportFile(ctx.reportDir, evidenceFile, evidence);
  const row = {
    testId: entry.id, sourceDigest: catalog.sourceDigest, kind: entry.kind, cwd: entry.cwd, exitCode: result.code, counts: testCounts(result.stdout),
    ...(failureDetail ? { failureDetail } : {}), dependencies, killedProcesses: cleanup.killed, ...(cleanup.survivors?.length ? { survivingProcesses: cleanup.survivors } : {}),
    evidenceFile, evidenceHash: sha256Hex(evidence), at: new Date().toISOString(), scope: 'existing_offline_test_only',
  };
  writeReportFile(ctx.reportDir, file, JSON.stringify([...prior, row].slice(-200)));
}

export async function listExistingTests(ctx, args) {
  if (ctx.demoHost) return JSON.stringify({ scope: 'demo_host', tests: [] });
  const { entries } = loadCatalog(ctx, 'list_existing_tests', args);
  return JSON.stringify({ scope: 'existing_offline_tests_only', tests: entries.map(({ id, kind, cwd, description }) => ({ id, kind, cwd, description })) });
}

export async function runExistingTests(ctx, args) {
  if (ctx.demoHost) return `demo-host does not execute target tests (${args.test_id || 'unspecified'}). This is a coverage gap.`;
  const { catalog } = loadCatalog(ctx, 'run_existing_tests', args);
  const entry = selectExistingTest(catalog, args.test_id, ctx.submissionIdentity?.sourceDigest);
  if (fs.existsSync(path.join(ctx.reportDir, 'harness/test-artifacts.json'))) entry.artifacts = selectTestArtifacts(readReportJson(ctx.reportDir, 'harness/test-artifacts.json'), catalog.sourceDigest);
  const key = ctx.submissionIdentity?.name || ctx.auditor || ctx.agent;
  // The coordinator runs every catalogued suite before reviewers start. Reviewers get that recorded run instead of a
  // rerun of the same source: a long suite outlives some CLIs' MCP call deadlines and holds the shared test lock.
  if (key !== 'verification') {
    const recorded = recordedVerificationRun(ctx.reportDir, entry.id, catalog.sourceDigest);
    if (recorded) return existingTestResponse(entry.id, recorded.row.exitCode, recorded.row.failureDetail, recorded.evidence, `recorded by the coordinator at ${recorded.row.at} before review; not re-executed`);
  }
  return withExistingTestLock(ctx.reportDir, async () => {
    assertOffline(ctx);
    const run = await runOnFreshCopy(ctx, entry);
    const failureDetail = run.result.code !== 0 ? missingTestArtifact(run.result.stderr) : null;
    if (key) recordRun(ctx, key, catalog, entry, run, failureDetail);
    return existingTestResponse(entry.id, run.result.code, failureDetail, run.result);
  });
}
