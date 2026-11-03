// MockEngineRunner (ENGINE_RUNNER=mock, test and local demo only): writes the recorded report tree in
// test/fixtures/engine-report into the out dir in the order the engine does, one step every
// MOCK_ENGINE_STEP_MS, so the progress tailer, classifier and publisher see a real report shape.
// MOCK_ENGINE_FAIL: infra (sandbox lost), findings (critical findings), crash (no report), operator (no binary).
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
    return [
      () => meta({ finalized: false }),
      () => { copy('workers.json'); copy('sessions/scripted-baseline.jsonl'); copy('harness/sandbox-run/out.txt'); },
      () => {
        if (fail === 'infra') { meta({ finalized: true, stageFailures: ['sandbox_unavailable'] }); return 1; }
        if (fail === 'crash') return 1;
        copy('reviewers/index.json'); copy('reviewers/scripted-baseline/usage.json');
      },
      () => copy('debate/round-1.json'),
      () => {
        copy('findings-and-scores.json', variant('findings-and-scores.json'));
        copy('general-review.json', variant('general-review.json'));
        copy('report-health.json'); copy('report.html');
      },
      () => meta({ finalized: true }),
    ];
  }
}
