#!/usr/bin/env node
// Assignment (matrix | round-robin), recommended orchestrator and the --plan text.
// ORCHESTRATION sections 1 and 4.5, OD-05.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRACE } from './bridge-budget.mjs';
import { families } from './reviewer-families.mjs';
import { grokMaxTurnsSupport } from './provider-cli.mjs';
import { passRoles } from './review-briefs.mjs';
import { formatReviewerSpec, parseReviewerSpec } from './reviewer-registry.mjs';
import { assignJobs, normalizeScope, selectSurfaces } from './reviewer-plan-assign.mjs';
import { DEFAULTS } from './run-config.mjs';

export { assignJobs, selectSurfaces };

// OD-05 order. First usable one wins; `reason` says why it won or why none did.
export const ORCHESTRATOR_ORDER = ['cli:claude:opus', 'key:anthropic:claude-opus-5-5', 'scripted:judge'];

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

// The judge for a cluster whose authors share the orchestrator's vendor, as pickJudge (debate-judge.mjs) picks it:
// the explicit alternate, else the first non-scripted run reviewer of another vendor (per cluster it also skips
// any vendor that wrote the finding). The scripted judge is the citation rules and never hands a cluster over.
export function alternateJudgeLine({ orchestrator, alternateJudge, reviewers }) {
  if (alternateJudge) return `Alternate judge: ${formatReviewerSpec(alternateJudge)}`;
  if (orchestrator.family === 'scripted') return 'Alternate judge: not used (the scripted judge applies the citation rules, not a vendor model)';
  const other = reviewers.find((r) => r.family !== 'scripted' && r.vendor !== orchestrator.vendor);
  return other
    ? `Alternate judge: ${formatReviewerSpec(other)} (default: first run reviewer of another vendor than ${orchestrator.vendor})`
    : `Alternate judge: none (no run reviewer of another vendor than ${orchestrator.vendor}; its clusters stay DISPUTED, no_independent_judge)`;
}

export function renderPlan({ reviewers, assign, budgets, orchestrator, alternateJudge, pipelineMode = 'full', concurrency = 1, warnings = [], surfaceArg = 'all', scope = 'full', env = process.env }) {
  const jobs = assignJobs({ reviewers, surfaceArg, assign, scope });
  const surfaces = selectSurfaces(surfaceArg, scope);
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
  const debate = { ...DEFAULTS.debate, ...(budgets.debate || {}) };
  lines.push('', `Budgets: passes ${budgets.passes}; tool budget ${budgets.toolBudget} per pass; debate rounds ${debate.rounds} (max 3); debate cluster cap ${debate.maxClusters}; debate tool budget ${debate.toolBudget} per turn; debate turn limit ${Math.round(debate.turnMs / 1000)}s; debate phase limit ${Math.round(debate.phaseMs / 60000)}min; max cost ${budgets.maxCostUsd == null ? 'unset' : `$${budgets.maxCostUsd} per reviewer (run-wide)`}`);
  lines.push(`Pass roles: ${passRoles(budgets.passes).join(', ')}. Worst case ${worst} calls.`);
  if ((pipelineMode && pipelineMode !== 'full') || (concurrency && concurrency > 1)) {
    const modeNote = pipelineMode === 'stage-1'
      ? 'Stage 1 only (no debates)'
      : pipelineMode === 'step-by-step'
        ? 'Step-by-step (Stage 1 + Frontier Orchestrator Advice; debates optional/iterative)'
        : 'Full run (Stage 1 + Frontier Advice + Debates)';
    lines.push(`Pipeline: ${pipelineMode || 'full'} — ${modeNote}; concurrency ${concurrency || 1}.`);
  }
  for (const r of reviewers) {
    const roles = passRoles(Math.min(budgets.passes, 2)).join(', ');
    const declaresMaxTurns = r.family === 'cli' && families.get('cli').providers[r.provider]?.maxTurnsFlag === true;
    const maxTurnsFlag = declaresMaxTurns && r.provider === 'grok' && grokMaxTurnsSupport(env);
    const gate = maxTurnsFlag ? 'bridge+acp+--max-turns' : r.family === 'cli' ? 'bridge+acp' : 'bridge+loop';
    lines.push(`${r.id}  ${budgets.passes} × ${budgets.toolBudget} (+${GRACE})  ${roles}  max ${worst} calls  gate: ${gate}`);
    if (maxTurnsFlag) lines.push(`--max-turns ${budgets.toolBudget + GRACE}`);
  }
  let judge = orchestrator;
  if (orchestrator === 'recommended') {
    const rec = recommendedOrchestrator({ env });
    judge = rec.reviewer;
    lines.push(`Orchestrator: recommended -> ${rec.spec || 'none'}; ${rec.reason}. It runs the debate and general-review phases.`);
  } else if (orchestrator) lines.push(`Orchestrator: ${formatReviewerSpec(orchestrator)} (runs the debate and general-review phases)`);
  else lines.push('Orchestrator: none (no debate or general review)');
  if (judge) lines.push(alternateJudgeLine({ orchestrator: judge, alternateJudge, reviewers }));
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  const problems = planProblems(reviewers);
  if (orchestrator && orchestrator !== 'recommended') { const v = families.check(orchestrator); if (!v.ok) problems.push(`orchestrator ${orchestrator.id}: ${v.reason}`); }
  return { text: lines.join('\n'), problems, jobs };
}

function main() {
  const [command, file, surfaceArg, scopeArg] = process.argv.slice(2);
  if (!['header', 'plan'].includes(command) || !file) { process.stderr.write('usage: reviewer-plan.mjs header|plan <resolved.json> [surface] [scope]\n'); process.exit(2); }
  const resolved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (command === 'header') {
    const { agents, models } = headerLabels(resolved.reviewers);
    process.stdout.write(`${agents}\n${models}\n`);
    return;
  }
  let scope;
  try { scope = normalizeScope(scopeArg); selectSurfaces(surfaceArg, scope); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  const { text, problems } = renderPlan({ ...resolved, surfaceArg, scope });
  process.stdout.write(`${text}\n`);
  if (problems.length) { for (const p of problems) process.stderr.write(`${p}\n`); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
