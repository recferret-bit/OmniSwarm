// The only command line the intake service ever gives the engine (AGENTS.md "Tracks and
// boundaries"): `./bin/audit run --github <owner>/<repo> --ref <sha> --preset <preset> --out <dir>`.
// Every value is checked against a positive pattern first, so no field can carry a flag.
import path from 'node:path';
import type { EngineRunInput } from '../port.ts';

/** Resolved against ENGINE_ROOT (the repository root), which is also the child's cwd. */
export const AUDIT_BIN = 'bin/audit';
export const AUDIT_FLAGS = ['--github', '--ref', '--preset', '--out'] as const;

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const PRESET = /^[a-z0-9-]{1,40}$/;
const OUT = /^\/[A-Za-z0-9._/-]{1,1000}$/;

export class ArgvError extends Error {
  override name = 'ArgvError';
}

function assertOut(outDir: string): void {
  if (!OUT.test(outDir) || path.normalize(outDir) !== outDir) throw new ArgvError('out dir is not a normalized absolute path');
}

export function auditArgv(input: Pick<EngineRunInput, 'repo' | 'commitSha' | 'preset' | 'outDir' | 'sourceDir'>): string[] {
  if (!PRESET.test(input.preset)) throw new ArgvError('preset is not an allow-listed name');
  assertOut(input.outDir);
  const argv = input.sourceDir
    ? ['run', '--repo', input.sourceDir, '--preset', input.preset, '--out', input.outDir]
    : ['run', '--github', input.repo, '--ref', input.commitSha, '--preset', input.preset, '--out', input.outDir];
  if (input.sourceDir) assertOut(input.sourceDir);
  else {
    if (!REPO.test(input.repo) || input.repo.startsWith('-')) throw new ArgvError('repo is not owner/name');
    if (!SHA.test(input.commitSha)) throw new ArgvError('ref is not a 40-hex commit');
  }
  const allowed = input.sourceDir ? '--repo --preset --out' : AUDIT_FLAGS.join(' ');
  const flags = argv.filter((arg) => arg.startsWith('-'));
  if (flags.join(' ') !== allowed) throw new ArgvError('argv carries a flag outside the allow-list');
  return argv;
}
