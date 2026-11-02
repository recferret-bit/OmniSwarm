// Per-reviewer, per-pass bridge call budget. Submit tools are never counted and never blocked.
// Inspection stops at N; the next 3 calls are finalize-only; the one after that is an error.
import fs from 'node:fs';
import path from 'node:path';
import { readReportJson, writeReportFile } from './report-contract.mjs';

export const GRACE = 3;
const SUBMIT = new Set(['submit_audit_report', 'submit_crosscheck_report']);
const READS = new Set(['read_file', 'search_code']);

export function passKey(surface, pass) {
  return `${String(surface || 's1').toLowerCase()}:${pass}`;
}

export function budgetFile(reviewerId) {
  return `harness/budget-${reviewerId}.json`;
}

export function emptyBudget(reviewerId) {
  return { version: 1, reviewer: reviewerId, passes: {} };
}

export function loadBudget(reportDir, reviewerId) {
  try { return readReportJson(reportDir, budgetFile(reviewerId)); }
  catch { return emptyBudget(reviewerId); }
}

export function saveBudget(reportDir, budget) {
  fs.mkdirSync(path.join(reportDir, 'harness'), { recursive: true });
  writeReportFile(reportDir, budgetFile(budget.reviewer), `${JSON.stringify(budget, null, 2)}\n`);
}

export function decideCall(record, { tool, path, toolBudget, grace = GRACE }) {
  const next = { calls: record.calls || 0, graceUsed: record.graceUsed || 0, filesRead: [...(record.filesRead || [])], finalizeOnlyAt: record.finalizeOnlyAt || null };
  if (SUBMIT.has(tool)) return { allow: true, record: next };
  if (next.calls >= toolBudget) {
    if (next.graceUsed >= grace) return { allow: false, error: 'budget_exhausted', record: next };
    const left = grace - next.graceUsed;
    next.graceUsed += 1;
    next.finalizeOnlyAt = next.finalizeOnlyAt || new Date().toISOString();
    return { allow: false, text: `budget exhausted: call submit_audit_report now (${left} calls left)`, finalize: true, record: next };
  }
  next.calls += 1;
  if (READS.has(tool) && path && !next.filesRead.includes(path)) next.filesRead.push(path);
  if (next.calls === toolBudget) next.finalizeOnlyAt = next.finalizeOnlyAt || new Date().toISOString();
  return { allow: true, record: next };
}

export function createBeforeCall({ reportDir, reviewerId, surface, pass, toolBudget }) {
  return async (ctx, name) => {
    const budget = loadBudget(reportDir, reviewerId);
    const key = passKey(surface, pass);
    const current = budget.passes[key] || { calls: 0, filesRead: [], finalizeOnlyAt: null };
    const path = ctx.pendingArgs?.path;
    const decision = decideCall(current, { tool: name, path, toolBudget });
    budget.passes[key] = decision.record;
    saveBudget(reportDir, budget);
    if (decision.finalize || decision.record.calls >= toolBudget) ctx.finalizeOnly = true;
    if (decision.error) {
      ctx.budgetExhausted = true;
      throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted' });
    }
    if (decision.text) return { text: decision.text };
    return null;
  };
}

export function attachBudget(ctx) {
  if (!ctx?.reportDir || !ctx.agent || ctx.role === 'verification') return ctx;
  let toolBudget = Number(ctx.toolBudget) || 0;
  if (!toolBudget) {
    try { toolBudget = Number(readReportJson(ctx.reportDir, 'harness/reviewers.json').budgets?.toolBudget) || 40; }
    catch { toolBudget = 40; }
  }
  const pass = Number(ctx.pass) || 1;
  ctx.budget = true;
  ctx.beforeCall = createBeforeCall({ reportDir: ctx.reportDir, reviewerId: ctx.agent, surface: ctx.surface, pass, toolBudget });
  return ctx;
}
