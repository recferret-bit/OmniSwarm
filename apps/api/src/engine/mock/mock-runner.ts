// MockEngineRunner (ENGINE_RUNNER=mock, test and local demo only): writes the recorded report tree in
// test/fixtures/engine-report into the out dir in the order the engine does, one step every
// MOCK_ENGINE_STEP_MS, so the progress tailer, classifier and publisher see a real report shape.
// MOCK_ENGINE_FAIL: infra (sandbox lost), findings (critical findings), crash (no report), operator (no binary).
// Each step also writes the live progress snapshot the real engine writes (harness/host/progress.json), so the
// tailer and the web pages show phases, reviewer passes and calls on the local stack too.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { EngineRunInput, EngineRunResult, EngineRunner } from '../port.ts';

export interface MockRunnerOptions {
  fixtureDir: string;
  stepMs: number;
  fail: 'infra' | 'findings' | 'crash' | 'operator' | null;
}

const RESULT = { signal: null, timedOut: false, aborted: false, spawnError: null } as const;
const MOCK_PHASES = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'];
const MOCK_PERCENT: Record<string, number> = { prepare: 2, review: 40, debate: 83, adjudicate: 91, report: 98 };

export class MockEngineRunner implements EngineRunner {
  readonly kind = 'mock';
  readonly #options: MockRunnerOptions;

  constructor(options: MockRunnerOptions) {
    this.#options = options;
  }

