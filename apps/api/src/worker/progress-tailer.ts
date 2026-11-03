// Progress tailer (W09-08): polls the engine's out dir (meta.json, workers.json, reviewers/*/usage.json,
// debate/, the final report files) and appends a request_progress row, with NOTIFY, whenever the
// phase or percent moves forward. It also watches the request: a refund while running aborts the run.
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from '../db/pool.ts';
import { appendProgress, type Progress } from '../db/repositories/progress.ts';
import { findRequest } from '../db/repositories/requests.ts';
import type { Clock } from '../shared/clock.ts';
import { readJson } from './classify.ts';

const DONE = new Set(['collected', 'completed', 'failed', 'cancelled', 'deferred']);

function passOf(outDir: string, reviewer: string): number | undefined {
  const usage = readJson(path.join(outDir, 'reviewers', reviewer, 'usage.json'));
  const passes = Array.isArray(usage?.passes) ? usage.passes.length : 0;
  return passes > 0 ? passes : undefined;
}

/** Where a run is, from its files alone. Weights: start 5, review 10-70, debate 75, report 90, done 100. */
export function snapshot(outDir: string): Progress {
  const meta = readJson(path.join(outDir, 'meta.json'));
  if (meta?.finalized === true && fs.existsSync(path.join(outDir, 'findings-and-scores.json'))) return { phase: 'report', percent: 100 };
  if (fs.existsSync(path.join(outDir, 'findings-and-scores.json'))) return { phase: 'report', percent: 90 };
  if (fs.existsSync(path.join(outDir, 'debate'))) return { phase: 'debate', percent: 75 };
  const jobs = readJson(path.join(outDir, 'workers.json'))?.jobs;
  if (Array.isArray(jobs) && jobs.length) {
    const finished = jobs.filter((job: { state?: string }) => DONE.has(String(job?.state))).length;
    const current = (jobs.find((job: { state?: string }) => !DONE.has(String(job?.state))) ?? jobs.at(-1)) as { name?: string };
    const reviewer = typeof current?.name === 'string' ? current.name : undefined;
    const pass = reviewer ? passOf(outDir, reviewer) : undefined;
    return { phase: 'review', ...(reviewer ? { reviewer } : {}), ...(pass ? { pass } : {}), percent: Math.round(10 + (60 * finished) / jobs.length) };
  }
  return { phase: 'starting', percent: 5 };
}

export interface TailerDeps { pool: Pool; clock: Clock }

export class ProgressTailer {
  readonly #deps: TailerDeps;
  readonly #requestId: string;
  readonly #outDir: string;
  readonly #onRefunded: () => void;
  #last: Progress | null = null;
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

  async tick(): Promise<void> {
    const next = snapshot(this.#outDir);
    const last = this.#last;
    if (!last || (next.percent >= last.percent && (next.percent !== last.percent || next.phase !== last.phase || next.reviewer !== last.reviewer))) {
      await appendProgress(this.#deps.pool, this.#requestId, next, this.#deps.clock.now());
      this.#last = next;
    }
    const row = await findRequest(this.#deps.pool, this.#requestId);
    if (row?.status === 'refunded') this.#onRefunded();
  }

  /** Stop polling and record the final state once. */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#running;
    await this.tick();
  }
}
