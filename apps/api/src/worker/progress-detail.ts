// The engine's live snapshot (engine/scripts/orchestrator-progress.mjs, harness/host/progress.json) as a
// progress row. Only the fields of intake-api.schema.json#/$defs/progress-detail are copied, each checked and
// bounded, so nothing else in the file (and no target text) can reach the API, the database or a browser.
import path from 'node:path';
import type { Progress, ProgressDetail } from '../db/repositories/progress.ts';
import { readJson } from './classify.ts';

export const PROGRESS_FILE = path.join('harness', 'host', 'progress.json');

const STATES = new Set(['running', 'finished', 'incomplete', 'failed', 'cancelled']);
const PHASES = ['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report'];
const PHASE_STATES = new Set(['pending', 'running', 'done', 'failed', 'skipped']);
const REVIEWER_STATES = new Set(['pending', 'running', 'done', 'failed']);
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/;

type Raw = Record<string, unknown>;
const record = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, min = 0): number | undefined => (Number.isSafeInteger(value) && (value as number) >= min ? value as number : undefined);
const stamp = (value: unknown): string | undefined => (typeof value === 'string' && STAMP.test(value) ? value : undefined);
const pick = <T extends Raw>(row: T) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

function phases(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(record)
    .filter((row) => PHASES.includes(String(row.name)) && PHASE_STATES.has(String(row.state)))
    .slice(0, PHASES.length)
    .map((row) => pick({ name: String(row.name), state: String(row.state), startedAt: stamp(row.startedAt), endedAt: stamp(row.endedAt) }));
}

function reviewers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(record)
    .filter((row) => ID.test(String(row.id)) && REVIEWER_STATES.has(String(row.state)) && count(row.jobs, 1) !== undefined && count(row.passes, 1) !== undefined)
    .slice(0, 32)
    .map((row) => pick({
      id: String(row.id), state: String(row.state), jobsDone: count(row.jobsDone) ?? 0, jobs: count(row.jobs, 1), passes: count(row.passes, 1),
      pass: count(row.pass, 1), calls: count(row.calls), budget: count(row.budget, 1),
      surface: typeof row.surface === 'string' && /^S[1-6]$/.test(row.surface) ? row.surface : undefined,
      idleMs: count(row.idleMs),
    }));
}

function counts(value: unknown, keys: string[]) {
  if (!record(value)) return undefined;
  const out = pick(Object.fromEntries(keys.map((key) => [key, count(value[key])])));
  return Object.keys(out).length ? out : undefined;
}

/** The snapshot of one engine run as a progress row, or null when the engine wrote none (or an unreadable one). */
export function progressFromSnapshot(outDir: string): Progress | null {
  const raw = readJson(path.join(outDir, PROGRESS_FILE));
  if (!record(raw) || raw.version !== 1 || !STATES.has(String(raw.state))) return null;
  const percent = typeof raw.percent === 'number' && raw.percent >= 0 && raw.percent <= 100 ? Math.round(raw.percent) : 0;
  const list = reviewers(raw.reviewers);
  const detail: ProgressDetail = pick({
    state: String(raw.state), startedAt: stamp(raw.startedAt), updatedAt: stamp(raw.updatedAt), elapsedMs: count(raw.elapsedMs),
    phases: phases(raw.phases), reviewers: list,
    crosscheck: counts(raw.crosscheck, ['done', 'total']),
    debate: counts(raw.debate, ['clusters', 'heard', 'judged', 'toJudge']),
  });
  const phase = PHASES.includes(String(raw.phase)) ? String(raw.phase) : 'starting';
  // The row's own reviewer and pass: the running reviewer that is furthest behind, so the headline names who is waited on.
  const waiting = list.filter((row) => row.state === 'running').sort((a, b) => Number(a.pass ?? 0) - Number(b.pass ?? 0) || Number(a.calls ?? 0) - Number(b.calls ?? 0))[0];
  return {
    phase, percent, detail,
    ...(waiting ? { reviewer: String(waiting.id), ...(waiting.pass ? { pass: Number(waiting.pass) } : {}) } : {}),
  };
}
