// Disk hygiene (W09-19), run by the maintenance cron. Policy:
//  RUNS_ROOT (host-only attempt dirs): requests still in flight are never touched. A `done` request keeps
//    only the attempt it published; its failed or interrupted attempts are removed. Of the finished requests
//    (done or failed) the newest KEEP_RUNS (by last status change) keep their dirs; older ones are removed.
//  REPORTS_ROOT (published, served): a published report is never removed. Only `.staging/` leftovers older
//    than an hour are.
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/pool.ts';
import type { Status } from '../modules/requests/state.ts';
import { completedAttempt } from './attempts.ts';
import { removeTree } from './publish.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGING_MAX_AGE_MS = 3600 * 1000;
// A dir the database has no request for is left alone: a worker pointed at the wrong (or a restored)
// database must not read every report as an orphan.
const FINISHED: ReadonlySet<Status | 'unknown'> = new Set(['done', 'failed']);

export interface HygienePolicy { runsRoot: string; reportsRoot: string; keepRuns: number }
export interface HygieneResult { runsRemoved: number; attemptsRemoved: number; stagingRemoved: number }
/** What the database knows of a request: its status and when it last changed (orders finished runs). */
export interface KnownRequest { status: Status; updatedMs: number }
type Known = Map<string, KnownRequest>;
type Lookup = (ids: string[]) => Promise<Known>;

const statusIn = (known: Known, id: string): Status | 'unknown' => known.get(id)?.status ?? 'unknown';

function requestDirs(root: string): Array<{ id: string; dir: string; mtimeMs: number }> {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => {
      const dir = path.join(root, entry.name);
      return { id: entry.name, dir, mtimeMs: fs.statSync(dir).mtimeMs };
    });
}

/** Remove every attempt of a done request except the completed one it published. */
function pruneAttempts(runsRoot: string, id: string): number {
  const kept = completedAttempt(runsRoot, id)?.out;
  if (!kept) return 0;
  const base = path.join(runsRoot, id);
  let removed = 0;
  for (const name of fs.readdirSync(base)) {
    if (path.join(base, name, 'report') === kept) continue;
    removeTree(path.join(base, name));
    removed++;
  }
  return removed;
}

function cleanRuns(policy: HygienePolicy, known: Known): Pick<HygieneResult, 'runsRemoved' | 'attemptsRemoved'> {
  const age = (run: { id: string; mtimeMs: number }) => known.get(run.id)?.updatedMs ?? run.mtimeMs;
  const finished = requestDirs(policy.runsRoot)
    .filter((run) => FINISHED.has(statusIn(known, run.id)))
    .sort((a, b) => age(b) - age(a));
  let attemptsRemoved = 0;
  for (const run of finished.slice(0, policy.keepRuns)) {
    if (statusIn(known, run.id) === 'done') attemptsRemoved += pruneAttempts(policy.runsRoot, run.id);
  }
  const old = finished.slice(policy.keepRuns);
  for (const run of old) removeTree(run.dir);
  return { runsRemoved: old.length, attemptsRemoved };
}

function cleanStaging(reportsRoot: string, now: number): number {
  const staging = path.join(reportsRoot, '.staging');
  if (!fs.existsSync(staging)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(staging)) {
    const dir = path.join(staging, name);
    if (now - fs.statSync(dir).mtimeMs < STAGING_MAX_AGE_MS) continue;
    removeTree(dir);
    removed++;
  }
  return removed;
}

export async function runHygiene(policy: HygienePolicy, lookup: Lookup, now = Date.now()): Promise<HygieneResult> {
  const ids = [...new Set([...requestDirs(policy.runsRoot), ...requestDirs(policy.reportsRoot)].map((entry) => entry.id))];
  const known: Known = ids.length ? await lookup(ids) : new Map();
  const runs = cleanRuns(policy, known);
  return { ...runs, stagingRemoved: cleanStaging(policy.reportsRoot, now) };
}

/** Request statuses from the database; an id with no row is absent from the map ("unknown"). */
export function statusLookup(db: Db): Lookup {
  return async (ids) => {
    const result = await db.query<{ id: string; status: Status; updated_at: Date }>(
      'SELECT id, status, updated_at FROM request WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(result.rows.map((row) => [row.id, { status: row.status, updatedMs: row.updated_at.getTime() }]));
  };
}