  async run(input: EngineRunInput, signal: AbortSignal): Promise<EngineRunResult> {
    const started = Date.now();
    const done = (exitCode: number | null, extra: Partial<EngineRunResult> = {}): EngineRunResult =>
      ({ ...RESULT, exitCode, durationMs: Date.now() - started, ...extra });
    if (this.#options.fail === 'operator') return done(null, { spawnError: 'ENOENT' });
    fs.writeFileSync(input.logPath, `[mock-engine] ${input.repo}@${input.commitSha} preset=${input.preset}\n`, { mode: 0o600 });
    fs.mkdirSync(input.outDir, { recursive: true });
    try {
      for (const step of this.#steps(input.outDir, input.pipelineMode ?? 'full', input.debateRounds)) {
        await sleep(this.#options.stepMs, undefined, { signal });
        const exitCode = step();
        if (exitCode !== undefined) return done(exitCode);
      }
    } catch (error) {
      if (signal.aborted) return done(null, { aborted: true, signal: 'SIGTERM' });
      throw error;
    }
    return done(0);
  }

  #steps(
    out: string,
    pipelineMode: 'full' | 'step-by-step' | 'stage-1' = 'full',
    debateRounds?: number,
  ): Array<() => number | void> {
    const fixture = this.#options.fixtureDir;
    const fail = this.#options.fail;
    const copy = (rel: string, from = rel) => {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.copyFileSync(path.join(fixture, from), path.join(out, rel));
    };
    const meta = (patch: object) => {
      const base = JSON.parse(fs.readFileSync(path.join(fixture, 'meta.json'), 'utf8'));
      fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ ...base, ...patch }, null, 2));
    };
    const variant = (rel: string) => (fail === 'findings' ? `variants/findings/${rel}` : rel);
    const started = Date.now();
    const progress = (state: string, done: string[], running: string | null, extra: object = {}, reviewer: object = {}) => {
      const now = Date.now();
      const phases = MOCK_PHASES.map((name) => ({ name, state: done.includes(name) ? 'done' : name === running ? 'running' : state === 'running' ? 'pending' : 'skipped' }));
      if (state === 'failed' && running) phases[MOCK_PHASES.indexOf(running)]!.state = 'failed';
      const snapshot = {
        version: 1, state, phase: running ?? 'report', startedAt: new Date(started).toISOString(), updatedAt: new Date(now).toISOString(), elapsedMs: now - started,
        percent: state === 'finished' ? 100 : MOCK_PERCENT[running ?? 'report'] ?? 0, phases,
        reviewers: [{ id: 'scripted-baseline', state: 'pending', jobsDone: 0, jobs: 1, passes: 1, ...reviewer }], ...extra,
      };
      fs.mkdirSync(path.join(out, 'harness', 'host'), { recursive: true });
      fs.writeFileSync(path.join(out, 'harness', 'host', 'progress.json'), JSON.stringify(snapshot));
    };
    const reviewing = { state: 'running', pass: 1, calls: 6, budget: 10, surface: 'S1' };
    const reviewed = { state: 'done', jobsDone: 1 };

    const writeMockPipeline = (completedRounds: number, noDebates: boolean, withAdvice: boolean) => {
      const nowIso = new Date().toISOString();
      const findings = JSON.parse(fs.readFileSync(path.join(out, 'findings-and-scores.json'), 'utf8'));
      if (!fs.existsSync(path.join(out, 'audit_stage_1.json'))) {
        fs.writeFileSync(path.join(out, 'audit_stage_1.json'), JSON.stringify({
          version: 1,
          stage: 'stage-1',
          label: 'STAGE 1 — NO DEBATES',
          noDebates: true,
          generatedAt: nowIso,
          findings,
        }, null, 2));
        fs.writeFileSync(path.join(out, 'audit_stage_1.html'), fs.readFileSync(path.join(out, 'report.html'), 'utf8'));
      }
      if (withAdvice && !fs.existsSync(path.join(out, 'orchestrator-advice.json'))) {
        const advice = {
          stage: 'stage-2-advice',
          quality: {
            rating: 'adequate',
            summary: 'Multi-agent surface review completed with cited Stage 1 claims ready for optional debate.',
            coverageGaps: [],
            issues: [],
          },
          debateAdvice: {
            debateNeeded: true,
            recommendedDepth: 'standard',
            recommendedRounds: 2,
            focusClusterIds: ['cluster-1'],
            rationale: 'Cross-reviewer adversarial challenge and defense is recommended on high-severity claims.',
          },
          nextSteps: ['Run 1-2 debate rounds to verify disputed or single-source claims.'],
          generatedBy: {
            mode: 'rules_fallback',
            orchestrator: 'scripted:judge',
            fallbackReason: 'scripted_orchestrator',
          },
          disclaimer: 'Model agreement and passing checks do not certify security.',
        };
        fs.writeFileSync(path.join(out, 'orchestrator-advice.json'), JSON.stringify(advice, null, 2));
        fs.writeFileSync(path.join(out, 'audit_stage_2_advice.html'), `<!DOCTYPE html><html lang="en"><body><h1>Step 2 Frontier Orchestrator Advice</h1><p>${advice.quality.summary}</p></body></html>\n`);
      }
      for (let r = 1; r <= completedRounds; r += 1) {
        if (!fs.existsSync(path.join(out, `audit_round_${r}.json`))) {
          fs.writeFileSync(path.join(out, `audit_round_${r}.json`), JSON.stringify({
            version: 1,
            stage: 'stage-3-debate-round',
            round: r,
            generatedAt: nowIso,
            findings,
          }, null, 2));
          fs.writeFileSync(path.join(out, `audit_round_${r}.html`), fs.readFileSync(path.join(out, 'report.html'), 'utf8'));
        }
      }
      const currentStage = completedRounds > 0
        ? 'stage-3-debate'
        : withAdvice
          ? 'stage-2-advice'
          : 'stage-1';
      const completedSteps: string[] = ['stage-1'];
      if (withAdvice) completedSteps.push('stage-2-advice');
      if (completedRounds > 0) completedSteps.push('stage-3-debate');
      fs.writeFileSync(path.join(out, 'pipeline-progress.json'), JSON.stringify({
        version: 1,
        pipelineMode,
        currentStage,
        completedSteps,
        evidence: {
          stored: true,
          dir: 'evidence',
          claimsCount: Array.isArray(findings) ? findings.length : 0,
          clustersCount: 1,
          files: ['evidence/index.json', 'evidence/claims.json', 'evidence/clusters.json', 'evidence/controls.json'],
        },
        stage1: {
          completed: true,
          noDebates,
          artifacts: ['audit_stage_1.json', 'audit_stage_1.html'],
          findingsCount: Array.isArray(findings) ? findings.length : 0,
        },
        advice: withAdvice
          ? {
            debateNeeded: true,
            recommendedDepth: 'standard',
            recommendedRounds: 2,
            qualityRating: 'adequate',
            artifacts: ['orchestrator-advice.json', 'audit_stage_2_advice.html'],
          }
          : null,
        debate: {
          optional: true,
          roundsCompleted: completedRounds,
          queuedClusters: 1,
          unresolvedClusters: completedRounds > 0 ? 0 : 1,
          converged: false,
          canRunMoreRounds: completedRounds < 20,
          rounds: Array.from({ length: completedRounds }, (_, idx) => ({
            round: idx + 1,
            turnsCount: 2,
            unansweredTurns: 0,
            disputedCount: 0,
            artifacts: [`audit_round_${idx + 1}.json`, `audit_round_${idx + 1}.html`],
            completedAt: nowIso,
          })),
        },
        incompletionNotes: [],
        updatedAt: nowIso,
      }, null, 2));
    };

    // Iterative Step 2 Advice continuation on an already-seeded Stage 1 parent report directory
    if (debateRounds === 0 && fs.existsSync(path.join(out, 'pipeline-progress.json'))) {
      try { fs.rmSync(path.join(out, '.omni-continue-pipeline.json'), { force: true }); } catch { /* ignore */ }
      return [
        () => {
          progress('running', ['prepare', 'tests', 'review'], 'report', {}, reviewed);
        },
        () => {
          writeMockPipeline(0, true, true);
          meta({ finalized: true, pipelineMode: 'step-by-step', debatesCompleted: false });
          progress('finished', [...MOCK_PHASES], null, {}, reviewed);
        },
      ];
    }

    // Iterative debate continuation on an already-seeded parent report directory
    if (debateRounds && debateRounds > 0) {
      try { fs.rmSync(path.join(out, '.omni-continue-pipeline.json'), { force: true }); } catch { /* ignore */ }
      let priorRounds = 0;
      try {
        const existingProg = JSON.parse(fs.readFileSync(path.join(out, 'pipeline-progress.json'), 'utf8'));
        priorRounds = Number(existingProg?.debate?.roundsCompleted ?? existingProg?.debate?.completedRounds ?? 0) || 0;
      } catch { priorRounds = 0; }
      const targetRound = priorRounds + debateRounds;
      return [
        () => {
          progress('running', ['prepare', 'tests', 'review', 'crosscheck'], 'debate', { debate: { clusters: 2, heard: 1 } }, reviewed);
        },
        () => {
          copy('debate/round-1.json');
          copy('findings-and-scores.json', variant('findings-and-scores.json'));
          copy('general-review.json', variant('general-review.json'));
          copy('report-health.json');
          copy('report.html');
          writeMockPipeline(targetRound, false, true);
          meta({ finalized: true, pipelineMode: 'step-by-step', debatesCompleted: true });
          progress('finished', [...MOCK_PHASES], null, { debate: { clusters: 2, heard: 2, judged: 2, toJudge: 2 } }, reviewed);
        },
      ];
    }

    // Stage 1 only or Step-by-step initial pass (debates intentionally deferred)
    if (pipelineMode === 'stage-1' || pipelineMode === 'step-by-step') {
      const withAdvice = pipelineMode === 'step-by-step';
      return [
        () => { meta({ finalized: false, pipelineMode, debatesCompleted: false }); progress('running', [], 'prepare'); },
        () => { copy('workers.json'); copy('sessions/scripted-baseline.jsonl'); copy('harness/sandbox-run/out.txt'); progress('running', ['prepare', 'tests'], 'review', {}, reviewing); },
        () => {
          if (fail === 'infra') { meta({ finalized: true, stageFailures: ['sandbox_unavailable'] }); progress('failed', ['prepare', 'tests'], 'review', {}, reviewing); return 1; }
          if (fail === 'crash') return 1;
          copy('reviewers/index.json'); copy('reviewers/scripted-baseline/usage.json');
          copy('findings-and-scores.json', variant('findings-and-scores.json'));
          copy('report-health.json'); copy('report.html');
          writeMockPipeline(0, true, withAdvice);
          progress('running', ['prepare', 'tests', 'review'], 'report', {}, reviewed);
        },
        () => {
          meta({ finalized: true, pipelineMode, debatesCompleted: false });
          progress('finished', ['prepare', 'tests', 'review', 'report'], null, {}, reviewed);
        },
      ];
    }

    return [
      () => { meta({ finalized: false }); progress('running', [], 'prepare'); },
      () => { copy('workers.json'); copy('sessions/scripted-baseline.jsonl'); copy('harness/sandbox-run/out.txt'); progress('running', ['prepare', 'tests'], 'review', {}, reviewing); },
      () => {
        if (fail === 'infra') { meta({ finalized: true, stageFailures: ['sandbox_unavailable'] }); progress('failed', ['prepare', 'tests'], 'review', {}, reviewing); return 1; }
        if (fail === 'crash') return 1;
        copy('reviewers/index.json'); copy('reviewers/scripted-baseline/usage.json');
        progress('running', ['prepare', 'tests', 'review', 'crosscheck'], 'debate', { debate: { clusters: 2, heard: 1 } }, reviewed);
      },
      () => { copy('debate/round-1.json'); progress('running', ['prepare', 'tests', 'review', 'crosscheck', 'debate'], 'adjudicate', { debate: { clusters: 2, heard: 2, judged: 1, toJudge: 2 } }, reviewed); },
      () => {
        copy('findings-and-scores.json', variant('findings-and-scores.json'));
        copy('general-review.json', variant('general-review.json'));
        copy('report-health.json'); copy('report.html');
        progress('running', ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review'], 'report', { debate: { clusters: 2, heard: 2, judged: 2, toJudge: 2 } }, reviewed);
      },
      () => { meta({ finalized: true }); progress('finished', [...MOCK_PHASES], null, { debate: { clusters: 2, heard: 2, judged: 2, toJudge: 2 } }, reviewed); },
    ];
  }
}
