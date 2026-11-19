// Full-sandbox build checks (not review mode): locked cargo build/test and build.sh/test.sh.
import path from 'node:path';
import { safeRel } from './sandbox-lib.mjs';
import { CARGO_ENV, OPENSSL_NOTE, brief, dirOf, log, run } from './sandbox-inside-exec.mjs';
import { put, timeLeft } from './sandbox-inside-state.mjs';

export async function cargoLocked(id, args, rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    if (timeLeft() < 20_000) { worst = 'impossible'; bits.push(`${rel} skipped at the time limit`); break; }
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('cargo', args, { cwd, timeoutMs: 15 * 60 * 1000, env: CARGO_ENV });
    log(id, res);
    if (res.code !== 0) worst = 'failed';
    bits.push(`${rel} ${brief(res)}`);
  }
  if (worst === 'ran') bits.push(OPENSSL_NOTE);
  put(id, worst === 'ran' ? 'ran' : worst, bits.join('; '));
}

export async function scripts(id, rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    if (timeLeft() < 20_000) { worst = 'impossible'; bits.push(`${rel} skipped at the time limit`); break; }
    const cwd = dirOf(path.posix.dirname(rel));
    const file = path.join('/work/src', rel);
    if (!cwd || !safeRel(rel)) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('bash', [file], { cwd, timeoutMs: 15 * 60 * 1000, env: CARGO_ENV });
    log(id, res);
    if (res.code !== 0) worst = 'failed';
    bits.push(`${rel} ${brief(res)}`);
  }
  put(id, worst, bits.join('; '));
}

