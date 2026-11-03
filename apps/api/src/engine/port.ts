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
}

export interface EngineRunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** The worker asked the run to stop (shutdown or the request was refunded meanwhile). */
  aborted: boolean;
  /** The process could not be started at all (ENOENT, EACCES): an operator problem, not a review outcome. */
  spawnError: string | null;
  durationMs: number;
}

export interface EngineRunner {
  readonly kind: 'cli' | 'mock';
  run(input: EngineRunInput, signal: AbortSignal): Promise<EngineRunResult>;
}
