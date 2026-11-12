import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '../../packages/schemas/index.mjs';
import { analyzeStackAndPlans } from './audit-plans.mjs';
import { runRounds } from './debate-rounds.mjs';
import { finalizePipelineArtifacts, resolveStepOrchestrator, runAdviseStep, runDebateStep } from './debate-step-cli.mjs';
import { commitSubmission } from './audit-submission.mjs';
import { attachBudget } from './bridge-budget.mjs';
import { callBridgeTool, parseBridgeArgs } from './docker-mcp-bridge.mjs';
import { runOrchestratedAudit } from './docker-agent-orchestrator.mjs';
import { readReportJson } from './report-contract.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';
import { buildApiLaunch } from './provider-api-launch.mjs';
import { presetFor, runToolLoop } from './provider-openai-compat.mjs';
import { loadV2Data } from './report-section-v2-data.mjs';
import { parseReviewerList, parseReviewerSpec } from './reviewer-registry.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const AUDIT_BIN = path.join(REPO_ROOT, 'bin', 'audit');

function runAudit(args, env = {}) {
  return spawnSync('bash', [AUDIT_BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('step-by-step iterative pipeline: Stage 1 (no debates) -> Frontier Advice -> 4 iterative debate rounds', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pipeline-e2e-'));
  const reportDir = path.join(tmp, 'report');
  try {
    // Step 1: Stage 1 only (--no-debate)
    const s1 = runAudit(['demo', '--no-docker', '--no-debate', '--out', reportDir]);
    assert.equal(s1.status, 0, `audit demo --no-debate failed:\n${s1.stderr}\n${s1.stdout}`);

    for (const rel of [
      'audit_stage_1.json',
      'audit_stage_1.md',
      'audit_stage_1.html',
      'evidence/index.json',
      'evidence/claims.json',
      'evidence/clusters.json',
      'evidence/controls.json',
      'pipeline-progress.json',
      'report.html',
      'report-health.json',
    ]) {
      assert.equal(fs.existsSync(path.join(reportDir, rel)), true, `missing ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(reportDir, 'debate', 'rounds')), false, 'Stage 1 must not run debate rounds');

    const stage1Json = JSON.parse(fs.readFileSync(path.join(reportDir, 'audit_stage_1.json'), 'utf8'));
    assert.equal(stage1Json.stage, 'stage-1-no-debates');
    assert.equal(stage1Json.noDebates, true);
    assert.ok(Array.isArray(stage1Json.findings) && stage1Json.findings.length > 0);

    const progress1 = JSON.parse(fs.readFileSync(path.join(reportDir, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', progress1).ok, true, JSON.stringify(validate('pipeline-progress', progress1).errors));
    assert.equal(progress1.pipelineMode, 'stage-1');
    assert.equal(progress1.currentStage, 'stage-1');
    assert.equal(progress1.stage1.noDebates, true);
    assert.equal(progress1.debate.roundsCompleted, 0);

    const html1 = fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8');
    assert.match(html1, /STAGE 1 — NO DEBATES/);

    // Step 2: Frontier Orchestrator Quality & Debate Advice
    const s2 = runAudit(['advise', reportDir]);
    assert.equal(s2.status, 0, `audit advise failed:\n${s2.stderr}\n${s2.stdout}`);
    assert.doesNotMatch(s2.stdout, /undefined/, `advise CLI output had undefined: ${s2.stdout}`);
    // Refreshing Step 2 advice a second time must archive any prior inbox/session and succeed cleanly
    const s2Refresh = runAudit(['advise', reportDir]);
    assert.equal(s2Refresh.status, 0, `audit advise refresh failed:\n${s2Refresh.stderr}\n${s2Refresh.stdout}`);
    for (const rel of ['orchestrator-advice.json', 'orchestrator-advice.md', 'audit_stage_2_advice.html']) {
      assert.equal(fs.existsSync(path.join(reportDir, rel)), true, `missing ${rel}`);
    }
    const advice = JSON.parse(fs.readFileSync(path.join(reportDir, 'orchestrator-advice.json'), 'utf8'));
    assert.equal(validate('orchestrator-advice', advice).ok, true, JSON.stringify(validate('orchestrator-advice', advice).errors));
    assert.equal(typeof advice.debateAdvice.debateNeeded, 'boolean');
    assert.ok(advice.debateAdvice.recommendedRounds >= 0 && advice.debateAdvice.recommendedRounds <= 3);

    const progress2 = JSON.parse(fs.readFileSync(path.join(reportDir, 'pipeline-progress.json'), 'utf8'));
    assert.equal(validate('pipeline-progress', progress2).ok, true);
    assert.equal(progress2.currentStage, 'stage-2-advice');

    const html2 = fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8');
    assert.doesNotMatch(html2, /\( · \):/, 'report.html must not render empty advisor/rating placeholders');
    assert.ok(html2.includes(advice.generatedBy.orchestrator), 'report.html must include advisor id');
    assert.ok(html2.includes(advice.quality.rating.toUpperCase()), 'report.html must include quality rating');
    if (advice.debateAdvice.debateNeeded) {
      assert.match(html2, /DEBATES RECOMMENDED/);
    }

    // Step 3: Run 4 consecutive iterative debate rounds (testing standard rounds 1..3 + extended round 4!)
    for (let round = 1; round <= 4; round += 1) {
      const deb = runAudit(['debate', reportDir, '--rounds', '1']);
      assert.equal(deb.status, 0, `audit debate round ${round} failed:\n${deb.stderr}\n${deb.stdout}`);
      for (const ext of ['json', 'md', 'html']) {
        assert.equal(fs.existsSync(path.join(reportDir, `audit_round_${round}.${ext}`)), true, `missing audit_round_${round}.${ext}`);
      }
      const roundDoc = JSON.parse(fs.readFileSync(path.join(reportDir, `audit_round_${round}.json`), 'utf8'));
      assert.equal(roundDoc.round, round);

      const prog = JSON.parse(fs.readFileSync(path.join(reportDir, 'pipeline-progress.json'), 'utf8'));
      assert.equal(validate('pipeline-progress', prog).ok, true, JSON.stringify(validate('pipeline-progress', prog).errors));
      assert.equal(prog.debate.roundsCompleted, round);
      assert.equal(prog.stage1.noDebates, false);
    }

    const finalHtml = fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8');
    assert.doesNotMatch(finalHtml, /STAGE 1 — NO DEBATES/);
    assert.match(finalHtml, /STAGE 3 — DEBATE ROUND 4/);

    // Verify loadV2Data loads round >= 4 turns from debate/iterations/round-4 when present
    const iter4Dir = path.join(reportDir, 'debate', 'iterations', 'round-4');
    if (fs.existsSync(iter4Dir) && fs.readdirSync(iter4Dir).some((f) => f.endsWith('.json'))) {
      const v2 = loadV2Data(reportDir);
      assert.ok(v2.rounds.some((t) => t.round === 4), 'loadV2Data must surface round 4 turns from debate/iterations/round-4');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('audit step advances stage-1 -> stage-2-advice -> stage-3-debate and rejects tampered source digest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-step-cli-'));
  const reportDir = path.join(tmp, 'report');
  try {
    assert.equal(runAudit(['demo', '--no-docker', '--no-debate', '--out', reportDir]).status, 0);

    // First `audit step` runs Step 2 (advise)
    const stepA = runAudit(['step', reportDir]);
    assert.equal(stepA.status, 0, stepA.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(reportDir, 'pipeline-progress.json'), 'utf8')).currentStage, 'stage-2-advice');

    // Second `audit step` runs Step 3 (1 debate round)
    const stepB = runAudit(['step', reportDir]);
    assert.equal(stepB.status, 0, stepB.stderr);
    const progB = JSON.parse(fs.readFileSync(path.join(reportDir, 'pipeline-progress.json'), 'utf8'));
    assert.equal(progB.debate.roundsCompleted, 1);

    // Verify Docker-style createSnapshot manifest passes untampered and fails when tampered
    const manifestPath = path.join(reportDir, 'source-manifest.json');
    const demoTarget = path.join(HERE, 'demo-fixture');
    const snap = createSnapshot(demoTarget, { exclude: [reportDir] });
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(snap.manifest, null, 2));
      fs.writeFileSync(
        path.join(reportDir, 'harness', 'source-read-digest.json'),
        JSON.stringify({ version: 1, source: '/src', digest: snap.manifest.digest, files: snap.manifest.files, at: new Date().toISOString() }, null, 2),
      );
      for (const idFile of fs.readdirSync(path.join(reportDir, 'harness', 'identities'))) {
        if (!idFile.endsWith('.json')) continue;
        const p = path.join(reportDir, 'harness', 'identities', idFile);
        const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
        fs.writeFileSync(p, JSON.stringify({ ...doc, sourceDigest: snap.manifest.digest }, null, 2));
      }
      for (const subFile of fs.readdirSync(path.join(reportDir, 'submissions'))) {
        if (!subFile.endsWith('.json')) continue;
        const p = path.join(reportDir, 'submissions', subFile);
        const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
        fs.writeFileSync(p, JSON.stringify({ ...doc, identity: { ...doc.identity, sourceDigest: snap.manifest.digest } }, null, 2));
      }
    } finally {
      disposeSnapshot(snap);
    }
    const snapDebate = runAudit(['debate', reportDir, '--rounds', '1']);
    assert.equal(snapDebate.status, 0, `createSnapshot manifest must pass: ${snapDebate.stderr}`);

    // Tamper source-manifest.json and verify `audit debate` refuses to run on untrusted digest
    const orig = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...orig, digest: '0'.repeat(64) }));
    const refused = runAudit(['debate', reportDir, '--rounds', '1']);
    assert.notEqual(refused.status, 0, 'tampered source digest must be refused');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI rejects invalid pipeline modes, conflicting flags, out-of-range concurrency, and invalid debate round counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cli-invalid-'));
  try {
    assert.notEqual(runAudit(['demo', '--no-docker', '--pipeline', 'bogus', '--out', path.join(tmp, 'r1')]).status, 0);
    assert.notEqual(runAudit(['demo', '--no-docker', '--step-by-step', '--no-debate', '--out', path.join(tmp, 'r2')]).status, 0);
    assert.notEqual(runAudit(['demo', '--no-docker', '--concurrency', '0', '--out', path.join(tmp, 'r3')]).status, 0);
    assert.notEqual(runAudit(['demo', '--no-docker', '--concurrency', '9', '--out', path.join(tmp, 'r4')]).status, 0);
    assert.notEqual(runAudit(['debate', tmp, '--rounds', '0']).status, 0);
    assert.notEqual(runAudit(['debate', tmp, '--rounds', '6']).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runDebate executes round speakers in parallel while settling deterministic turn ordering', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-parallel-debate-'));
  try {
    const srcContent = 'fn withdraw(amount: u64) {\n  transfer(amount);\n}\n';
    const reader = {
      lines: () => ({ lines: srcContent.split('\n') }),
      readLines: () => srcContent.split('\n'),
      readFile: () => srcContent,
    };
    const makeDelayedSpeaker = (verdict) => async ({ round, cluster, role, anonId }) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        round: round <= 3 ? round : 3,
        clusterId: cluster.id,
        role,
        anonId,
        verdict,
        citations: [{ file: 'src/lib.rs', startLine: 1, endLine: 2, quote: 'fn withdraw(amount: u64) {' }],
        argument: `Speaker ${anonId} evaluated withdraw authorization.`,
      };
    };

    const voices = new Map([
      ['author-a', makeDelayedSpeaker('upheld')],
      ['challenger-b', makeDelayedSpeaker('refuted')],
      ['challenger-c', makeDelayedSpeaker('refuted')],
      ['challenger-d', makeDelayedSpeaker('refuted')],
    ]);
    const clusters = [{
      id: 'cluster-1',
      status: 'QUEUED',
      severity: 'High',
      title: 'Unchecked withdraw',
      authors: ['author-a'],
      vendors: ['v-a'],
      anchors: [{ file: 'src/lib.rs', startLine: 1, endLine: 3 }],
      evidence: [{ file: 'src/lib.rs', startLine: 1, endLine: 2, quote: 'fn withdraw(amount: u64) {', valid: true }],
      claims: [],
    }];

    const t0 = Date.now();
    const res = await runRounds({
      out: tmp,
      clusters,
      voices,
      vendors: new Map([['author-a', 'v-a'], ['challenger-b', 'v-b'], ['challenger-c', 'v-c'], ['challenger-d', 'v-d']]),
      reader,
      rounds: 1,
      concurrency: 4,
    });
    const elapsed = Date.now() - t0;
    // 3 challengers at 120ms each sequentially would take >= 360ms; in parallel they complete well under 300ms.
    assert.ok(elapsed < 320, `expected parallel round execution (< 320ms), took ${elapsed}ms`);
    assert.equal(res.debated.get('cluster-1').turns.length, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Cloud/API launch & tool loop recognize all 6 submit tools (fixing arguing loop timeouts)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-api-submit-tools-'));
  try {
    const reviewer = { id: 'openrouter-qwen', family: 'openrouter', vendor: 'qwen', model: 'qwen/qwen3-coder' };
    const preset = presetFor('openrouter');
    const baseCtx = { workDir: tmp, env: { OPENROUTER_API_KEY: 'sk-test-dummy' } };

    // Check api-launch.json written for each role
    const checkRole = (ctx, expectedTool) => {
      const dir = fs.mkdtempSync(path.join(tmp, 'role-'));
      buildApiLaunch(reviewer, { ...ctx, workDir: dir }, preset);
      const written = JSON.parse(fs.readFileSync(path.join(dir, 'api-launch.json'), 'utf8'));
      assert.equal(written.submitTool, expectedTool);
    };

    checkRole({ ...baseCtx, role: 'auditor', bridgeArgs: [] }, 'submit_audit_report');
    checkRole({ ...baseCtx, role: 'crosscheck', bridgeArgs: [] }, 'submit_crosscheck_report');
    checkRole({ ...baseCtx, role: 'debater', bridgeArgs: [] }, 'submit_debate_turn');
    checkRole({ ...baseCtx, role: 'orchestrator', bridgeArgs: ['--auditor', 'orch-adjudicate-cluster-1'] }, 'submit_adjudication');
    checkRole({ ...baseCtx, role: 'orchestrator', bridgeArgs: ['--auditor', 'orch-general-review'] }, 'submit_general_review');
    checkRole({ ...baseCtx, role: 'orchestrator', bridgeArgs: ['--auditor', 'orch-stage-advice'] }, 'submit_stage_advice');

    // Verify runToolLoop stops immediately with stop === 'submitted' when submit_debate_turn or submit_stage_advice succeeds
    for (const submitName of ['submit_debate_turn', 'submit_adjudication', 'submit_general_review', 'submit_stage_advice']) {
      let fetchCalls = 0;
      const fakeFetch = async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({
          model: 'qwen/qwen3-coder',
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: submitName, arguments: '{"ok":true}' } }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const outcome = await runToolLoop({
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-test-dummy',
        model: 'qwen/qwen3-coder',
        brief: 'Submit now',
        tools: [{ type: 'function', function: { name: submitName, parameters: { type: 'object' } } }],
        submitTool: submitName,
        maxTurns: 5,
        fetchImpl: fakeFetch,
        callTool: async () => '{"accepted":true}',
      });
      assert.equal(outcome.stop, 'submitted', `${submitName} must stop immediately as 'submitted'`);
      assert.equal(fetchCalls, 1, `${submitName} must not continue looping after submission`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function seedVerificationCompleteHarness(out, target) {
  const manifest = readReportJson(out, 'source-manifest.json');
  fs.writeFileSync(
    path.join(out, 'harness', 'source-read-digest.json'),
    `${JSON.stringify({ version: 1, source: '/src', digest: manifest.digest, files: manifest.files, at: new Date().toISOString() }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(out, 'harness', 'sandbox.md'),
    '# Sandbox\n\n| check | status | detail |\n|---|---|---|\n| gitleaks | ran | 0 leaks |\n',
  );
  fs.writeFileSync(
    path.join(out, 'harness', 'stack-profile.json'),
    `${JSON.stringify(analyzeStackAndPlans(target), null, 2)}\n`,
  );
  fs.writeFileSync(path.join(out, 'harness', 'solana.md'), '# Solana leads\n\n- src/lib.rs:30 unchecked owner\n');

  const testId = 'cargo-test-root';
  fs.writeFileSync(
    path.join(out, 'harness', 'existing-tests.json'),
    `${JSON.stringify({
      version: 1,
      sourceDigest: manifest.digest,
      tests: [{ id: testId, kind: 'cargo-test', cwd: '.', description: 'cargo test (workspace)' }],
      coverageGaps: [],
    }, null, 2)}\n`,
  );
  const testOut = {
    stdout: 'running 2 tests\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n',
    stderr: '',
    omittedBytes: 0,
  };
  const testEvidenceRel = `harness/existing-test-output-${testId}-0.json`;
  const testOutRaw = JSON.stringify(testOut);
  fs.writeFileSync(path.join(out, testEvidenceRel), testOutRaw);
  const evidenceHash = crypto.createHash('sha256').update(testOutRaw).digest('hex');
  fs.writeFileSync(
    path.join(out, 'harness', `existing-test-results-${testId}.json`),
    `${JSON.stringify([{
      testId,
      sourceDigest: manifest.digest,
      exitCode: 0,
      evidenceFile: testEvidenceRel,
      evidenceHash,
    }], null, 2)}\n`,
  );

  const scannerPayloads = [
    ['gitleaks', { code: 0, stdout: '[]', stderr: '' }],
    ['semgrep', { code: 0, stdout: '{"results":[],"errors":[]}', stderr: '' }],
    ['osv-scanner', { code: 0, stdout: '{"results":[]}', stderr: '' }],
  ];
  const checks = scannerPayloads.map(([tool, payload], idx) => {
    const rel = `harness/scanner-output-${tool}-${idx}.json`;
    fs.writeFileSync(path.join(out, rel), JSON.stringify(payload));
    return { tool, exitCode: 0, state: 'passed', findings: 0, version: '1.0.0', scope: '.', evidenceFile: rel };
  });
  checks.push(
    { tool: 'cargo-audit', state: 'not_applicable', detail: 'No Cargo.lock' },
    { tool: 'npm-audit', state: 'not_applicable', detail: 'No package-lock.json' },
  );
  fs.writeFileSync(
    path.join(out, 'harness', 'scanner-results.json'),
    `${JSON.stringify({ version: 1, checks }, null, 2)}\n`,
  );
  return { manifest, target };
}

test('incomplete runDebateStep writes all artifacts, exits 2 via CLI, and cleans resolved stageFailures on a clean follow-up round', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-debate-step-incomplete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.copyFileSync(path.join(DEMO_FIXTURE, 'src/lib.rs'), path.join(target, 'src/lib.rs'));

  const [ZAI, QWEN] = parseReviewerList(['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902']);
  const JUDGE = parseReviewerSpec('openrouter:anthropic/claude-opus-5.5');
  const CITE = { file: 'src/lib.rs', startLine: 30, endLine: 30, quote: 'let next = self.balance.saturating_sub(amount);' };
  const WITHDRAW = {
    title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'probable', location: ['src/lib.rs:30'],
    impact: 'Any caller lowers the balance.', preconditions: 'None.', analysis: 'withdraw never reads the predecessor (src/lib.rs:30).',
    validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor with the owner.',
  };
  const argVal = (args, name) => args[args.indexOf(name) + 1];
  const okRes = (identity, options) => ({ code: 0, stop: 'submitted', sessionId: identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 });

  const out = path.join(root, 'report');
  let failRound1 = true;

  const review = async (options) => {
    const { identity, bridgeArgs } = options;
    const reportDir = argVal(bridgeArgs, '--report-dir');
    if (identity.role === 'auditor') {
      commitSubmission(reportDir, identity.name, identity, [...(identity.agent === ZAI.id ? [WITHDRAW] : []), { verified_safe: [] }]);
      return okRes(identity, options);
    }
    if (identity.role === 'crosscheck') {
      // Non-anchor citation in cross-check so round 1 launches a live challenge turn
      commitSubmission(reportDir, identity.name, identity, readReportJson(reportDir, `crosscheck/${identity.agent}.json`).map((row) => ({
        id: row.id, verdict: 'refuted', reason: 'Needs deeper check.', evidence: ['src/lib.rs:9999'],
      })));
      return okRes(identity, options);
    }
    const assignment = readReportJson(reportDir, `harness/assignments/${identity.name}.json`);
    if (failRound1 && identity.role === 'debater') {
      return { code: 124, stop: 'failed', failureReason: 'timeout', sessionId: identity.name, directory: options.directory, elapsedMs: 10, observedExitCode: 124 };
    }
    if (failRound1 && assignment.kind === 'general-review') {
      return { code: 124, stop: 'failed', failureReason: 'timeout', sessionId: identity.name, directory: options.directory, elapsedMs: 10, observedExitCode: 124 };
    }
    const ctx = attachBudget(parseBridgeArgs([...bridgeArgs, '--demo-host', DEMO_FIXTURE]));
    ctx.sourceDigestChecked = true;
    if (identity.role === 'debater') {
      await callBridgeTool(ctx, 'submit_debate_turn', { verdict: 'upheld', citations: [CITE], argument: 'withdraw lacks predecessor check.' });
    } else if (assignment.kind === 'judge') {
      await callBridgeTool(ctx, 'submit_adjudication', { finalStatus: 'CONFIRMED', severity: 'high', rationale: 'Verified missing owner check at src/lib.rs:30.' });
    } else if (assignment.kind === 'general-review') {
      await callBridgeTool(ctx, 'submit_general_review', { report_json: JSON.stringify({ executiveSummary: 'Confirmed withdraw access-control flaw.', openDisagreements: [] }) });
    }
    return okRes(identity, options);
  };

  const startSandbox = async ({ out: dir }) => ({ container: 'inert', hostRunDir: dir, stop: async () => {} });
  await runOrchestratedAudit({
    target,
    out,
    surface: 's1',
    pipelineMode: 'stage-1',
    reviewers: [ZAI, QWEN],
    orchestrator: JUDGE,
    budgets: { passes: 1, toolBudget: 5, maxCostUsd: null, debate: { rounds: 1, toolBudget: 4, maxClusters: 25 } },
  }, { review, startSandbox });
  seedVerificationCompleteHarness(out, target);
  await finalizePipelineArtifacts(out, { target, pipelineMode: 'stage-1' });

  // Round 1: speaker turn times out AND generalReviewStage throws general_review_unavailable
  const r1 = await runDebateStep(out, { target, rounds: 1, review, startSandbox });
  assert.equal(r1.incomplete, true, 'Round 1 must report incomplete: true without crashing');

  const meta1 = readReportJson(out, 'meta.json');
  assert.equal(meta1.finalized, true, 'meta.json must still be finalized');
  assert.equal(meta1.debatesCompleted, true);
  assert.ok(meta1.stageFailures.some((s) => s.startsWith('phase_failed:adjudicate:debate_incomplete:')), `expected adjudicate failure in ${JSON.stringify(meta1.stageFailures)}`);
  assert.ok(meta1.stageFailures.some((s) => s.startsWith('phase_failed:general-review:general_review_unavailable:')), `expected general-review failure in ${JSON.stringify(meta1.stageFailures)}`);

  for (const rel of ['general-review.json', 'general-review.md', 'evidence/debate-state.json', 'report.html', 'audit_round_1.json', 'audit_round_1.md', 'audit_round_1.html', 'pipeline-progress.json']) {
    assert.equal(fs.existsSync(path.join(out, rel)), true, `missing ${rel} after incomplete debate step`);
  }
  const gen1 = readReportJson(out, 'general-review.json');
  assert.equal(validate('general-review', gen1).ok, true);
  assert.ok(Array.isArray(gen1.incompletionNotes) && gen1.incompletionNotes.some((n) => n.code === 'general_review_unavailable'), 'general-review.json must be patched with final incompletionNotes including general_review_unavailable');
  assert.ok(gen1.incompletionNotes.some((n) => n.code === 'debate_turn_timeout'), 'general-review.json must include unanswered debate turn timeout note');

  // Verify CLI entrypoint exits with code 2 when report is incomplete (e.g., scripted debate on report with a stageFailure)
  const cliOut = path.join(root, 'cli-incomplete');
  assert.equal(runAudit(['demo', '--no-docker', '--no-debate', '--out', cliOut]).status, 0);
  const cliMeta = readReportJson(cliOut, 'meta.json');
  fs.writeFileSync(path.join(cliOut, 'meta.json'), `${JSON.stringify({ ...cliMeta, stageFailures: ['auditor_error:scripted-baseline-s1-auth'] }, null, 2)}\n`);
  const cliDeb = runAudit(['debate', cliOut, '--rounds', '1']);
  assert.equal(cliDeb.status, 2, `expected exit code 2 on incomplete debate step, got ${cliDeb.status}`);
  assert.equal(fs.existsSync(path.join(cliOut, 'audit_round_1.json')), true, 'CLI must write audit_round_1.json before exiting 2');

  // Round 2: speaker turns and generalReviewStage succeed -> prior-round debate stageFailures are cleaned!
  failRound1 = false;
  const r2 = await runDebateStep(out, { target, rounds: 1, review, startSandbox });
  assert.equal(r2.incomplete, false, 'Clean Round 2 re-run must clear prior-round debate failures');
  const meta2 = readReportJson(out, 'meta.json');
  assert.deepEqual(meta2.stageFailures, []);
  const health2 = readReportJson(out, 'report-health.json');
  assert.equal(health2.state, 'validated_outputs');
});

test('Cloud published continuation restores full harness evidence without secrets/logs and preserves sandbox & scanner records', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-published-cont-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.copyFileSync(path.join(DEMO_FIXTURE, 'src/lib.rs'), path.join(target, 'src/lib.rs'));

  const [ZAI, QWEN] = parseReviewerList(['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902']);
  const JUDGE = parseReviewerSpec('openrouter:anthropic/claude-opus-5.5');
  const CITE = { file: 'src/lib.rs', startLine: 30, endLine: 30, quote: 'let next = self.balance.saturating_sub(amount);' };
  const WITHDRAW = {
    title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'probable', location: ['src/lib.rs:30'],
    impact: 'Any caller lowers the balance.', preconditions: 'None.', analysis: 'withdraw never reads the predecessor (src/lib.rs:30).',
    validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor with the owner.',
  };
  const argVal = (args, name) => args[args.indexOf(name) + 1];
  const okRes = (identity, options) => ({ code: 0, stop: 'submitted', sessionId: identity.name, directory: options.directory, elapsedMs: 1, observedExitCode: 0 });

  const stage1Dir = path.join(root, 'stage1-source');
  const sandboxCalls = [];
  const startSandbox = async (opts) => {
    sandboxCalls.push({ preserveHarness: Boolean(opts.preserveHarness), skipPrep: Boolean(opts.skipPrep) });
    return { container: 'inert', hostRunDir: opts.out, stop: async () => {} };
  };
  const review = async (options) => {
    const { identity, bridgeArgs } = options;
    const reportDir = argVal(bridgeArgs, '--report-dir');
    if (identity.role === 'auditor') {
      commitSubmission(reportDir, identity.name, identity, [...(identity.agent === ZAI.id ? [WITHDRAW] : []), { verified_safe: [] }]);
      return okRes(identity, options);
    }
    if (identity.role === 'crosscheck') {
      commitSubmission(reportDir, identity.name, identity, readReportJson(reportDir, `crosscheck/${identity.agent}.json`).map((row) => ({
        id: row.id, verdict: 'upheld', reason: 'Confirmed at src/lib.rs:30.', evidence: ['src/lib.rs:30'],
      })));
      return okRes(identity, options);
    }
    const ctx = attachBudget(parseBridgeArgs([...bridgeArgs, '--demo-host', DEMO_FIXTURE]));
    ctx.sourceDigestChecked = true;
    // Verify restored allow-listed lead file (solana.md) is readable through the MCP bridge!
    const leadText = await callBridgeTool(ctx, 'read_file', { path: '/out/harness/solana.md' });
    assert.match(leadText, /Solana leads/);
    const assignment = readReportJson(reportDir, `harness/assignments/${identity.name}.json`);
    if (identity.role === 'debater') {
      await callBridgeTool(ctx, 'submit_debate_turn', { verdict: 'upheld', citations: [CITE], argument: 'Verified missing owner check.' });
    } else if (assignment.kind === 'stage-advice') {
      fs.mkdirSync(path.join(options.directory, 'workspace'), { recursive: true });
      fs.writeFileSync(path.join(options.directory, 'workspace', 'api-launch.json'), JSON.stringify({ PRIVATE_SESSION_MARKER: true }));
      await callBridgeTool(ctx, 'submit_stage_advice', {
        qualityRating: 'strong',
        qualitySummary: 'Stage 1 coverage is complete.',
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
      fs.mkdirSync(path.join(options.directory, 'workspace'), { recursive: true });
      fs.writeFileSync(path.join(options.directory, 'workspace', 'api-launch.json'), JSON.stringify({ PRIVATE_SESSION_MARKER: true }));
      await callBridgeTool(ctx, 'submit_adjudication', { finalStatus: 'CONFIRMED', severity: 'high', rationale: 'Independent vendor upheld citation.' });
    } else if (assignment.kind === 'general-review') {
      await callBridgeTool(ctx, 'submit_general_review', { report_json: JSON.stringify({ executiveSummary: 'One confirmed withdraw flaw.', openDisagreements: [] }) });
    }
    return okRes(identity, options);
  };

  await runOrchestratedAudit({
    target,
    out: stage1Dir,
    surface: 's1',
    pipelineMode: 'stage-1',
    reviewers: [ZAI, QWEN],
    orchestrator: JUDGE,
    budgets: { passes: 1, toolBudget: 5, maxCostUsd: null, debate: { rounds: 1, toolBudget: 4, maxClusters: 25 } },
  }, { review, startSandbox });
  seedVerificationCompleteHarness(stage1Dir, target);
  fs.mkdirSync(path.join(stage1Dir, 'harness', 'host'), { recursive: true });
  fs.writeFileSync(path.join(stage1Dir, 'harness', 'host', 'secret.log'), 'DO_NOT_PUBLISH');
  fs.writeFileSync(path.join(stage1Dir, 'sessions', 'secret.log'), 'DO_NOT_PUBLISH');
  await finalizePipelineArtifacts(stage1Dir, { target, pipelineMode: 'stage-1' });

  // Verify evidence/harness/ NEVER contains host/, sandbox-run/, sessions/, or *.log
  assert.equal(fs.existsSync(path.join(stage1Dir, 'evidence', 'harness', 'host')), false);
  assert.equal(fs.existsSync(path.join(stage1Dir, 'evidence', 'harness', 'sandbox-run')), false);
  assert.equal(fs.existsSync(path.join(stage1Dir, 'evidence', 'sessions')), false);

  // Simulate Cloud publishReport stripping harness/, sessions/, and *.log, then deleting source run completely
  const publishedCopy = path.join(root, 'published-seeded');
  fs.cpSync(stage1Dir, publishedCopy, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(stage1Dir, src);
      if (!rel) return true;
      const top = rel.split(path.sep)[0];
      if (top === 'harness' || top === 'sessions') return false;
      if (src.endsWith('.log')) return false;
      return true;
    },
  });
  fs.rmSync(stage1Dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(path.join(publishedCopy, 'harness')), false);
  assert.equal(fs.existsSync(path.join(publishedCopy, 'sessions')), false);

  sandboxCalls.length = 0;
  const adv1 = await runAdviseStep(publishedCopy, { target, review, startSandbox });
  assert.equal(adv1.advice.generatedBy.mode, 'model', 'runAdviseStep must invoke real submit_stage_advice and produce model advice');
  assert.deepEqual(adv1.advice.debateAdvice.focusClusterIds, ['CLUSTER-1']);
  assert.deepEqual(sandboxCalls, [{ preserveHarness: true, skipPrep: true }], 'advise must preserve harness and skip prep');
  assert.match(fs.readFileSync(path.join(publishedCopy, 'harness', 'sandbox.md'), 'utf8'), /gitleaks \| ran/);

  // Re-run advise to trigger session archiving and ensure private session files NEVER leak into evidence/
  await runAdviseStep(publishedCopy, { target, review, startSandbox });

  sandboxCalls.length = 0;
  // Round 1 needs crosscheck AND existing-tests.json has 1 catalogued suite -> preserveHarness: true, skipPrep: false
  const deb1 = await runDebateStep(publishedCopy, { target, rounds: 1, review, startSandbox });
  assert.equal(deb1.incomplete, false);
  assert.deepEqual(sandboxCalls, [{ preserveHarness: true, skipPrep: false }]);

  // Round 2 is post-crosscheck -> preserveHarness: true, skipPrep: true (and triggers archiveJudgeInboxForNextRound)
  sandboxCalls.length = 0;
  const deb2 = await runDebateStep(publishedCopy, { target, rounds: 1, review, startSandbox });
  assert.equal(deb2.incomplete, false);
  assert.deepEqual(sandboxCalls, [{ preserveHarness: true, skipPrep: true }]);

  // Verify zero private session files or directories were archived into evidence/
  for (const relPath of fs.readdirSync(path.join(publishedCopy, 'evidence'), { recursive: true })) {
    const relStr = String(relPath);
    assert.equal(relStr.includes('api-launch.json') || relStr.includes('sessions'), false, `private session leaked into evidence/${relStr}`);
  }

  const finalHealth = readReportJson(publishedCopy, 'report-health.json');
  assert.equal(finalHealth.state, 'validated_outputs');
  assert.equal(finalHealth.reviewState, 'validated_outputs');
  assert.equal(finalHealth.verification.state, 'passed');
  assert.deepEqual(finalHealth.verification.gaps, []);
  assert.deepEqual(finalHealth.errors, []);
  assert.deepEqual(finalHealth.incompletionNotes, []);
});

test('resolveStepOrchestrator and runAdviseStep never auto-select scripted:judge on real non-fixture targets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-step-orch-real-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const realTarget = path.join(root, 'real-repo');
  fs.mkdirSync(path.join(realTarget, 'src'), { recursive: true });
  fs.copyFileSync(path.join(DEMO_FIXTURE, 'src/lib.rs'), path.join(realTarget, 'src/lib.rs'));

  const [CODEX] = parseReviewerList(['cli:codex:gpt-6-1-sol']);
  const reportDir = path.join(root, 'report');
  await runOrchestratedAudit({
    target: realTarget,
    out: reportDir,
    surface: 's1',
    pipelineMode: 'stage-1',
    reviewers: [CODEX],
    orchestrator: null,
    budgets: { passes: 1, toolBudget: 5, maxCostUsd: null, debate: { rounds: 1, toolBudget: 4, maxClusters: 25 } },
  }, {
    startSandbox: async ({ out }) => ({ container: 'inert', hostRunDir: out, stop: async () => {} }),
    review: async ({ identity, bridgeArgs, directory }) => {
      const out = bridgeArgs[bridgeArgs.indexOf('--report-dir') + 1];
      commitSubmission(out, identity.name, identity, [{ verified_safe: [] }]);
      return { code: 0, stop: 'submitted', sessionId: identity.name, directory, elapsedMs: 1, observedExitCode: 0 };
    },
  });
  seedVerificationCompleteHarness(reportDir, realTarget);
  await finalizePipelineArtifacts(reportDir, { target: realTarget, pipelineMode: 'stage-1' });
  const meta = readReportJson(reportDir, 'meta.json');
  assert.equal(meta.orchestrator, null);

  // 1. With no frontier orchestrator and no CLI on PATH, returns null (never scripted:judge) and runAdviseStep uses rulesStageAdvice
  const emptyEnv = { PATH: '' };
  assert.equal(resolveStepOrchestrator(reportDir, meta, undefined, emptyEnv, {}, realTarget), null);
  assert.equal(
    resolveStepOrchestrator(reportDir, { ...meta, orchestrator: { requested: 'recommended', resolved: 'scripted:judge' } }, undefined, emptyEnv, {}, realTarget),
    null,
  );
  const advRes = await runAdviseStep(reportDir, { target: realTarget, env: emptyEnv });
  assert.equal(advRes.advice.generatedBy.mode, 'rules_fallback');
  assert.equal(validate('orchestrator-advice', advRes.advice).ok, true);

  // 2. When a non-scripted run reviewer (codex) IS available on PATH (and claude is not), falls back to that run reviewer
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeCodex = path.join(binDir, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const picked = resolveStepOrchestrator(reportDir, meta, undefined, { PATH: binDir }, {}, realTarget);
  assert.ok(picked);
  assert.equal(picked.id, CODEX.id);
  assert.notEqual(picked.family, 'scripted');

  // 3. --config / --preset / OMNI_RUN_CONFIG properly resolves a configured model orchestrator
  const cfgPath = path.join(root, 'custom-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    reviewers: ['key:zai:glm-5.3'],
    presets: {
      panel: {
        reviewers: ['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902'],
        orchestrator: 'openrouter:anthropic/claude-opus-5.5',
      },
    },
  }));
  const fromPreset = resolveStepOrchestrator(reportDir, meta, undefined, emptyEnv, { configFile: cfgPath, preset: 'panel' }, realTarget);
  assert.equal(fromPreset?.model, 'anthropic/claude-opus-5.5');
  const fromEnvCfg = resolveStepOrchestrator(reportDir, meta, undefined, { ...emptyEnv, OMNI_RUN_CONFIG: cfgPath }, { preset: 'panel' }, realTarget);
  assert.equal(fromEnvCfg?.model, 'anthropic/claude-opus-5.5');

  // 4. Explicitly passing scripted:judge on a real target is still refused
  await assert.rejects(
    () => runAdviseStep(reportDir, { target: realTarget, orchestratorSpec: 'scripted:judge', env: emptyEnv }),
    /scripted_judge_demo_only/,
  );
});
