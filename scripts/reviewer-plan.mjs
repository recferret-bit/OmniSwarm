#!/usr/bin/env node
// Assignment (matrix | round-robin), recommended orchestrator and the --plan text.
// ORCHESTRATION sections 1 and 4.5, OD-05.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRACE } from './bridge-budget.mjs';
import { families } from './reviewer-families.mjs';
import { passRoles } from './review-briefs.mjs';
import { formatReviewerSpec, parseReviewerSpec } from './reviewer-registry.mjs';
import { SURFACES } from './orchestrator-surfaces.mjs';

export function selectSurfaces(surfaceArg) {
  const want = String(surfaceArg || 'all').toLowerCase();
  const selected = want === 'all' ? SURFACES : SURFACES.filter((s) => s.id === want || s.slug === want);
  if (!selected.length) throw new Error(`Unknown surface: ${surfaceArg}`);
  return selected;
}

// Jobs are `<reviewerId>-sN-<slug>`. matrix: every reviewer x every selected surface.
// round-robin: with --surface all surface i goes to reviewer i % n (today's behaviour); a single surface goes to everyone.
export function assignJobs({ reviewers, surfaceArg = 'all', assign = 'matrix' }) {
  const surfaces = selectSurfaces(surfaceArg);
  const all = String(surfaceArg || 'all').toLowerCase() === 'all';
  const pairs = assign === 'round-robin' && all
    ? surfaces.map((surface, i) => [reviewers[i % reviewers.length], surface])
    : surfaces.flatMap((surface) => reviewers.map((reviewer) => [reviewer, surface]));
  // Order by reviewer queue so one active job per reviewer keeps today's per-provider ordering.
  return pairs.map(([reviewer, surface]) => ({ name: `${reviewer.id}-${surface.id}-${surface.slug}`, reviewer, surface }));
}

// OD-05 order. First usable one wins; `reason` says why it won or why none did.
export const ORCHESTRATOR_ORDER = ['cli:claude:opus', 'key:anthropic:claude-opus-5-5', 'openrouter:anthropic/claude-opus-5.5', 'key:zai:glm-5.3', 'scripted:judge'];

export function recommendedOrchestrator({ env = process.env, order = ORCHESTRATOR_ORDER } = {}) {
  const skipped = [];
  for (const spec of order) {
    const reviewer = parseReviewerSpec(spec);
    const verdict = families.check(reviewer);
    if (!verdict.ok) { skipped.push(`${spec}: ${verdict.reason}`); continue; }
    const family = families.get(reviewer.family);
    if (typeof family.available === 'function' && !family.available(reviewer, env)) { skipped.push(`${spec}: not available on this machine`); continue; }
    return { reviewer, spec, reason: skipped.length ? `first available in the OD-05 order (skipped ${skipped.length}: ${skipped.join('; ')})` : 'first choice of the OD-05 order is available' };
  }
  return { reviewer: null, spec: null, reason: `none available (${skipped.join('; ')})` };
}

// Legacy header labels: cli reviewers with unique providers print as their adapter names, as before W01.
export function headerLabels(reviewers) {
  const legacy = reviewers.every((r) => r.family === 'cli') && new Set(reviewers.map((r) => r.provider)).size === reviewers.length;
  const label = (r) => (legacy ? r.provider : r.id);
  return { agents: reviewers.map(label).join(' '), models: reviewers.map((r) => `${label(r)}=${r.model}`).join(' ') };
}

export function planProblems(reviewers) {
  return reviewers.flatMap((r) => { const v = families.check(r); return v.ok ? [] : [`${r.id}: ${v.reason}`]; });
}

