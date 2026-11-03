// Disk hygiene (W09-19), run by the maintenance cron. Policy:
//  RUNS_ROOT (host-only attempt dirs): requests still in flight or `failed` (an operator may need the
//    logs) are never touched. A `done` request keeps only the attempt it published; its failed or
//    interrupted attempts are removed. Of the finished requests (done, refunded, expired) the newest
//    KEEP_RUNS (by last status change) keep their dirs; older ones are removed.
//  REPORTS_ROOT (published, served): a report of a `done` request is never removed, nor one whose
//    request may still attest (running, publishing) or is `failed`. Only an orphan (the request was
//    refunded or expired after publication, e.g. an admin refund racing the publish) orphaned for more
//    than ORPHAN_REPORT_RETENTION_H is removed, plus `.staging/` leftovers older than an hour.
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
const FINISHED: ReadonlySet<Status | 'unknown'> = new Set(['done', 'refunded', 'expired']);
const ORPHANED: ReadonlySet<Status | 'unknown'> = new Set(['refunded', 'expired']);

export interface HygienePolicy { runsRoot: string; reportsRoot: string; keepRuns: number; orphanReportRetentionH: number }
export interface HygieneResult { runsRemoved: number; attemptsRemoved: number; reportsRemoved: number; stagingRemoved: number }
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

function cleanReports(policy: HygienePolicy, known: Known, now: number): number {
  const cutoff = now - policy.orphanReportRetentionH * 3600 * 1000;
  let removed = 0;
  for (const report of requestDirs(policy.reportsRoot)) {
    // Never a done request's report, whatever its age: it is (or is about to be) attested on chain.
    if (!ORPHANED.has(statusIn(known, report.id))) continue;
    // Orphaned since the later of publication and the refund/expiry.
    if (Math.max(report.mtimeMs, known.get(report.id)?.updatedMs ?? 0) > cutoff) continue;
    removeTree(report.dir);
    removed++;
  }
  return removed;
}

export async function runHygiene(policy: HygienePolicy, lookup: Lookup, now = Date.now()): Promise<HygieneResult> {
  const ids = [...new Set([...requestDirs(policy.runsRoot), ...requestDirs(policy.reportsRoot)].map((entry) => entry.id))];
  const known: Known = ids.length ? await lookup(ids) : new Map();
  const runs = cleanRuns(policy, known);
  return { ...runs, reportsRemoved: cleanReports(policy, known, now), stagingRemoved: cleanStaging(policy.reportsRoot, now) };
}

/** Request statuses from the database; an id with no row is absent from the map ("unknown"). */
export function statusLookup(db: Db): Lookup {
  return async (ids) => {
    const result = await db.query<{ id: string; status: Status; updated_at: Date }>(
      'SELECT id, status, updated_at FROM request WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(result.rows.map((row) => [row.id, { status: row.status, updatedMs: row.updated_at.getTime() }]));
  };
}
