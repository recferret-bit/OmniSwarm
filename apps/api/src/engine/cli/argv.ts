// The only command line the intake service ever gives the engine (AGENTS.md "Tracks and
// boundaries"): `./bin/audit run --github <owner>/<repo> --ref <sha> --preset <preset> --out <dir>`.
// Every value is checked against a positive pattern first, so no field can carry a flag.
import path from 'node:path';
import type { EngineRunInput } from '../port.ts';

export const AUDIT_BIN = './bin/audit';
export const AUDIT_FLAGS = ['--github', '--ref', '--preset', '--out'] as const;

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const PRESET = /^[a-z0-9-]{1,40}$/;
const OUT = /^\/[A-Za-z0-9._/-]{1,1000}$/;

export class ArgvError extends Error {
  override name = 'ArgvError';
}

export function auditArgv(input: Pick<EngineRunInput, 'repo' | 'commitSha' | 'preset' | 'outDir'>): string[] {
  if (!REPO.test(input.repo) || input.repo.startsWith('-')) throw new ArgvError('repo is not owner/name');
  if (!SHA.test(input.commitSha)) throw new ArgvError('ref is not a 40-hex commit');
  if (!PRESET.test(input.preset)) throw new ArgvError('preset is not an allow-listed name');
  if (!OUT.test(input.outDir) || path.normalize(input.outDir) !== input.outDir) throw new ArgvError('out dir is not a normalized absolute path');
  const argv = ['run', '--github', input.repo, '--ref', input.commitSha, '--preset', input.preset, '--out', input.outDir];
  const flags = argv.filter((arg) => arg.startsWith('-'));
  if (flags.join(' ') !== AUDIT_FLAGS.join(' ')) throw new ArgvError('argv carries a flag outside the allow-list');
  return argv;
}