export function renderPlan({ reviewers, assign, budgets, orchestrator, alternateJudge, warnings = [], surfaceArg = 'all', env = process.env }) {
  const jobs = assignJobs({ reviewers, surfaceArg, assign });
  const surfaces = selectSurfaces(surfaceArg);
  const pad = (v, n) => String(v).padEnd(n);
  const w = Math.max(8, ...reviewers.map((r) => r.id.length)) + 2;
  const lines = [`Reviewers (${reviewers.length}):`, `  ${pad('id', w)}${pad('family', 12)}${pad('vendor', 11)}${pad('model', 30)}installed`];
  for (const r of reviewers) {
    const v = families.check(r);
    let extra = '';
    if (v.ok && families.has(r.family)) {
      const names = families.envAllowlist(r);
      const transport = families.get(r.family).transport;
      if (names.length) extra += `  env ${names.join(',')}`;
      if (transport) extra += `  transport ${transport}`;
    }
    lines.push(`  ${pad(r.id, w)}${pad(r.family, 12)}${pad(r.vendor, 11)}${pad(r.model, 30)}${v.ok ? 'yes' : `no (${v.reason})`}${extra}`);
  }
  lines.push('', `Assignment: ${assign} (${jobs.length} job${jobs.length === 1 ? '' : 's'})`, `  ${pad('reviewer', w)}${surfaces.map((s) => pad(s.code, 4)).join('')}`);
  for (const r of reviewers) lines.push(`  ${pad(r.id, w)}${surfaces.map((s) => pad(jobs.some((j) => j.reviewer.id === r.id && j.surface.id === s.id) ? 'x' : '.', 4)).join('')}`);
  const worst = budgets.passes * (budgets.toolBudget + GRACE);
  lines.push('', `Budgets: passes ${budgets.passes}; tool budget ${budgets.toolBudget} per pass; debate rounds ${budgets.debate.rounds}; max cost ${budgets.maxCostUsd == null ? 'unset' : `$${budgets.maxCostUsd}`}`);
  lines.push(`Pass roles: ${passRoles(budgets.passes).join(', ')}. Worst case ${worst} calls.`);
  for (const r of reviewers) {
    const roles = passRoles(Math.min(budgets.passes, 2)).join(', ');
    const gate = r.family === 'cli' && r.provider === 'grok' ? 'bridge+acp+--max-turns' : r.family === 'cli' ? 'bridge+acp' : 'bridge+loop';
    lines.push(`${r.id}  ${budgets.passes} × ${budgets.toolBudget} (+${GRACE})  ${roles}  max ${worst} calls  gate: ${gate}`);
    if (r.provider === 'grok') lines.push(`--max-turns ${budgets.toolBudget + GRACE}`);
  }
  if (orchestrator === 'recommended') {
    const rec = recommendedOrchestrator({ env });
    lines.push(`Orchestrator: recommended -> ${rec.spec || 'none'}; ${rec.reason}. No phase uses it yet.`);
  } else if (orchestrator) lines.push(`Orchestrator: ${formatReviewerSpec(orchestrator)} (no phase uses it yet)`);
  else lines.push('Orchestrator: none');
  if (alternateJudge) lines.push(`Alternate judge: ${formatReviewerSpec(alternateJudge)}`);
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  const problems = planProblems(reviewers);
  if (orchestrator && orchestrator !== 'recommended') { const v = families.check(orchestrator); if (!v.ok) problems.push(`orchestrator ${orchestrator.id}: ${v.reason}`); }
  return { text: lines.join('\n'), problems, jobs };
}

function main() {
  const [command, file, surfaceArg] = process.argv.slice(2);
  if (!['header', 'plan'].includes(command) || !file) { process.stderr.write('usage: reviewer-plan.mjs header|plan <resolved.json> [surface]\n'); process.exit(2); }
  const resolved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (command === 'header') {
    const { agents, models } = headerLabels(resolved.reviewers);
    process.stdout.write(`${agents}\n${models}\n`);
    return;
  }
  const { text, problems } = renderPlan({ ...resolved, surfaceArg });
  process.stdout.write(`${text}\n`);
  if (problems.length) { for (const p of problems) process.stderr.write(`${p}\n`); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
