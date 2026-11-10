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
      for (const step of this.#steps(input.outDir)) {
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

  #steps(out: string): Array<() => number | void> {
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
