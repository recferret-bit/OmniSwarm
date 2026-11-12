import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validate } from '../../packages/schemas/index.mjs';
import { adjudicateStage, debateStage, generalReviewStage, missingAnswersError } from './debate-run.mjs';
import { rulesStageAdvice } from './orchestrator-advice.mjs';
import { buildIncompletionNotes, categorizeFailureReason, stage1DefersDebates } from './report-incompletion.mjs';
import { budgetHealth } from './verification-health.mjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omni-incompletion-'));
}

function writeJson(dir, rel, value) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

test('stage1DefersDebates distinguishes intentional Stage 1 deferral from full runs and completed debates', () => {
  assert.equal(stage1DefersDebates(null), false);
  assert.equal(stage1DefersDebates({ pipelineMode: 'full', debatesCompleted: false, crosscheckExits: {} }), false);
  assert.equal(stage1DefersDebates({ pipelineMode: 'full', stage1DefersDebates: true, debatesCompleted: false, crosscheckExits: {} }), true);
  assert.equal(stage1DefersDebates({ pipelineMode: 'stage-1', debatesCompleted: false, crosscheckExits: {} }), true);
  assert.equal(stage1DefersDebates({ pipelineMode: 'step-by-step', debatesCompleted: false, crosscheckExits: {} }), true);
  assert.equal(stage1DefersDebates({ pipelineMode: 'step-by-step', debatesCompleted: true, crosscheckExits: {} }), false);
  assert.equal(stage1DefersDebates({ pipelineMode: 'stage-1', crosscheckExits: { claude: 0 } }), false);
});

test('categorizeFailureReason maps cost_ceiling and budget reasons to budget_exhausted', () => {
  assert.equal(categorizeFailureReason('cost_ceiling', 1), 'budget_exhausted');
  assert.equal(categorizeFailureReason('budget', 1), 'budget_exhausted');
  assert.equal(categorizeFailureReason('cost', 1), 'budget_exhausted');
  assert.equal(categorizeFailureReason('timeout', 124), 'timeout');
  assert.equal(categorizeFailureReason('usage_limit', 1), 'usage_limit');
  assert.equal(categorizeFailureReason('provider_error', 1), 'provider_error');
});

