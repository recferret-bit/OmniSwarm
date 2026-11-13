// The review engine as a black box. The worker hands it validated job fields and a fresh, empty
// out dir; the runner only reports how the process ended. What the run produced is read from the
// out dir by worker/classify.ts, the same way for every runner.

export interface EngineRunInput {
  repo: string;
  commitSha: string;
  preset: string;
  /** Absolute, fresh per attempt; the engine refuses a non-empty --out. */
  outDir: string;
  /** Host-only log of the engine's stdout and stderr (never published). */
  logPath: string;
  /** Already-checked-out slice. When set, the engine reviews this directory instead of cloning `repo`. */
  sourceDir?: string;
  /** Per-job run config (an account job's models) the engine reads instead of the repo omniswarm.config.json. */
  configFile?: string;
  /** Provider key variables (provider catalog envAllowlist names) for this spawn only. */
  providerEnv?: Record<string, string>;
  /**
   * The provider variables this job's reviewers may use (from its specs). When set, every other catalog
   * provider variable is removed from the spawn, so an account job never carries an operator key and a
   * hosted-preset job never carries a provider it does not run.
   */
  providerScope?: string[];
  /** Pipeline execution mode for initial reviews (`full`, `step-by-step`, or `stage-1`). */
  pipelineMode?: 'full' | 'step-by-step' | 'stage-1';
  /** When set on a follow-up request, runs N additional iterative debate rounds on `outDir` (seeded from parent). */
  debateRounds?: number;
}

export interface EngineRunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** The worker asked the run to stop (shutdown). */
  aborted: boolean;
  /** The process could not be started at all (ENOENT, EACCES): an operator problem, not a review outcome. */
  spawnError: string | null;
  durationMs: number;
}

export interface EngineRunner {
  readonly kind: 'cli' | 'mock';
  run(input: EngineRunInput, signal: AbortSignal): Promise<EngineRunResult>;
}
