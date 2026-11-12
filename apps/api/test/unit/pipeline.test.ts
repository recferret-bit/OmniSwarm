// Step-by-step & iterative audit pipeline unit tests for Intake API, MockEngineRunner, report-index, panel config, and local operator argv.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { validate } from '@omniswarm/schemas';
import type { ChainPort } from '../../src/chain/port.ts';
import type { Config } from '../../src/config/load.ts';
import type { Db } from '../../src/db/pool.ts';
import type { RequestRow } from '../../src/db/repositories/requests.ts';
import { MockEngineRunner } from '../../src/engine/mock/mock-runner.ts';
import { localAuditArgv } from '../../src/modules/operator/local-audit.ts';
import { reportIndex } from '../../src/modules/report-index/report-index.ts';
import { findLatestReportDir, readPipelineSummary } from '../../src/modules/requests/pipeline-view.ts';
import { AppError } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';
import { accountConfigDocument, panelConfigDocument } from '../../src/worker/panel.ts';
import { publishReport, removeTree } from '../../src/worker/publish.ts';

const FIXTURE = path.join(APP_ROOT, 'test/fixtures/engine-report');
const REQ_ID = '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10';
const CHILD_ID = '7a1c9d2f-3e4b-4c8a-9b2d-1f5e3a7c9d20';

