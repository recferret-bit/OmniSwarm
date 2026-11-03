// CliEngineRunner: spawns ./bin/audit from the repository root with an argv array (no shell) and an
// allow-listed environment, drains its output into a capped host-only log, and on timeout or abort
// sends SIGTERM to the whole process group, then SIGKILL after a grace period.
import { spawn } from 'node:child_process';
import type { EngineRunInput, EngineRunResult, EngineRunner } from '../port.ts';
import { AUDIT_BIN, auditArgv } from './argv.ts';
import { CappedLog } from './log-sink.ts';

export interface CliRunnerOptions {
  root: string;
  env: Record<string, string>;
  timeoutS: number;
  killGraceS: number;
  logMaxBytes: number;
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

export class CliEngineRunner implements EngineRunner {
  readonly kind = 'cli';
  readonly #options: CliRunnerOptions;

  constructor(options: CliRunnerOptions) {
    this.#options = options;
  }

  run(input: EngineRunInput, signal: AbortSignal): Promise<EngineRunResult> {
    const argv = auditArgv(input);
    const log = new CappedLog(input.logPath, this.#options.logMaxBytes);
    const started = Date.now();
    return new Promise((resolve) => {
      let timedOut = false;
      let aborted = false;
      let killTimer: NodeJS.Timeout | undefined;
      const child = spawn(AUDIT_BIN, argv, {
        cwd: this.#options.root, shell: false, env: this.#options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      log.note(`spawned pid ${child.pid ?? '-'}: ${AUDIT_BIN} ${argv.join(' ')}`);
      log.drain(child.stdout);
      log.drain(child.stderr);
      const stop = (why: 'timeout' | 'abort') => {
        if (timedOut || aborted || child.exitCode !== null) return;
        if (why === 'timeout') timedOut = true; else aborted = true;
        log.note(`${why}: SIGTERM to process group`);
        killGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), this.#options.killGraceS * 1000);
      };
      const timer = setTimeout(() => stop('timeout'), this.#options.timeoutS * 1000);
      const onAbort = () => stop('abort');
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      let finished = false;
      const finish = (result: Omit<EngineRunResult, 'durationMs' | 'timedOut' | 'aborted'>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal.removeEventListener('abort', onAbort);
        // A stopped leader may leave children (docker clients) in its group.
        if (timedOut || aborted) killGroup(child.pid, 'SIGKILL');
        log.note(`exit code=${result.exitCode} signal=${result.signal} spawnError=${result.spawnError}`);
        log.close();
        resolve({ ...result, timedOut, aborted, durationMs: Date.now() - started });
      };
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (child.pid === undefined) finish({ exitCode: null, signal: null, spawnError: error.code ?? 'SPAWN_FAILED' });
      });
      child.once('close', (exitCode, exitSignal) => finish({ exitCode, signal: exitSignal, spawnError: null }));
    });
  }
}
