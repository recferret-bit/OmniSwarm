#!/usr/bin/env node
// Minimal wave tool (W00-16, H+). Reads docs/plan/waves/*.md headers and prints the PRODUCT_WAVES section 7
// commands. It never creates a worktree, a branch, a tag or a merge itself: it only refuses and prints.
//   node tools/wave.mjs status
//   node tools/wave.mjs open NN [--dry-run]
//   node tools/wave.mjs land NN [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WAVES_DIR = path.join(ROOT, 'docs/plan/waves');

export function parseWave(file, text) {
  const m = /^W(\d\d)-(.+)\.md$/.exec(path.basename(file));
  if (!m) return null;
  const header = text.split('\n').slice(0, 15).join('\n');
  const dep = /\*\*Depends on waves:\*\*\s*(.*)/.exec(header)?.[1] ?? '';
  let hard = dep.split(/\s(?:Soft|Uses|Not owned)\b/)[0];
  for (let prev = ''; prev !== hard;) { prev = hard; hard = hard.replace(/\([^()]*\)/g, ''); }
  const title = /^#\s*W\d\d\s*[—-]\s*(.+)$/m.exec(text)?.[1]?.trim() ?? m[2];
  return { id: m[1], slug: m[2].toLowerCase(), title, deps: [...new Set(hard.match(/\bW\d\d\b/g) ?? [])].map((w) => w.slice(1)) };
}

export function loadWaves(dir = WAVES_DIR) {
  return fs.readdirSync(dir).filter((f) => /^W\d\d-.*\.md$/.test(f)).sort()
    .map((f) => parseWave(f, fs.readFileSync(path.join(dir, f), 'utf8'))).filter(Boolean);
}

export function openCheck(wave, isTagged) {
  const missing = wave.deps.filter((d) => !isTagged(d));
  return missing.length ? { ok: false, message: `W${wave.id} waits for ${missing.map((d) => `W${d}`).join(', ')} in main` } : { ok: true, message: `W${wave.id} may open` };
}

export function openCommands(w) {
  const branch = `wave/w${w.id}-${w.slug}`;
  return [`git worktree add ../OmniSwarm-wt/w${w.id} -b ${branch} main`];
}

export function landCommands(w) {
  const branch = `wave/w${w.id}-${w.slug}`;
  return [
    `# in ../OmniSwarm-wt/w${w.id}: merge main in, run the wave check and every earlier wave's check`,
    `git merge main && npm run check:all && npm run check:w${w.id}`,
    `# owner check (docs/plan/checks/w${w.id}-check.md), then, in the main checkout:`,
    `git merge --no-ff ${branch} -m "W${w.id} ${w.title}" && git tag wave-${w.id} && git push origin main --tags`,
    `git worktree remove ../OmniSwarm-wt/w${w.id}`,
  ];
}

// A wave counts as landed when tag wave-NN exists and is an ancestor of main.
export function gitIsTagged(nn) {
  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  if (!git('rev-parse', '-q', '--verify', `refs/tags/wave-${nn}`).stdout.trim()) return false;
  return git('merge-base', '--is-ancestor', `wave-${nn}`, 'main').status === 0;
}

function main(argv) {
  const [cmd, nn, ...flags] = argv;
  const waves = loadWaves();
  const find = (n) => waves.find((w) => w.id === String(n).padStart(2, '0'));
  if (cmd === 'status') {
    for (const w of waves) {
      const landed = gitIsTagged(w.id);
      const open = openCheck(w, gitIsTagged);
      process.stdout.write(`W${w.id} ${w.title.padEnd(26)} ${landed ? 'landed' : open.ok ? 'ready to open' : 'blocked'}${landed ? '' : `  (deps: ${w.deps.map((d) => `W${d}`).join(', ') || 'none'}${open.ok ? '' : `; ${open.message}`})`}\n`);
    }
    return 0;
  }
  if (cmd === 'open' || cmd === 'land') {
    const w = nn && find(nn);
    if (!w) { process.stderr.write(`unknown wave: ${nn ?? '(none)'}\n`); return 2; }
    if (flags.some((f) => f !== '--dry-run')) { process.stderr.write(`unknown option: ${flags.find((f) => f !== '--dry-run')}\n`); return 2; }
    if (cmd === 'open') {
      const check = openCheck(w, gitIsTagged);
      process.stdout.write(`${check.message}\n`);
      if (!check.ok) return 1;
      process.stdout.write(`${openCommands(w).join('\n')}\n`);
    } else process.stdout.write(`${landCommands(w).join('\n')}\n`);
    process.stdout.write('(dry run: this tool prints commands and never runs them)\n');
    return 0;
  }
  process.stderr.write('usage: wave.mjs status | open NN [--dry-run] | land NN [--dry-run]\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
