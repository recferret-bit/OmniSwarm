// Large-review fan-out. One shallow clone, then one queued request per theme so
// the host workers run the slices at the same time. The parent stays `running`
// until every theme has settled, then a short index is published as the final report.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RequestRow } from '../db/repositories/requests.ts';
import { findRequest, insertThemeRequest, listThemes, transition } from '../db/repositories/requests.ts';
import { withTransaction } from '../db/pool.ts';
import { enqueueReview, type ReviewJob } from '../queue/review-queue.ts';
import type { PgBoss } from '../queue/boss.ts';
import type { Clock } from '../shared/clock.ts';
import type { Pool } from '../db/pool.ts';
import type { Config } from '../config/load.ts';
import { publishReport } from './publish.ts';
import { partitionTree, rootFileThemes, shouldSplit, type ReviewScope, type ThemeSlice } from './themes.ts';

function git(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} exited ${code}`))));
  });
}

function walk(dir: string, tally: { files: number; bytes: number }): void {
  if (tally.files > 20_000) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, tally);
    else if (entry.isFile()) {
      tally.files += 1;
      tally.bytes += fs.statSync(full).size;
    }
  }
}

export async function shallowClone(repo: string, sha: string, dest: string): Promise<void> {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  await git(['init'], dest);
  await git(['remote', 'add', 'origin', `https://github.com/${repo}.git`], dest);
  await git(['fetch', '--depth', '1', 'origin', sha], dest);
  await git(['checkout', '--detach', 'FETCH_HEAD'], dest);
}

export function materialize(source: string, slice: ThemeSlice, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const excluded = (slice.exclude ?? []).map((item) => item.split('/').join(path.sep));
  const skip = (from: string) => {
    const rel = path.relative(source, from);
    return excluded.some((item) => rel === item || rel.startsWith(`${item}${path.sep}`));
  };
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    if (fs.statSync(from).isFile() && rootFileThemes(name).includes(slice.theme)) fs.copyFileSync(from, path.join(dest, name));
  }
  for (const dir of slice.dirs) {
    const from = path.join(source, dir);
    const to = path.join(dest, dir);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, filter: (candidate) => !skip(candidate) });
  }
}

function indexHtml(repo: string, themes: { theme: string; id: string; status: string }[]): string {
  const items = themes.map((theme) => `<li><a href="../${theme.id}/report.html">${theme.theme}</a> (${theme.status})</li>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${repo} final report</title></head><body><h1>${repo}</h1><p>Final report. Each theme was reviewed on its own slice and linked below.</p><ul>${items}</ul></body></html>\n`;
}

export async function splitLargeReview(input: {
  pool: Pool; boss: PgBoss; clock: Clock; config: Config; row: RequestRow;
}): Promise<'split' | 'single' | 'empty'> {
  const scope = input.row.scope ?? 'full';
  if ((await listThemes(input.pool, input.row.id)).length > 0) return 'split';
  const root = path.join(input.config.storage.runsRoot, input.row.id, 'source');
  await shallowClone(input.row.repo, input.row.commit_sha, root);
  const files: string[] = [];
  const collect = (dir: string, rel = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) collect(path.join(dir, entry.name), child);
      else files.push(child);
    }
  };
  collect(root);
  const slices = partitionTree(files, scope as ReviewScope);
  const tally = { files: 0, bytes: 0 };
  walk(root, tally);
  if (!shouldSplit({ scope: scope as ReviewScope, themes: slices.length, files: tally.files, bytes: tally.bytes })) {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
    return slices.length === 0 && scope !== 'full' ? 'empty' : 'single';
  }
  const now = input.clock.now();
  await transition(input.pool, input.row.id, {
    to: 'running', actor: 'worker', event: 'review_split', data: { themes: slices.map((slice) => slice.theme) }, now,
  });
  for (const slice of slices) {
    const id = crypto.randomUUID();
    const dest = path.join(input.config.storage.runsRoot, input.row.id, 'themes', slice.theme);
    materialize(root, slice, dest);
    const requestHash = crypto.createHash('sha256').update(`theme:${input.row.id}:${slice.theme}:${id}`).digest('hex');
    const job: ReviewJob = {
      requestId: id, requestHash, repo: input.row.repo, commitSha: input.row.commit_sha, preset: input.row.preset, network: input.row.network,
    };
    await withTransaction(input.pool, async (tx) => {
      await insertThemeRequest(tx, { id, parent: input.row, theme: slice.theme, slicePath: dest, now, requestHash });
      await enqueueReview(input.boss, tx, job);
    });
  }
  return 'split';
}

export async function finalReportDir(pool: Pool, config: Config, parentId: string): Promise<{ parent: RequestRow; dir: string } | null> {
  const themes = await listThemes(pool, parentId);
  if (themes.length === 0 || themes.some((theme) => theme.status === 'queued' || theme.status === 'running' || theme.status === 'publishing')) return null;
  const parent = await findRequest(pool, parentId);
  if (!parent || parent.status !== 'running') return null;
  const dir = path.join(config.storage.runsRoot, parent.id, 'final');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'report.html'), indexHtml(parent.repo, themes.map((theme) => ({ theme: theme.theme ?? 'theme', id: theme.id, status: theme.status }))));
  fs.writeFileSync(path.join(dir, 'findings-and-scores.json'), '[]\n');
  fs.writeFileSync(path.join(dir, 'general-review.json'), '{}\n');
  return { parent, dir };
}
