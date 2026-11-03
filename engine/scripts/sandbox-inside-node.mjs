// JavaScript dependency installs: npm/pnpm/yarn for the full sandbox, and the review-mode lockfile-only fetch.
import fs from 'node:fs';
import path from 'node:path';
import { brief, dirOf, log, run } from './sandbox-inside-exec.mjs';
import { installed, put, timeLeft } from './sandbox-inside-state.mjs';

export async function npmInstall(rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd, timeoutMs: 10 * 60 * 1000 });
    log('npm-install', res);
    if (res.code !== 0) worst = 'failed';
    else installed.add(path.posix.dirname(rel));
    bits.push(`${rel} ${brief(res)}`);
  }
  put('npm-install', worst, bits.join('; '));
}

// Project .npmrc files are not captured, and lockfiles drift from package.json. Fall back to legacy peer
// resolution, then to an install that keeps locked versions and resolves only missing entries; the mode used is disclosed.
const NPM_FETCH_MODES = [
  ['ci', 'ci'],
  ['ci with legacy peer deps', 'ci', '--legacy-peer-deps'],
  ['install (lockfile out of sync; missing entries resolved from the registry)', 'install', '--no-save'],
  ['install with legacy peer deps (lockfile out of sync; missing entries resolved from the registry)', 'install', '--no-save', '--legacy-peer-deps'],
];

// Review mode: fetch lockfile-pinned packages only, like the wheel-only Python
// preparer. --ignore-scripts keeps install hooks and target code from running;
// existing tests use node_modules after the network is disconnected.
export async function npmFetch(rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    if (timeLeft() < 60_000) { worst = 'impossible'; bits.push(`${rel} time limit`); continue; }
    let res, mode, args;
    for ([mode, ...args] of NPM_FETCH_MODES) {
      if (timeLeft() < 60_000) break;
      res = await run('npm', [...args, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', '/work/npm-cache'], { cwd, timeoutMs: Math.min(10 * 60 * 1000, timeLeft()), env: { npm_config_ignore_scripts: 'true' } });
      log('npm-install', res);
      if (res.code === 0) break;
    }
    if (res?.code !== 0) worst = 'failed';
    bits.push(res ? `${rel} ${res.code === 0 ? mode : brief(res)}` : `${rel} time limit`);
  }
  put('npm-install', worst, `Lockfile-only fetch, install scripts disabled: ${bits.join('; ')}`);
}

export async function pnpmInstall(rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const res = await run('pnpm', ['install', '--frozen-lockfile'], { cwd, timeoutMs: 10 * 60 * 1000 });
    log('pnpm-install', res);
    if (res.code !== 0) worst = 'failed';
    else installed.add(path.posix.dirname(rel));
    bits.push(`${rel} ${brief(res)}`);
  }
  put('pnpm-install', worst, bits.join('; '));
}

export function yarnBerry(cwd) {
  try {
    return /__metadata|yarn lockfile v[2-9]/i.test(fs.readFileSync(path.join(cwd, 'yarn.lock'), 'utf8').slice(0, 400));
  } catch { return false; }
}

export async function yarnInstall(rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) { worst = 'failed'; bits.push(`${rel} path refused`); continue; }
    const berry = yarnBerry(cwd);
    if (berry) {
      const prepared = await run('corepack', ['prepare', 'yarn@4.9.2', '--activate'], { cwd, timeoutMs: 180_000 });
      log('yarn-install', prepared);
      if (prepared.code !== 0) { worst = 'failed'; bits.push(`${rel} ${brief(prepared)}`); continue; }
    }
    const args = berry ? ['install', '--immutable'] : ['install', '--frozen-lockfile', '--registry', 'https://registry.npmjs.org'];
    const res = await run('yarn', args, { cwd, timeoutMs: 10 * 60 * 1000 });
    log('yarn-install', res);
    if (res.code !== 0) worst = 'failed';
    else installed.add(path.posix.dirname(rel));
    bits.push(`${rel} ${brief(res)}`);
  }
  put('yarn-install', worst, bits.join('; '));
}
