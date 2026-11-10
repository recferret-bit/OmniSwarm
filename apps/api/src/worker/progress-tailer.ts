// Progress tailer (W09-08): polls the engine's out dir and appends a request_progress row, with NOTIFY, when
// the run moves. The engine's live snapshot (harness/host/progress.json, see progress-detail.ts) is the source;
// a run that has none (an older engine) falls back to inferring the phase from the report files. A theme of a
// split review also refreshes its parent's row, so the page the account watches moves too. It also watches
// the request: a refund while running aborts the run.
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from '../db/pool.ts';
import { appendProgress, latestProgress, type Progress } from '../db/repositories/progress.ts';
import { findRequest, listThemes } from '../db/repositories/requests.ts';
import type { Clock } from '../shared/clock.ts';
import { readJson } from './classify.ts';
import { progressFromSnapshot } from './progress-detail.ts';

const DONE = new Set(['collected', 'completed', 'failed', 'cancelled', 'deferred']);

// The pass a running job is on: one more than the pass usage rows the engine has written for it.
function passOf(outDir: string, reviewer: string): number | undefined {
  const dir = path.join(outDir, 'harness', 'usage', reviewer);
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((name) => /-pass-\d+\.json$/.test(name)); } catch { return undefined; }
  return files.length + 1;
}

/** Where a run is: the engine's snapshot when it wrote one, else inferred from the report files. */
export function snapshot(outDir: string): Progress {
  return progressFromSnapshot(outDir) ?? inferred(outDir);
}

/** Older engines. Weights: start 5, review 10-70, debate 75, report 90, done 100. */
export function inferred(outDir: string): Progress {
  const meta = readJson(path.join(outDir, 'meta.json'));
  if (meta?.finalized === true && fs.existsSync(path.join(outDir, 'findings-and-scores.json'))) return { phase: 'report', percent: 100 };
  if (fs.existsSync(path.join(outDir, 'findings-and-scores.json'))) return { phase: 'report', percent: 90 };
  if (fs.existsSync(path.join(outDir, 'debate'))) return { phase: 'debate', percent: 75 };
  const jobs = readJson(path.join(outDir, 'workers.json'))?.jobs;
  if (Array.isArray(jobs) && jobs.length) {
    const finished = jobs.filter((job: { state?: string }) => DONE.has(String(job?.state))).length;
    // Jobs run in parallel: name a running one, by reviewer id (workers.json `adapter`), not the job name.
    const current = (jobs.find((job: { state?: string }) => job?.state === 'running') ?? jobs.find((job: { state?: string }) => !DONE.has(String(job?.state)))) as { adapter?: string } | undefined;
    const reviewer = typeof current?.adapter === 'string' ? current.adapter : undefined;
    const pass = reviewer ? passOf(outDir, reviewer) : undefined;
    return { phase: 'review', ...(reviewer ? { reviewer } : {}), ...(pass ? { pass } : {}), percent: Math.round(10 + (60 * finished) / jobs.length) };
  }
  return { phase: 'starting', percent: 5 };
}

export interface TailerDeps { pool: Pool; clock: Clock }

// A call-count change (and the percent it moves) is written at most this often. A phase, a run state, a
// reviewer starting, finishing, changing pass or stalling, and a debate count are written at once.
export const DETAIL_EVERY_MS = 30_000;
const STALL_MS = 120_000;

type DetailShape = { state?: string; phases?: unknown; reviewers?: Array<Record<string, unknown>>; sessions?: Array<Record<string, unknown>>; crosscheck?: unknown; debate?: unknown; themes?: unknown };

// What makes a row worth writing at once, and what may wait for DETAIL_EVERY_MS.
function detailKeys(progress: Progress): { now: string; later: string } {
  const detail = progress.detail as DetailShape | undefined;
  if (!detail) return { now: '', later: '' };
  const reviewers = detail.reviewers ?? [];
  return {
    now: JSON.stringify([detail.state, detail.phases, detail.crosscheck, detail.debate, detail.themes,
      reviewers.map((row) => [row.id, row.state, row.pass, Number(row.idleMs ?? 0) >= STALL_MS]),
      (detail.sessions ?? []).map((row) => [row.id, Number(row.idleMs ?? 0) >= STALL_MS])]),
    later: JSON.stringify([progress.percent, reviewers.map((row) => row.calls)]),
  };
}

const THEME_ORDER = ['web3', 'apps', 'infra', 'scripts'];
const FINISHED = new Set(['done', 'publishing']);

