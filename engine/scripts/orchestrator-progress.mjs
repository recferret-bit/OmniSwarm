// Live progress of one run: a full snapshot in harness/host/progress.json, rewritten atomically on every change,
// and a short status line in the terminal. The terminal, the intake worker (apps/api progress tailer) and the
// web pages all read this one snapshot, so they agree.
//
// The snapshot is display only. It lives under harness/host/, which is never mounted into the container, so no
// reviewer can read it through the bridge. It holds phase states, counts and reviewer ids, never a finding
// title or target text, and nothing reads it to steer resume, failure classification or the report.
import fs from 'node:fs';
import path from 'node:path';
import { loadBudget, passKey } from './bridge-budget.mjs';
import { writeReportFile } from './report-files.mjs';
import { usageRel } from './review-passes.mjs';
import { PROGRESS_FILE } from './sandbox-host-paths.mjs';

export const PROGRESS_VERSION = 1;

// The phases of orchestrator-phases.mjs, each with the share of the bar it fills.
export const PHASES = Object.freeze([
  { name: 'prepare', label: 'Preparing sandbox', from: 0, to: 5 },
  { name: 'tests', label: 'Existing tests', from: 5, to: 10 },
  { name: 'review', label: 'Review', from: 10, to: 70 },
  { name: 'crosscheck', label: 'Cross-check', from: 70, to: 78 },
  { name: 'debate', label: 'Debate', from: 78, to: 88 },
  { name: 'adjudicate', label: 'Adjudication', from: 88, to: 94 },
  { name: 'general-review', label: 'General review', from: 94, to: 97 },
  { name: 'report', label: 'Report', from: 97, to: 100 },
]);
const PHASE = new Map(PHASES.map((row) => [row.name, row]));

// A session with no agent activity for this long is shown as stalled. Display only: nothing is stopped.
export const STALL_MS = 120_000;
const DONE_JOB = new Set(['collected', 'completed', 'failed', 'cancelled', 'deferred']);
const FAILED_JOB = new Set(['failed', 'cancelled', 'deferred']);
const iso = (ms) => new Date(ms).toISOString();

function completedPasses(output, reviewerId, surface, passes) {
  let count = 0;
  for (let pass = 1; pass <= passes; pass++) if (fs.existsSync(path.join(output, usageRel(reviewerId, surface, pass)))) count = pass;
  return count;
}

// One reviewer's jobs, from the run's own job list, the bridge budget files and the pass usage rows.
function reviewerRows(output, jobs, budgets, activity, now) {
  const passes = Math.max(1, Number(budgets?.passes) || 1);
  const budget = Math.max(1, Number(budgets?.toolBudget) || 40);
  const byReviewer = new Map();
  for (const job of jobs) {
    const id = job.adapter || job.reviewer?.id;
    if (!id) continue;
    if (!byReviewer.has(id)) byReviewer.set(id, []);
    byReviewer.get(id).push(job);
  }
  return [...byReviewer].map(([id, own]) => {
    const spend = loadBudget(output, id);
    const running = own.find((job) => job.state === 'running') || null;
    const surface = running?.surface?.code || running?.surface || null;
    const done = own.filter((job) => DONE_JOB.has(job.state)).length;
    const pass = running ? Math.min(passes, completedPasses(output, id, surface, passes) + 1) : null;
    const calls = running ? Number(spend.passes?.[passKey(surface, pass)]?.calls) || 0 : null;
    const idle = own.map((job) => activity.get(job.name)).filter((row) => row && running && row.job === running.name).map((row) => row.agentIdleMs ?? (now - row.at));
    const state = running ? 'running' : done === own.length ? (own.some((job) => FAILED_JOB.has(job.state)) ? 'failed' : 'done') : 'pending';
    const share = own.reduce((sum, job) => {
      if (DONE_JOB.has(job.state)) return sum + 1;
      if (job !== running) return sum;
      return sum + (completedPasses(output, id, surface, passes) + Math.min(1, (calls || 0) / budget)) / passes;
    }, 0) / own.length;
    return {
      id, state, jobsDone: done, jobs: own.length, passes,
      ...(running ? { pass, calls: Math.min(calls, budget), budget, surface: String(surface).toUpperCase() } : {}),
      ...(idle.length ? { idleMs: Math.max(0, Math.round(Math.min(...idle))) } : {}),
      share,
    };
  });
}

