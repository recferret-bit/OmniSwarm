// CliEngineRunner: spawns $ENGINE_ROOT/bin/audit with cwd ENGINE_ROOT with an argv array (no shell) and an
// allow-listed environment, drains its output into a capped host-only log, and on timeout or abort
// sends SIGTERM to the whole process group, then SIGKILL after a grace period.
import { spawn } from 'node:child_process';
import path from 'node:path';
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
      // An absolute $ENGINE_ROOT/bin/audit: the worker's own cwd (apps/api) never decides what runs.
      const bin = path.join(this.#options.root, AUDIT_BIN);
      const env = { ...this.#options.env };
      if (input.configFile) env.OMNI_RUN_CONFIG = input.configFile;
      for (const [name, value] of Object.entries(input.providerEnv ?? {})) {
        if ((name === 'ZAI_API_KEY' || name === 'OPENROUTER_API_KEY' || name === 'ZAI_BASE_URL') && value) env[name] = value;
      }
      const child = spawn(bin, argv, {
        cwd: this.#options.root, shell: false, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      log.note(`spawned pid ${child.pid ?? '-'}: ${bin} ${argv.join(' ')}`);
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