test('buildIncompletionNotes produces zero notes on a clean Stage 1 report or clean budget submission', () => {
  const dir = makeTempDir();
  try {
    // Reviewer used full toolBudget AND submitted cleanly: budgetHealth is COMPLETE and should NOT emit a note
    const cleanBudget = budgetHealth([
      { reviewer: 'claude', job: 'claude-s1', pass: 1, stop: 'budget', submitted: true },
    ]);
    assert.equal(cleanBudget.state, 'COMPLETE');
    writeJson(dir, 'harness/budget-health.json', cleanBudget);

    const meta = {
      pipelineMode: 'step-by-step',
      debatesCompleted: false,
      agents: ['claude', 'codex'],
      workerExits: { 'claude-s1': 0, 'codex-s2': 0 },
      crosscheckExits: {},
      stageFailures: [],
    };
    const health = {
      complete: true,
      expected: ['claude-s1', 'codex-s2'],
      accepted: ['claude-s1', 'codex-s2'],
      errors: [],
      verification: { gaps: [] },
    };
    const notes = buildIncompletionNotes(dir, { meta, health });
    assert.deepEqual(notes, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildIncompletionNotes parses real budgetHealth(), cost_ceiling workers, real trace/adjudication shapes, phase_failed prefixes, and scrubs host paths', () => {
  const dir = makeTempDir();
  try {
    writeJson(dir, 'workers.json', {
      jobs: [
        { name: 'claude-s1', adapter: 'claude', failure: { reason: 'timeout' } },
        { name: 'grok-s4', adapter: 'grok', failure: { reason: 'usage_limit' } },
        { name: 'deepseek-s5', adapter: 'deepseek', failure: { reason: 'cost_ceiling' } },
      ],
    });

    // Real budgetHealth() output from verification-health.mjs
    const realBudget = budgetHealth([
      { reviewer: 'claude', job: 'claude-s3', pass: 1, stop: 'submitted', submitted: true },
      { reviewer: 'claude', job: 'claude-s3', pass: 2, stop: 'budget', submitted: false, restored: true },
      { reviewer: 'grok', job: 'grok-s2', pass: 1, stop: 'submitted', submitted: true },
      { reviewer: 'grok', job: 'grok-s2', pass: 2, stop: 'cost', reason: 'cost_ceiling', submitted: true, spentUsd: 5, maxCostUsd: 5 },
      { reviewer: 'codex', job: 'codex-s2', pass: 1, stop: 'budget', submitted: false },
    ]);
    assert.equal(realBudget.state, 'INCOMPLETE');
    assert.deepEqual(realBudget.errors, ['codex: budget_exhausted_without_submission']);
    writeJson(dir, 'harness/budget-health.json', realBudget);

    writeJson(dir, 'debate/clusters.json', {
      coverageGaps: [
        { clusterId: 'cluster-4', reason: 'debate_cap' },
      ],
    });

    // Real adjudication.json shapes written by debate-judge.mjs / debate-run.mjs
    writeJson(dir, 'debate/adjudication.json', [
      {
        clusterId: 'cluster-2',
        finalStatus: 'LIKELY',
        severity: 'high',
        severityReason: 'Left at the reported severity.',
        judge: { reviewerId: 'claude', vendor: 'anthropic', alternate: false },
        rationale: 'judge_unavailable (session_failed); LIKELY from the citation rules only.',
        validArguments: [],
        discardedArguments: [],
      },
      {
        clusterId: 'cluster-6',
        finalStatus: 'LIKELY',
        severity: 'medium',
        severityReason: 'Left at the reported severity.',
        judge: { reviewerId: 'rules', vendor: 'rules', alternate: false },
        rationale: 'LIKELY from verified citations only (judge_threshold: judge threshold reached).',
        validArguments: [],
        discardedArguments: [],
      },
    ]);

    // Real trace.jsonl frames written by debate-rounds.mjs, debate-judge.mjs, and debate-run.mjs
    fs.mkdirSync(path.join(dir, 'debate'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'debate', 'trace.jsonl'),
      [
        JSON.stringify({ phase: 'debate', template: 'challenge', clusterId: 'cluster-1', round: 1, anonId: 'Reviewer A', stop: 'missing', reason: 'debate_turn_timeout' }),
        JSON.stringify({ phase: 'debate', template: 'defend', clusterId: 'cluster-2', round: 2, anonId: 'Reviewer B', stop: 'missing', reason: 'session_failed' }),
        JSON.stringify({ phase: 'debate', template: 'rebut', clusterId: 'cluster-3', round: 3, anonId: 'Reviewer A', stop: 'missing', reason: 'speaker_threshold' }),
        JSON.stringify({ phase: 'debate', template: 'skip', clusterId: 'cluster-5', stop: 'debate_time' }),
        JSON.stringify({ phase: 'adjudicate', template: 'judge-retry', clusterId: 'cluster-2', judge: 'grok', previous: 'claude', stop: 'unavailable' }),
        JSON.stringify({ phase: 'adjudicate', template: 'rules', clusterId: 'cluster-6', stop: 'LIKELY', reason: 'judge_threshold' }),
      ].join('\n') + '\n',
    );

    const meta = {
      pipelineMode: 'full',
      debatesCompleted: true,
      agents: ['claude', 'codex', 'grok', 'deepseek'],
      reviewers: [
        { id: 'claude', family: 'cli', vendor: 'anthropic', model: 'opus' },
        { id: 'codex', family: 'cli', vendor: 'openai', model: 'gpt-5' },
        { id: 'grok', family: 'cli', vendor: 'xai', model: 'grok-4' },
        { id: 'deepseek', family: 'nearai', vendor: 'deepseek', model: 'deepseek-ai/DeepSeek-V4' },
      ],
      workerExits: { 'claude-s1': 124, 'grok-s4': 1, 'deepseek-s5': 1, 'codex-s2': 0 },
      crosscheckExits: { grok: 1 },
      stageFailures: [
        'auditor_error:claude-s1',
        'auditor_error:deepseek-s5',
        'crosscheck_error:grok',
        'phase_failed:adjudicate:debate_incomplete: 3 turn(s) or judgement(s) had no answer (debate_turn_timeout, session_failed, judge_unavailable)',
        'phase_failed:general-review:general_review_unavailable: debate_turn_timeout',
      ],
    };
    const health = {
      complete: false,
      expected: ['claude-s1', 'grok-s4', 'deepseek-s5', 'codex-s2'],
      accepted: [],
      errors: [
        'One or more review stages failed.',
        'BUDGET: codex: budget_exhausted_without_submission',
        'SOURCE_DIGEST_MISMATCH: file changed',
      ],
      verification: { gaps: ['Foundry tests skipped: forge is not installed in the offline sandbox.'] },
    };

    const notes = buildIncompletionNotes(dir, { meta, health });
    assert.ok(notes.length >= 13, `expected >= 13 detailed notes, got ${notes.length}`);

    for (const note of notes) {
      assert.ok(typeof note.category === 'string' && note.category.length > 0);
      assert.ok(typeof note.code === 'string' && note.code.length > 0);
      assert.ok(typeof note.source === 'string' && note.source.length > 0);
      assert.ok(typeof note.reason === 'string' && note.reason.length > 10);
      assert.ok(typeof note.impact === 'string' && note.impact.length > 10);
      assert.ok(typeof note.nextStep === 'string' && note.nextStep.length > 5);
      // Never leak raw host report directory path
      assert.equal(note.reason.includes(dir), false, `leaked host path in reason: ${note.reason}`);
      assert.equal(note.impact.includes(dir), false, `leaked host path in impact: ${note.impact}`);
      assert.equal(note.nextStep.includes(dir), false, `leaked host path in nextStep: ${note.nextStep}`);
    }

    const byCode = new Map(notes.map((n) => [n.code, n]));
    assert.equal(byCode.get('worker_timeout')?.category, 'timeout');
    assert.equal(byCode.get('worker_usage_limit')?.category, 'usage_limit');
    assert.equal(byCode.get('worker_cost_ceiling')?.category, 'budget_exhausted');
    assert.equal(byCode.get('max_cost_usd_reached')?.category, 'budget_exhausted');
    assert.equal(byCode.get('budget_restored_prior_pass')?.category, 'budget_exhausted');
    assert.equal(byCode.get('budget_exhausted_without_submission')?.category, 'budget_exhausted');
    assert.equal(byCode.get('budget_exhausted_without_submission')?.source, 'codex');
    assert.equal(byCode.get('crosscheck_crosscheck_failed')?.category, 'crosscheck_gap');
    assert.equal(byCode.get('debate_turn_timeout')?.category, 'timeout');
    assert.equal(byCode.get('debate_turn_unanswered')?.category, 'debate_arguing');
    assert.equal(byCode.get('speaker_threshold')?.category, 'debate_arguing');
    assert.equal(byCode.get('judge_unavailable')?.category, 'debate_arguing');
    assert.equal(byCode.get('judge_threshold')?.category, 'debate_arguing');
    assert.equal(byCode.get('debate_cluster_cap')?.category, 'debate_arguing');
    assert.equal(byCode.get('debate_phase_timeout')?.category, 'timeout');
    assert.equal(byCode.get('debate_incomplete')?.category, 'debate_arguing');
    assert.equal(byCode.get('general_review_unavailable')?.category, 'stage_failure');
    assert.equal(byCode.get('verification_coverage_gap')?.category, 'sandbox_verification');
    assert.equal(byCode.get('source_digest_mismatch')?.category, 'sandbox_verification');

    // No duplicate health_contract_error for BUDGET: codex: budget_exhausted_without_submission
    assert.equal(notes.some((n) => n.code === 'health_contract_error'), false);
    assert.ok(notes.some((n) => n.nextStep.includes('<report-dir>')));

    // Validate against schema via rulesStageAdvice + pipeline-progress style check
    const advice = rulesStageAdvice({ clusters: [], incompletionNotes: notes, reviewers: meta.reviewers });
    assert.equal(JSON.stringify(advice).includes(dir), false);
    const check = validate('orchestrator-advice', advice);
    assert.equal(check.ok, true, check.errors?.join('; '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildIncompletionNotes end-to-end against real debateStage + adjudicateStage + generalReviewStage failure outputs', async () => {
  const dir = makeTempDir();
  const srcDir = makeTempDir();
  try {
    fs.writeFileSync(path.join(srcDir, 'vault.rs'), 'pub fn withdraw(amount: u64) {\n  unsafe_transfer(amount);\n}\n');
    const reader = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');
    const reviewers = [
      { id: 'claude', family: 'cli', vendor: 'anthropic', model: 'opus' },
      { id: 'codex', family: 'cli', vendor: 'openai', model: 'gpt-5' },
      { id: 'grok', family: 'cli', vendor: 'xai', model: 'grok-4' },
      { id: 'qwen', family: 'nearai', vendor: 'alibaba', model: 'Qwen/Qwen3.8-Max' },
    ];
    const claims = [
      {
        auditor: 'claude-s1', reviewerId: 'claude', vendor: 'anthropic', model: 'opus', surface: 'S1',
        title: 'Unchecked withdraw', severity: 'high', category: 'access-control',
        description: 'No caller guard', impact: 'Drain funds', recommendation: 'Check caller',
        files: ['vault.rs'],
        evidence: [{ file: 'vault.rs', startLine: 1, endLine: 2, quote: 'pub fn withdraw(amount: u64) {' }],
      },
    ];
    const voices = new Map([
      ['claude', async () => ({ unavailable: 'session_failed' })],
      ['codex', async () => ({ unavailable: 'debate_turn_timeout' })],
      ['grok', async () => ({ unavailable: 'invalid_turn' })],
      ['qwen', async () => ({ unavailable: 'invalid_turn' })],
    ]);
    const vendors = new Map(reviewers.map((r) => [r.id, r.vendor]));
    const plan = {
      out: dir,
      claims,
      reader,
      reviewers,
      voices,
      vendors,
      orchestrator: reviewers[2],
      alternate: reviewers[1],
      rounds: 1,
      concurrency: 2,
      turnMs: 500,
      phaseMs: 5000,
      scope: ['S1'],
      failedSurfaces: new Set(),
      partialSurfaces: new Set(),
      usage: new Map(),
      methodology: { reviewers: ['claude', 'codex', 'grok'], orchestrator: 'grok', passes: 1, toolBudget: 10, debateRounds: 1 },
      judgeVoice: () => async () => ({ unavailable: 'debate_turn_timeout' }),
      summaryVoice: async () => ({ unavailable: 'debate_turn_timeout' }),
    };

    const stageFailures = [];
    const debated = await debateStage(plan);
    const adjudicated = await adjudicateStage(plan, debated);
    if (adjudicated.missing.length) {
      const err = missingAnswersError(adjudicated.missing);
      stageFailures.push(`phase_failed:adjudicate:${err.message}`);
    }
    await assert.rejects(
      () => generalReviewStage(plan, adjudicated),
      (err) => {
        stageFailures.push(`phase_failed:general-review:${err.message}`);
        return err.code === 'general_review_unavailable';
      },
    );

    const notes = buildIncompletionNotes(dir, {
      meta: { pipelineMode: 'full', debatesCompleted: true, reviewers, stageFailures, workerExits: {}, crosscheckExits: {} },
      health: { complete: false, expected: [], accepted: [], errors: ['One or more review stages failed.'], verification: { gaps: [] } },
    });

    const codes = new Set(notes.map((n) => n.code));
    assert.ok(codes.has('debate_turn_timeout'), 'detects real debate_turn_timeout trace');
    assert.ok(codes.has('debate_turn_unanswered'), 'detects real invalid_turn trace');
    assert.ok(codes.has('judge_unavailable'), 'detects real judge_unavailable adjudication');
    assert.ok(codes.has('debate_incomplete'), 'parses phase_failed:adjudicate:debate_incomplete');
    assert.ok(codes.has('general_review_unavailable'), 'parses phase_failed:general-review:general_review_unavailable');
    assert.equal(JSON.stringify(notes).includes(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  }
});

test('buildIncompletionNotes preserves multiple distinct verification.gaps, multiple health_contract_error rows, and auditor_incomplete stageFailures', () => {
  const dir = makeTempDir();
  try {
    const notes = buildIncompletionNotes(dir, {
      meta: {
        pipelineMode: 'stage-1',
        debatesCompleted: false,
        agents: ['claude'],
        workerExits: {},
        crosscheckExits: {},
        stageFailures: ['auditor_incomplete:claude-s1-auth'],
      },
      health: {
        complete: false,
        expected: [],
        accepted: [],
        errors: [
          'Sandbox coverage file harness/sandbox.md is missing.',
          'Scanner gitleaks did not run cleanly (blocked): Executable unavailable',
          'Scanner semgrep did not run cleanly (blocked): Executable unavailable',
        ],
        verification: {
          gaps: [
            'Foundry tests skipped: forge is not installed in the offline sandbox.',
            'NEAR contract cargo test skipped offline: near-workspaces requires local node.',
          ],
        },
      },
    });

    const gapNotes = notes.filter((n) => n.code === 'verification_coverage_gap');
    assert.equal(gapNotes.length, 2, 'must preserve every distinct verification.gaps item instead of colliding on seenKeys');

    const contractNotes = notes.filter((n) => n.code === 'health_contract_error');
    assert.equal(contractNotes.length, 3, 'must preserve every distinct health.errors item');

    const incompleteJobNote = notes.find((n) => n.code === 'auditor_incomplete');
    assert.ok(incompleteJobNote, 'must emit note for auditor_incomplete:<job> when workerExits did not already cover it');
    assert.equal(incompleteJobNote.source, 'claude-s1-auth');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a run cancelled before review explains the cancel once, not one provider_error per never-started session', () => {
  const dir = makeTempDir();
  try {
    const reviewers = [
      { id: 'cli-claude-opus', family: 'cli', vendor: 'anthropic', model: 'opus' },
      { id: 'cli-codex-gpt-6-1-sol', family: 'cli', vendor: 'openai', model: 'gpt-6.1-sol' },
    ];
    const jobs = reviewers.flatMap((r) => ['s1-auth', 's2-input'].map((s) => ({ name: `${r.id}-${s}`, adapter: r.id, state: 'pending' })));
    writeJson(dir, 'workers.json', { version: 1, jobs });
    const meta = {
      reviewers, agents: reviewers.map((r) => r.id), finalized: true,
      workerExits: Object.fromEntries(jobs.map((j) => [j.name, null])),
      stageFailures: ['run_cancelled:prepare'],
    };
    const errors = [...jobs.map((j) => `${j.name}: missing or invalid outputs (ENOENT). Worker exit status is missing; successful completion is unverified.`), 'One or more review stages failed.'];
    const notes = buildIncompletionNotes(dir, { meta, health: { expected: jobs.map((j) => j.name), accepted: [], errors } });
    assert.deepEqual(notes.map((n) => n.code).sort(), ['review_not_started_cancelled', 'run_cancelled'], 'the missing outputs of never-started sessions are covered by the one note');
    assert.equal(notes.filter((n) => n.category === 'provider_error').length, 0, 'no provider is blamed for a session that never started');
    const notStarted = notes.find((n) => n.code === 'review_not_started_cancelled');
    assert.ok(notStarted);
    assert.match(notStarted.reason, /^4 reviewer session\(s\) never started because the run was cancelled during the Preparing sandbox phase \(reviewers: cli-claude-opus, cli-codex-gpt-6-1-sol\)/);
    assert.match(notes.find((n) => n.code === 'run_cancelled').reason, /cancelled \(Ctrl-C or SIGTERM\) during the Preparing sandbox phase/);

    // A job that did start and ended without an exit is still reported per job.
    writeJson(dir, 'workers.json', { version: 1, jobs: jobs.map((j, i) => (i ? j : { ...j, state: 'running' })) });
    const mixed = buildIncompletionNotes(dir, { meta: { ...meta, stageFailures: ['sandbox_unavailable'] }, health: { expected: [], accepted: [], errors: [] } });
    assert.ok(mixed.some((n) => n.source === jobs[0].name));
    assert.match(mixed.find((n) => n.code === 'review_not_started').reason, /^3 reviewer session\(s\) never started because the review sandbox failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
