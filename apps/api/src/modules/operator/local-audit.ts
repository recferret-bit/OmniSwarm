// Local operator argv. Not the hosted worker: that line stays in engine/cli/argv.ts.
// Values are checked before spawn; the child gets PATH, HOME, LANG and TMPDIR only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../shared/errors.ts';
import { repo as repoSchema } from '../../shared/patterns.ts';
import { ensureReportPdf } from '../../shared/report-pdf.ts';

const SHA = /^[0-9a-f]{40}$/;
const ENV_KEYS = ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const;

export interface LocalLaunch {
  id: string;
  kind: 'path' | 'github';
  /** `[bin/audit, ...localAuditArgv]`. */
  argv: string[];
  outDir: string;
  cwd: string;
  engineRoot: string;
  mark(status: 'running' | 'done' | 'failed', error?: string | null): Promise<void>;
}

export function localAuditEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}

/** Absolute, no `..` segment before or after normalize, and not a flag. Does not touch the filesystem. */
export function assertNormalizedAbsolute(filePath: string): string {
  if (!filePath || filePath.startsWith('-') || /[\0\r\n]/.test(filePath) || filePath.split(/[/\\]/).includes('..')) {
    fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  }
  const normalized = path.normalize(filePath);
  if (normalized.split(/[/\\]/).includes('..')) fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  if (!path.isAbsolute(filePath)) fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved) || resolved.startsWith('-') || resolved.split(path.sep).includes('..')) {
    fail('VALIDATION_ERROR', 'Path is not an absolute directory');
  }
  return resolved;
}

function assertFlags(argv: string[], flags: readonly string[]): void {
  const seen = argv.filter((arg) => arg.startsWith('-'));
  if (seen.join(' ') !== flags.join(' ') || argv.includes('--rpc')) fail('VALIDATION_ERROR', 'Review arguments were rejected');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith('-')) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) fail('VALIDATION_ERROR', 'Review arguments were rejected');
    }
  }
}

export function localAuditArgv(input: { kind: 'path'; target: string; outDir: string } | { kind: 'github'; repo: string; ref: string; outDir: string }): string[] {
  const outDir = assertNormalizedAbsolute(input.outDir);
  if (input.kind === 'path') {
    const target = assertNormalizedAbsolute(input.target);
    const argv = ['run', '--repo', target, '--reviewers', 'scripted:baseline', '--passes', '1', '--tool-budget', '10', '--out', outDir];
    assertFlags(argv, ['--repo', '--reviewers', '--passes', '--tool-budget', '--out']);
    return argv;
  }
  if (!repoSchema.safeParse(input.repo).success || !SHA.test(input.ref)) fail('VALIDATION_ERROR', 'Review arguments were rejected');
  const argv = ['run', '--github', input.repo, '--ref', input.ref, '--reviewers', 'scripted:baseline', '--passes', '1', '--tool-budget', '10', '--out', outDir];
  assertFlags(argv, ['--github', '--ref', '--reviewers', '--passes', '--tool-budget', '--out']);
  return argv;
}

export function localAuditCommand(engineRoot: string, args: string[]): string[] {
  return [path.join(engineRoot, 'bin/audit'), ...args];
}

/** report.html => done (exit 2 is an incomplete review that still has a report). Non-zero without it is failed. */
export function localExitStatus(code: number | null, hasReport: boolean): { status: 'done' | 'failed'; error: string | null } {
  if (hasReport) return { status: 'done', error: null };
  if (code === 0) return { status: 'failed', error: 'audit exited without a report' };
  return { status: 'failed', error: `audit exited ${code ?? 'null'}` };
}

/** Default starter: spawn and return. The exit handler updates the row. */
export function spawnLocalAudit(launch: LocalLaunch): void {
  void run(launch).catch(() => {});
}

async function run(launch: LocalLaunch): Promise<void> {
  await launch.mark('running');
  const bin = launch.argv[0];
  if (!bin) {
    await launch.mark('failed', 'audit failed to start');
    return;
  }
  let settled = false;
  const finish = (status: 'done' | 'failed', error: string | null) => {
    if (settled) return;
    settled = true;
    void launch.mark(status, error);
  };
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(bin, launch.argv.slice(1), { cwd: launch.cwd, shell: false, env: localAuditEnv(), stdio: 'ignore' });
  } catch {
    finish('failed', 'audit failed to start');
    return;
  }
  child.on('error', () => finish('failed', 'audit failed to start'));
  child.on('exit', (code) => {
    const hasReport = fs.existsSync(path.join(launch.outDir, 'report.html'));
    if (hasReport) {
      try { ensureReportPdf(launch.outDir, launch.engineRoot); } catch { /* stub write is best-effort */ }
    }
    const outcome = localExitStatus(code, hasReport);
    finish(outcome.status, outcome.error);
  });
}

let starter: (launch: LocalLaunch) => void = spawnLocalAudit;

/** Tests pass a double that records argv. `null` restores the real spawn. */
export function setLocalJobStarter(next: ((launch: LocalLaunch) => void) | null): void {
  starter = next ?? spawnLocalAudit;
}

export function launchLocalJob(launch: LocalLaunch): void {
  starter(launch);
}