// tracker = createProgress({output, jobs, budgets, print, now}). Every method rewrites the snapshot.
export function createProgress({ output, jobs = [], budgets = null, print = null, now = Date.now, intervalMs = 60_000 } = {}) {
  const started = now();
  const phases = new Map(PHASES.map((row) => [row.name, { name: row.name, state: 'pending' }]));
  const activity = new Map();
  const counters = { crosscheck: null, debate: null, adjudicate: null };
  let state = 'running';
  let percent = 0;
  let lastLine = '';
  let lastPrinted = 0;

  const current = () => [...phases.values()].find((row) => row.state === 'running') || null;
  // The phase the headline names: the running one; after a failure the phase that failed; between two phases
  // the one that just ended (skipped phases do not count).
  const headline = (running) => running?.name
    || [...phases.values()].find((row) => row.state === 'failed')?.name
    || [...phases.values()].filter((row) => row.state === 'done').at(-1)?.name
    || 'starting';
  const share = (name, reviewers) => {
    if (name === 'review') return reviewers.length ? reviewers.reduce((sum, row) => sum + row.share, 0) / reviewers.length : 0;
    const counter = counters[name];
    return counter?.total ? Math.min(1, counter.done / counter.total) : 0;
  };

  function build() {
    const at = now();
    const reviewers = reviewerRows(output, jobs, budgets, activity, at);
    const running = current();
    let computed = 0;
    for (const row of PHASES) {
      const phase = phases.get(row.name);
      if (phase.state === 'done' || phase.state === 'skipped' || phase.state === 'failed') computed = Math.max(computed, row.to);
      else if (phase.state === 'running') computed = Math.max(computed, row.from + (row.to - row.from) * share(row.name, reviewers));
    }
    // Never backward, and 100 only for a run that finished cleanly.
    percent = state === 'finished' ? 100 : Math.min(99, Math.max(percent, Math.round(computed)));
    const debate = counters.debate || counters.adjudicate
      ? { ...(counters.debate ? { clusters: counters.debate.total, heard: counters.debate.done } : {}), ...(counters.adjudicate ? { judged: counters.adjudicate.done, toJudge: counters.adjudicate.total } : {}) }
      : null;
    return {
      // Between two phases the headline keeps the one that just ended, rather than going back to "starting".
      version: PROGRESS_VERSION, state, phase: headline(running), percent,
      startedAt: iso(started), updatedAt: iso(at), elapsedMs: at - started,
      phases: [...phases.values()].map((row) => ({ ...row })),
      reviewers: reviewers.map(({ share: _, ...row }) => row),
      ...(counters.crosscheck ? { crosscheck: { done: counters.crosscheck.done, total: counters.crosscheck.total } } : {}),
      ...(debate ? { debate } : {}),
    };
  }

  function write(force = false, banner = null) {
    const snapshot = build();
    try {
      fs.mkdirSync(path.dirname(path.join(output, PROGRESS_FILE)), { recursive: true, mode: 0o700 });
      writeReportFile(output, PROGRESS_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
    } catch { /* display only: a failed write never stops the run */ }
    if (print) {
      // A change worth a line: phase, a reviewer starting, finishing, changing pass or stalling, a debate count.
      // Call counts and the percent they move are left to the once-a-minute line, so an active review is not
      // a line every few seconds.
      const key = JSON.stringify([snapshot.state, snapshot.phase, snapshot.debate, snapshot.crosscheck, snapshot.reviewers.map((row) => [row.id, row.state, row.pass, row.idleMs >= STALL_MS])]);
      const at = now();
      if (banner) {
        // A phase start is its own line, with the percent, so it is not followed by a duplicate status line.
        print(`  == ${banner} · ${snapshot.percent}% · ${minutes(snapshot.elapsedMs)}`);
        lastLine = key;
        lastPrinted = at;
      } else if (force || (key !== lastLine && at - lastPrinted >= 5_000) || at - lastPrinted >= intervalMs) {
        print(statusLine(snapshot));
        lastLine = key;
        lastPrinted = at;
      }
    }
    return snapshot;
  }

  return {
    phaseStart(name) {
      const row = phases.get(name);
      if (!row) return;
      row.state = 'running';
      row.startedAt = iso(now());
      write(false, PHASE.get(name).label);
    },
    phaseEnd(name, outcome = 'done') {
      const row = phases.get(name);
      if (!row) return;
      row.state = outcome;
      row.endedAt = iso(now());
      write(outcome !== 'done');
    },
    counter(name, done, total) {
      if (!(name in counters)) return;
      counters[name] = { done: Math.max(0, Number(done) || 0), total: Math.max(0, Number(total) || 0) };
      write();
    },
    activity(jobName, status) {
      activity.set(jobName, { job: jobName, at: now(), agentIdleMs: status?.agentIdleMs ?? null });
      write();
    },
    refresh() { return write(); },
    // outcome: 'finished' | 'incomplete' | 'failed' | 'cancelled'. Phases that never started are skipped.
    finish(outcome) {
      for (const row of phases.values()) if (row.state === 'pending' || row.state === 'running') row.state = row.state === 'running' ? 'failed' : 'skipped';
      state = outcome;
      return write(true);
    },
    snapshot: build,
  };
}

const minutes = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s` : `${Math.floor(ms / 1000)}s`);

// One line: overall percent and phase, then each running reviewer with pass, calls and stall time.
export function statusLine(snapshot) {
  const phase = PHASE.get(snapshot.phase)?.label || snapshot.phase;
  const head = `  progress ${snapshot.percent}% · ${snapshot.state === 'running' ? phase : snapshot.state} · ${minutes(snapshot.elapsedMs)}`;
  const rows = (snapshot.reviewers || []).filter((row) => row.state === 'running').map((row) => {
    const stall = row.idleMs >= STALL_MS ? `, no activity ${minutes(row.idleMs)}` : '';
    return `${row.id} ${row.surface} pass ${row.pass}/${row.passes} ${row.calls}/${row.budget} calls${stall}`;
  });
  const done = (snapshot.reviewers || []).filter((row) => row.state === 'done' || row.state === 'failed').length;
  const jobs = snapshot.reviewers?.length ? ` · reviewers done ${done}/${snapshot.reviewers.length}` : '';
  const debate = snapshot.debate?.clusters ? ` · clusters heard ${snapshot.debate.heard}/${snapshot.debate.clusters}` : '';
  const judged = snapshot.debate?.toJudge ? ` · judged ${snapshot.debate.judged}/${snapshot.debate.toJudge}` : '';
  return `${head}${jobs}${debate}${judged}${rows.length ? ` · ${rows.join('; ')}` : ''}`;
}

export function readProgress(output) {
  try { return JSON.parse(fs.readFileSync(path.join(output, PROGRESS_FILE), 'utf8')); } catch { return null; }
}
