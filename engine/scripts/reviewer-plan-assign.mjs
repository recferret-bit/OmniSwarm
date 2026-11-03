// Job assignment: the one function that decides which reviewer reviews which surface.
// The orchestrator, the host runners and the report contract all derive the job inventory here,
// so a report is validated against exactly the jobs that were launched. Dependency-light on purpose:
// report-contract.mjs imports it inside the bridge process.
import { SURFACES } from './orchestrator-surfaces.mjs';

export const ASSIGN_MODES = Object.freeze(['matrix', 'round-robin']);

export function selectSurfaces(surfaceArg) {
  const want = String(surfaceArg || 'all').toLowerCase();
  const selected = want === 'all' ? SURFACES : SURFACES.filter((s) => s.id === want || s.slug === want);
  if (!selected.length) throw new Error(`Unknown surface: ${surfaceArg}`);
  return selected;
}

// Jobs are `<reviewerId>-sN-<slug>`. matrix: every reviewer x every selected surface.
// round-robin: with --surface all surface i goes to reviewer i % n; a single surface goes to everyone.
export function assignJobs({ reviewers, surfaceArg = 'all', assign = 'matrix' }) {
  if (!ASSIGN_MODES.includes(assign)) throw new Error(`Unknown assignment mode: ${assign}`);
  const surfaces = selectSurfaces(surfaceArg);
  const all = String(surfaceArg || 'all').toLowerCase() === 'all';
  const pairs = assign === 'round-robin' && all
    ? surfaces.map((surface, i) => [reviewers[i % reviewers.length], surface])
    : surfaces.flatMap((surface) => reviewers.map((reviewer) => [reviewer, surface]));
  return pairs.map(([reviewer, surface]) => ({ name: `${reviewer.id}-${surface.id}-${surface.slug}`, reviewer, surface }));
}

// The mode a request gets when it names none. A request built from a reviewer list gets the matrix;
// one built from legacy adapter names (or a report that predates `assign`) keeps round-robin.
export function defaultAssign({ assign, reviewers } = {}) {
  if (assign) return assign;
  return Array.isArray(reviewers) && reviewers.length ? 'matrix' : 'round-robin';
}

// Job names a report must contain, from its own meta: reviewers (or legacy agents), surface and assign.
export function expectedJobNames(meta, reviewers) {
  if (!reviewers.length) return [];
  try {
    return assignJobs({ reviewers, surfaceArg: meta.surface, assign: meta.assign || 'round-robin' }).map((job) => job.name);
  } catch { return []; }
}
