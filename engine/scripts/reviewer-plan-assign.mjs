// Job assignment: the one function that decides which reviewer reviews which surface.
// The orchestrator, the host runners and the report contract all derive the job inventory here,
// so a report is validated against exactly the jobs that were launched. Dependency-light on purpose:
// report-contract.mjs imports it inside the bridge process.
import { SURFACES } from './orchestrator-surfaces.mjs';

export const ASSIGN_MODES = Object.freeze(['matrix', 'round-robin']);

// --scope: review one layer (harness-layers.mjs) instead of the whole target. 'full' is every layer.
export const SCOPES = Object.freeze(['full', 'web2', 'web3', 'infra']);
// Surfaces with checks for a layer. Infra has no input-handling or business-logic surface (SKILL.md section 5).
const SCOPE_SURFACES = { infra: ['S1', 'S4', 'S5', 'S6'] };

export function normalizeScope(scope) {
  const want = String(scope || 'full').toLowerCase();
  if (!SCOPES.includes(want)) throw new Error(`Unknown scope: ${scope}. Valid: ${SCOPES.join(', ')}`);
  return want;
}

export function selectSurfaces(surfaceArg, scope = 'full') {
  const want = String(surfaceArg || 'all').toLowerCase();
  const layer = normalizeScope(scope);
  const inScope = (s) => !SCOPE_SURFACES[layer] || SCOPE_SURFACES[layer].includes(s.code);
  const named = want === 'all' ? SURFACES : SURFACES.filter((s) => s.id === want || s.slug === want);
  if (!named.length) throw new Error(`Unknown surface: ${surfaceArg}`);
  const selected = named.filter(inScope);
  if (!selected.length) throw new Error(`Surface ${surfaceArg} has no ${layer} checks; the ${layer} scope reviews ${SCOPE_SURFACES[layer].join(', ')}`);
  return selected;
}

// Jobs are `<reviewerId>-sN-<slug>`. matrix: every reviewer x every selected surface.
// round-robin: with --surface all surface i goes to reviewer i % n; a single surface goes to everyone.
export function assignJobs({ reviewers, surfaceArg = 'all', assign = 'matrix', scope = 'full' }) {
  if (!ASSIGN_MODES.includes(assign)) throw new Error(`Unknown assignment mode: ${assign}`);
  const surfaces = selectSurfaces(surfaceArg, scope);
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
    return assignJobs({ reviewers, surfaceArg: meta.surface, assign: meta.assign || 'round-robin', scope: meta.scope || 'full' }).map((job) => job.name);
  } catch { return []; }
}