/** A split review's parent row: each theme's status, phase and percent, and their mean as the parent's percent. */
export async function themeProgress(pool: Pool, parentId: string): Promise<Progress | null> {
  const themes = (await listThemes(pool, parentId)).filter((row) => row.theme);
  if (!themes.length) return null;
  const rows = await Promise.all(themes.map(async (row) => ({ row, progress: await latestProgress(pool, row.id) })));
  const list = rows
    .sort((a, b) => THEME_ORDER.indexOf(String(a.row.theme)) - THEME_ORDER.indexOf(String(b.row.theme)))
    .map(({ row, progress }) => {
      const percent = FINISHED.has(row.status) ? 100 : progress ? Number(progress.percent) : 0;
      return { theme: String(row.theme), status: row.status, ...(progress && !FINISHED.has(row.status) ? { phase: progress.phase } : {}), percent };
    });
  const failed = list.some((row) => row.status === 'failed' || row.status === 'refunded');
  const percent = Math.round(list.reduce((sum, row) => sum + row.percent, 0) / list.length);
  return {
    phase: 'themes', percent: failed ? Math.min(percent, 99) : percent,
    detail: { state: failed ? 'incomplete' : list.every((row) => row.status === 'done') ? 'finished' : 'running', phases: [], themes: list },
  };
}

export class ProgressTailer {
  readonly #deps: TailerDeps;
  readonly #requestId: string;
  readonly #outDir: string;
  readonly #onRefunded: () => void;
  #last: Progress | null = null;
  #lastNow = '';
  #lastLater = '';
  #lastWrite = 0;
  #lastParent = '';
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> = Promise.resolve();

  constructor(deps: TailerDeps, requestId: string, outDir: string, onRefunded: () => void) {
    this.#deps = deps;
    this.#requestId = requestId;
    this.#outDir = outDir;
    this.#onRefunded = onRefunded;
  }

  start(intervalMs: number): void {
    const poll = () => { this.#running = this.#running.then(() => this.tick()).catch(() => {}); };
    poll();
    this.#timer = setInterval(poll, intervalMs);
  }

  async tick(force = false): Promise<void> {
    const last = this.#last;
    const read = snapshot(this.#outDir);
    // The engine's first snapshot replaces the inferred "starting" row even when it is below that guess (a 0-4%
    // "Preparing sandbox"); the row keeps the higher percent, so what a client sees never goes back.
    // The same holds for a run that ended below the percent already shown (a sandbox that never started): its
    // final state is written at that percent instead of being dropped as a step backwards.
    const ended = Boolean(read.detail) && (read.detail as { state?: string }).state !== 'running';
    const next = read.detail && last && read.percent < last.percent && (!last.detail || ended) ? { ...read, percent: last.percent } : read;
    const now = this.#deps.clock.now();
    const keys = detailKeys(next);
    const forward = !last || next.percent >= last.percent;
    const firstDetail = Boolean(next.detail) && !last?.detail;
    const plain = !next.detail && (!last || (forward && (next.percent !== last.percent || next.phase !== last.phase || next.reviewer !== last.reviewer || next.pass !== last.pass)));
    const changed = Boolean(next.detail) && forward && (keys.now !== this.#lastNow || next.phase !== last?.phase);
    const drifted = Boolean(next.detail) && forward && keys.later !== this.#lastLater && now.getTime() - this.#lastWrite >= DETAIL_EVERY_MS;
    const final = force && Boolean(next.detail) && forward && keys.now + keys.later !== this.#lastNow + this.#lastLater;
    if (firstDetail || plain || changed || drifted || final) {
      await appendProgress(this.#deps.pool, this.#requestId, next, now);
      this.#last = next;
      this.#lastNow = keys.now;
      this.#lastLater = keys.later;
      this.#lastWrite = now.getTime();
    }
    const row = await findRequest(this.#deps.pool, this.#requestId);
    if (row?.status === 'refunded') this.#onRefunded();
    if (row?.parent_id) await this.#refreshParent(row.parent_id, now);
  }

  async #refreshParent(parentId: string, now: Date): Promise<void> {
    const parent = await themeProgress(this.#deps.pool, parentId);
    if (!parent) return;
    const key = JSON.stringify(parent);
    if (key === this.#lastParent) return;
    const before = await latestProgress(this.#deps.pool, parentId);
    if (before && JSON.stringify({ phase: before.phase, percent: Number(before.percent), detail: before.detail }) === key) return;
    await appendProgress(this.#deps.pool, parentId, parent, now);
    this.#lastParent = key;
  }

  /** Stop polling and record the final state once. */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
    // The last snapshot is written whatever the throttle says, so the final state is never lost.
    await this.tick(true);
  }
}