test('MockEngineRunner produces schema-valid Stage 1, Step 2 Advice, and iterative Step 3 round artifacts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-api-pipeline-'));
  try {
    const runner = new MockEngineRunner({ stepMs: 1, fixtureDir: FIXTURE, fail: null });

    // 1. Step-by-step initial run: Stage 1 + Frontier Advice, no debates yet
    const outStep = path.join(tmp, 'step-by-step');
    const logStep = path.join(tmp, 'step.log');
    const res1 = await runner.run({
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
      outDir: outStep,
      logPath: logStep,
      pipelineMode: 'step-by-step',
    }, new AbortController().signal);
    assert.equal(res1.exitCode, 0);

    const advice = JSON.parse(fs.readFileSync(path.join(outStep, 'orchestrator-advice.json'), 'utf8'));
    assert.equal(validate('orchestrator-advice', advice).ok, true, JSON.stringify(validate('orchestrator-advice', advice).errors));

    const prog1 = JSON.parse(fs.readFileSync(path.join(outStep, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', prog1).ok, true, JSON.stringify(validate('pipeline-progress', prog1).errors));
    assert.equal(prog1.stage1.noDebates, true);
    assert.equal(prog1.debate.roundsCompleted, 0);

    const summary1 = readPipelineSummary(outStep, 'step-by-step', [CHILD_ID]);
    assert.ok(summary1);
    assert.equal(validate('intake-api#pipeline-summary', summary1).ok, true, JSON.stringify(validate('intake-api#pipeline-summary', summary1).errors));
    assert.equal(summary1.noDebates, true);
    assert.equal(summary1.roundsCompleted, 0);
    assert.equal(summary1.advice?.debateNeeded, true);
    assert.deepEqual(summary1.nextRoundRequestIds, [CHILD_ID]);

    // 2. Iterative continuation: copy parent -> child and run 1 debate round, then 2 more rounds
    const outRound1 = path.join(tmp, 'round-1');
    fs.cpSync(outStep, outRound1, { recursive: true });
    const res2 = await runner.run({
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
      outDir: outRound1,
      logPath: path.join(tmp, 'r1.log'),
      pipelineMode: 'step-by-step',
      debateRounds: 1,
    }, new AbortController().signal);
    assert.equal(res2.exitCode, 0);
    assert.equal(fs.existsSync(path.join(outRound1, 'audit_round_1.html')), true);

    const prog2 = JSON.parse(fs.readFileSync(path.join(outRound1, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', prog2).ok, true, JSON.stringify(validate('pipeline-progress', prog2).errors));
    assert.equal(prog2.debate.roundsCompleted, 1);

    const summary2 = readPipelineSummary(outRound1, 'step-by-step');
    assert.ok(summary2);
    assert.equal(validate('intake-api#pipeline-summary', summary2).ok, true);
    assert.equal(summary2.noDebates, false);
    assert.equal(summary2.roundsCompleted, 1);

    // 3. Stage-1 only mode: no advice initially, then Step 2 Advice continuation (debateRounds: 0)
    const outStage1 = path.join(tmp, 'stage-1');
    await runner.run({
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
      outDir: outStage1,
      logPath: path.join(tmp, 's1.log'),
      pipelineMode: 'stage-1',
    }, new AbortController().signal);
    const progStage1 = JSON.parse(fs.readFileSync(path.join(outStage1, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', progStage1).ok, true);
    assert.equal(progStage1.currentStage, 'stage-1');
    assert.equal(progStage1.advice, null);

    const outAdvise = path.join(tmp, 'stage-1-advised');
    fs.cpSync(outStage1, outAdvise, { recursive: true });
    await runner.run({
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
      outDir: outAdvise,
      logPath: path.join(tmp, 's2.log'),
      pipelineMode: 'step-by-step',
      debateRounds: 0,
    }, new AbortController().signal);
    const progAdvised = JSON.parse(fs.readFileSync(path.join(outAdvise, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', progAdvised).ok, true);
    assert.equal(progAdvised.currentStage, 'stage-2-advice');
    assert.equal(progAdvised.advice?.debateNeeded, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readPipelineSummary surfaces incompletionNotes from report-health.json even when pipeline-progress.json is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-api-incomplete-'));
  try {
    fs.writeFileSync(path.join(tmp, 'report-health.json'), JSON.stringify({
      state: 'incomplete',
      incompletionNotes: [{
        category: 'timeout',
        code: 'worker_timeout',
        source: 'grok-s4',
        reason: 'Reviewer session grok-s4 timed out on S4.',
        impact: 'S4 lacks independent grok coverage.',
        nextStep: 'Resume failed sessions.',
      }],
    }));
    const runsRoot = path.join(tmp, 'runs');
    const attemptReport = path.join(runsRoot, REQ_ID, '2', 'report');
    fs.mkdirSync(attemptReport, { recursive: true });
    fs.copyFileSync(path.join(tmp, 'report-health.json'), path.join(attemptReport, 'report-health.json'));

    assert.equal(findLatestReportDir(path.join(tmp, 'reports'), runsRoot, REQ_ID), attemptReport);
    const summary = readPipelineSummary(attemptReport, 'full');
    assert.ok(summary);
    assert.equal(validate('intake-api#pipeline-summary', summary).ok, true);
    assert.equal(summary.incompletionNotes?.length, 1);
    assert.equal(summary.incompletionNotes?.[0]?.code, 'worker_timeout');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('publishReport + reportIndex expose stage1Url, adviceUrl, pipelineUrl, and sorted roundUrls', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-report-idx-pipeline-'));
  const reportsRoot = path.join(tmp, 'reports');
  const sourceDir = path.join(tmp, 'src-report');
  try {
    const runner = new MockEngineRunner({ stepMs: 1, fixtureDir: FIXTURE, fail: null });
    await runner.run({
      repo: 'near/example',
      commitSha: 'd'.repeat(40),
      preset: 'panel',
      outDir: sourceDir,
      logPath: path.join(tmp, 'run.log'),
      pipelineMode: 'step-by-step',
    }, new AbortController().signal);
    await runner.run({
      repo: 'near/example',
      commitSha: 'd'.repeat(40),
      preset: 'panel',
      outDir: sourceDir,
      logPath: path.join(tmp, 'run2.log'),
      pipelineMode: 'step-by-step',
      debateRounds: 2,
    }, new AbortController().signal);

    const pub = publishReport({
      reportsRoot,
      requestId: REQ_ID,
      sourceDir,
      repo: 'near/example',
      commitSha: 'd'.repeat(40),
      preset: 'panel',
    });

    const row: RequestRow = {
      id: REQ_ID, account: 'alice.test.near', repo: 'near/example', commit_sha: 'd'.repeat(40), network: 'sandbox', preset: 'panel',
      deployed: null, request_hash: 'c'.repeat(64), price_yocto: '0', status: 'done', attempts: 1, failure_cause: null,
      report_sha256: pub.reportSha256, report_url: `https://reports.example/${REQ_ID}/report.html`,
      max_severity: 'medium', scope: 'full', theme: null, parent_id: null, slice_path: null, models: null, incomplete: false,
      pipeline_mode: 'step-by-step', debate_rounds: 2,
      attest_tx: null, refund_tx: null,
      queued_at: new Date('2026-11-09T00:00:00.000Z'), created_at: new Date('2026-11-09T00:00:00.000Z'), updated_at: new Date('2026-11-09T00:00:00.000Z'),
    };
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('FROM request WHERE id')) return { rows: [row] };
        return { rows: [] };
      },
    } as unknown as Db;
    const chain = { getAttestation: async () => null } as unknown as ChainPort;
    const config = { storage: { reportsRoot, runsRoot: path.join(tmp, 'runs'), reportsBaseUrl: 'https://reports.example' } } as unknown as Config;

    const index = await reportIndex({ config, pool, chain }, REQ_ID);
    assert.equal(validate('intake-api#report-index-response', index).ok, true, JSON.stringify(validate('intake-api#report-index-response', index).errors));
    assert.equal(index.stage1Url, `https://reports.example/${REQ_ID}/audit_stage_1.html`);
    assert.equal(index.adviceUrl, `https://reports.example/${REQ_ID}/audit_stage_2_advice.html`);
    assert.equal(index.pipelineUrl, `https://reports.example/${REQ_ID}/pipeline-progress.json`);
    assert.deepEqual(index.roundUrls, [
      `https://reports.example/${REQ_ID}/audit_round_1.html`,
      `https://reports.example/${REQ_ID}/audit_round_2.html`,
    ]);
  } finally {
    removeTree(reportsRoot);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('panelConfigDocument, accountConfigDocument, and localAuditArgv enforce valid pipelineMode and concurrency', () => {
  const panelDoc = panelConfigDocument('panel', { pipelineMode: 'step-by-step', concurrency: 4 });
  assert.equal(validate('run-config', panelDoc).ok, true, JSON.stringify(validate('run-config', panelDoc).errors));

  const acctDoc = accountConfigDocument('account-nearai', ['deepseek-ai/DeepSeek-V4'], { pipelineMode: 'stage-1', concurrency: 2 });
  assert.equal(validate('run-config', acctDoc).ok, true, JSON.stringify(validate('run-config', acctDoc).errors));

  const argv = localAuditArgv({ kind: 'path', target: '/var/reviews/repo', outDir: '/var/reviews/out', pipelineMode: 'step-by-step', concurrency: 3 });
  assert.deepEqual(argv, [
    'run', '--repo', '/var/reviews/repo', '--reviewers', 'scripted:baseline', '--passes', '1', '--tool-budget', '10', '--out', '/var/reviews/out',
    '--pipeline', 'step-by-step', '--concurrency', '3',
  ]);

  assert.throws(() => localAuditArgv({ kind: 'path', target: '/var/reviews/repo', outDir: '/var/reviews/out', pipelineMode: '--rpc' as never }), AppError);
  assert.throws(() => localAuditArgv({ kind: 'path', target: '/var/reviews/repo', outDir: '/var/reviews/out', concurrency: 0 }), AppError);
  assert.throws(() => localAuditArgv({ kind: 'path', target: '/var/reviews/repo', outDir: '/var/reviews/out', concurrency: 9 }), AppError);
});

test('publishReport output alone (after deleting source harness/ and sessions/) supports runAdviseStep + runDebateStep with COMPLETE verification health', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pub-continue-e2e-'));
  const reportsRoot = path.join(tmp, 'reports');
  const sourceDir = path.join(tmp, 'source-run');
  const contDir = path.join(tmp, 'worker-seeded');
  const targetDir = path.join(tmp, 'target-repo');
  try {
    const engineScript = (name: string) => pathToFileURL(path.resolve(APP_ROOT, '../../engine/scripts', name)).href;
    const { runOrchestratedAudit } = await import(engineScript('docker-agent-orchestrator.mjs'));
    const { finalizePipelineArtifacts, runAdviseStep, runDebateStep } = await import(engineScript('debate-step-cli.mjs'));
    const { commitSubmission } = await import(engineScript('audit-submission.mjs'));
    const { attachBudget } = await import(engineScript('bridge-budget.mjs'));
    const { callBridgeTool, parseBridgeArgs } = await import(engineScript('docker-mcp-bridge.mjs'));
    const { parseReviewerList, parseReviewerSpec } = await import(engineScript('reviewer-registry.mjs'));
    const { analyzeStackAndPlans } = await import(engineScript('audit-plans.mjs'));
    const { DEMO_FIXTURE } = await import(engineScript('scripted-strategies.mjs'));

    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(DEMO_FIXTURE, 'src/lib.rs'), path.join(targetDir, 'src/lib.rs'));

    const [ZAI, QWEN] = parseReviewerList(['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902']);
    const JUDGE = parseReviewerSpec('openrouter:anthropic/claude-opus-5.5');
    const CITE = { file: 'src/lib.rs', startLine: 30, endLine: 30, quote: 'let next = self.balance.saturating_sub(amount);' };
    const WITHDRAW = {
      title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'probable', location: ['src/lib.rs:30'],
      impact: 'Any caller lowers the balance.', preconditions: 'None.', analysis: 'withdraw never reads the predecessor (src/lib.rs:30).',
      validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor with the owner.',
    };

    const startSandbox = async (opts: { out: string }) => ({ container: 'inert', hostRunDir: opts.out, stop: async () => {} });
    const review = async (options: { identity: { role: string; name: string; agent: string }; bridgeArgs: string[]; directory: string }) => {
      const { identity, bridgeArgs, directory } = options;
      const out = bridgeArgs[bridgeArgs.indexOf('--report-dir') + 1]!;
      const ok = { code: 0, stop: 'submitted', sessionId: identity.name, directory, elapsedMs: 1, observedExitCode: 0 };
      if (identity.role === 'auditor') {
        commitSubmission(out, identity.name, identity, [...(identity.agent === ZAI.id ? [WITHDRAW] : []), { verified_safe: [] }]);
        return ok;
      }
      if (identity.role === 'crosscheck') {
        const rows = JSON.parse(fs.readFileSync(path.join(out, `crosscheck/${identity.agent}.json`), 'utf8')) as Array<{ id: string }>;
        commitSubmission(out, identity.name, identity, rows.map((r) => ({ id: r.id, verdict: 'upheld', reason: 'Confirmed.', evidence: ['src/lib.rs:30'] })));
        return ok;
      }
      const ctx = attachBudget(parseBridgeArgs([...bridgeArgs, '--demo-host', DEMO_FIXTURE]));
      ctx.sourceDigestChecked = true;
      const assignment = JSON.parse(fs.readFileSync(path.join(out, `harness/assignments/${identity.name}.json`), 'utf8')) as { kind?: string };
      if (identity.role === 'debater') {
        await callBridgeTool(ctx, 'submit_debate_turn', { verdict: 'upheld', citations: [CITE], argument: 'Missing owner check.' });
      } else if (assignment.kind === 'stage-advice') {
        fs.mkdirSync(path.join(directory, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'workspace', 'api-launch.json'), JSON.stringify({ PRIVATE_SESSION_SECRET: 'DO_NOT_LEAK' }));
        await callBridgeTool(ctx, 'submit_stage_advice', {
          qualityRating: 'strong',
          qualitySummary: 'Clean Stage 1 coverage.',
          coverageGaps: [],
          issues: [],
          debateNeeded: true,
          recommendedDepth: 'shallow',
          recommendedRounds: 1,
          focusClusterIds: ['cluster-1'],
          rationale: 'Verify single-author withdraw finding.',
          nextSteps: ['Run 1 debate round.'],
        });
      } else if (assignment.kind === 'judge') {
        fs.mkdirSync(path.join(directory, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'workspace', 'api-launch.json'), JSON.stringify({ PRIVATE_SESSION_SECRET: 'DO_NOT_LEAK' }));
        await callBridgeTool(ctx, 'submit_adjudication', { finalStatus: 'CONFIRMED', severity: 'high', rationale: 'Independent vendor confirmed citation.' });
      } else if (assignment.kind === 'general-review') {
        await callBridgeTool(ctx, 'submit_general_review', { report_json: JSON.stringify({ executiveSummary: 'Confirmed withdraw flaw.', openDisagreements: [] }) });
      }
      return ok;
    };

    await runOrchestratedAudit({
      target: targetDir,
      out: sourceDir,
      surface: 's1',
      pipelineMode: 'stage-1',
      reviewers: [ZAI, QWEN],
      orchestrator: JUDGE,
      budgets: { passes: 1, toolBudget: 5, maxCostUsd: null, debate: { rounds: 1, toolBudget: 4, maxClusters: 25 } },
    }, { review, startSandbox });

    const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'source-manifest.json'), 'utf8')) as { digest: string; files: unknown[] };
    fs.writeFileSync(path.join(sourceDir, 'harness/source-read-digest.json'), `${JSON.stringify({ version: 1, source: '/src', digest: manifest.digest, files: manifest.files, at: new Date().toISOString() }, null, 2)}\n`);
    fs.writeFileSync(path.join(sourceDir, 'harness/sandbox.md'), '# Sandbox\n\n| check | status | detail |\n|---|---|---|\n| gitleaks | ran | 0 leaks |\n');
    fs.writeFileSync(path.join(sourceDir, 'harness/stack-profile.json'), `${JSON.stringify(analyzeStackAndPlans(targetDir), null, 2)}\n`);
    fs.writeFileSync(path.join(sourceDir, 'harness/solana.md'), '# Solana leads\n\n- src/lib.rs:30\n');
    const testId = 'cargo-test-root';
    fs.writeFileSync(path.join(sourceDir, 'harness/existing-tests.json'), `${JSON.stringify({ version: 1, sourceDigest: manifest.digest, tests: [{ id: testId, kind: 'cargo-test', cwd: '.', description: 'cargo test' }], coverageGaps: [] }, null, 2)}\n`);
    const testRaw = JSON.stringify({ stdout: 'running 1 test\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n', stderr: '', omittedBytes: 0 });
    fs.writeFileSync(path.join(sourceDir, `harness/existing-test-output-${testId}-0.json`), testRaw);
    fs.writeFileSync(path.join(sourceDir, `harness/existing-test-results-${testId}.json`), `${JSON.stringify([{ testId, sourceDigest: manifest.digest, exitCode: 0, evidenceFile: `harness/existing-test-output-${testId}-0.json`, evidenceHash: crypto.createHash('sha256').update(testRaw).digest('hex') }], null, 2)}\n`);
    const scanDefs: Array<[string, Record<string, unknown>]> = [
      ['gitleaks', { code: 0, stdout: '[]', stderr: '' }],
      ['semgrep', { code: 0, stdout: '{"results":[],"errors":[]}', stderr: '' }],
      ['osv-scanner', { code: 0, stdout: '{"results":[]}', stderr: '' }],
    ];
    const checks: Array<Record<string, unknown>> = scanDefs.map(([tool, payload], idx) => {
      const rel = `harness/scanner-output-${tool}-${idx}.json`;
      fs.writeFileSync(path.join(sourceDir, rel), JSON.stringify(payload));
      return { tool, exitCode: 0, state: 'passed', findings: 0, version: '1.0.0', scope: '.', evidenceFile: rel };
    });
    checks.push(
      { tool: 'cargo-audit', state: 'not_applicable', detail: 'No Cargo.lock' },
      { tool: 'npm-audit', state: 'not_applicable', detail: 'No package-lock.json' },
    );
    fs.writeFileSync(path.join(sourceDir, 'harness/scanner-results.json'), `${JSON.stringify({ version: 1, checks }, null, 2)}\n`);
    await finalizePipelineArtifacts(sourceDir, { target: targetDir, pipelineMode: 'stage-1' });

    // Publish report via real publishReport (strips harness/, sessions/, *.log and sets 0444/0555)
    const published = publishReport({
      reportsRoot,
      requestId: REQ_ID,
      sourceDir,
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
    });
    assert.equal(fs.existsSync(path.join(published.dir, 'harness')), false, 'publishReport must strip top-level harness/');
    assert.equal(fs.existsSync(path.join(published.dir, 'sessions')), false, 'publishReport must strip top-level sessions/');

    // Delete source run's harness/ and sessions/ (entire sourceDir) completely
    fs.rmSync(sourceDir, { recursive: true, force: true });

    // Copy unlocked from published.dir exactly as seedFromParentReport does
    const copyUnlocked = (from: string, to: string) => {
      fs.mkdirSync(to, { recursive: true, mode: 0o700 });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === 'published.json' || entry.name === 'report.pdf') continue;
        const srcChild = path.join(from, entry.name);
        const dstChild = path.join(to, entry.name);
        if (entry.isDirectory()) copyUnlocked(srcChild, dstChild);
        else if (entry.isFile()) {
          fs.copyFileSync(srcChild, dstChild);
          fs.chmodSync(dstChild, 0o600);
        }
      }
    };
    copyUnlocked(published.dir, contDir);

    const adv1 = await runAdviseStep(contDir, { target: targetDir, review, startSandbox });
    assert.equal(adv1.advice.generatedBy.mode, 'model');
    // Re-run advise + 2 debate rounds so session archiving executes, then publishReport and ensure zero session files leak
    await runAdviseStep(contDir, { target: targetDir, review, startSandbox });
    const deb = await runDebateStep(contDir, { target: targetDir, rounds: 2, review, startSandbox });
    assert.equal(deb.incomplete, false);
    const finalFindings = JSON.parse(fs.readFileSync(path.join(contDir, 'findings-and-scores.json'), 'utf8')) as Array<{ finalStatus: string }>;
    assert.equal(finalFindings[0]?.finalStatus, 'CONFIRMED', 'multi-round runDebateStep (--rounds 2) must preserve Round 1 turns in Map priorState');

    const publishedFollowUp = publishReport({
      reportsRoot,
      requestId: CHILD_ID,
      sourceDir: contDir,
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      preset: 'panel',
    });
    for (const relEntry of fs.readdirSync(publishedFollowUp.dir, { recursive: true })) {
      const relStr = String(relEntry);
      assert.equal(relStr.includes('api-launch.json') || relStr.includes('sessions'), false, `private session leaked into published report: ${relStr}`);
    }

    const health = JSON.parse(fs.readFileSync(path.join(contDir, 'report-health.json'), 'utf8')) as {
      state: string;
      reviewState: string;
      errors: string[];
      incompletionNotes: unknown[];
      verification: { state: string; gaps: string[] };
    };
    assert.equal(health.state, 'validated_outputs');
    assert.equal(health.reviewState, 'validated_outputs');
    assert.equal(health.verification.state, 'passed');
    assert.deepEqual(health.verification.gaps, []);
    assert.deepEqual(health.errors, []);
    assert.deepEqual(health.incompletionNotes, []);
  } finally {
    removeTree(reportsRoot);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
