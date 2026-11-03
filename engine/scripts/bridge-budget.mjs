// Per-reviewer, per-pass bridge call budget. Submit tools are never counted and never blocked.
// Inspection stops at N; the next 3 calls are finalize-only; the one after that is an error and the pass
// record says `exhausted`. One reviewer can run several surfaces at once, so every bridge serializes its
// read-modify-write of harness/budget-<reviewer>.json with a cross-process lock.
import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './fs-lock.mjs';
import { readReportJson, writeReportFile } from './report-files.mjs';

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
  const next = { calls: record.calls || 0, graceUsed: record.graceUsed || 0, filesRead: [...(record.filesRead || [])], finalizeOnlyAt: record.finalizeOnlyAt || null, ...(record.exhaustedAt ? { exhausted: true, exhaustedAt: record.exhaustedAt } : {}) };
  if (SUBMIT.has(tool)) return { allow: true, record: next };
  if (next.calls >= toolBudget) {
    if (next.graceUsed >= grace) return { allow: false, error: 'budget_exhausted', record: { ...next, exhausted: true, exhaustedAt: next.exhaustedAt || new Date().toISOString() } };
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

export function budgetLockFile(reportDir, reviewerId) {
  return path.join(fs.realpathSync(path.join(reportDir, 'harness')), `${path.basename(budgetFile(reviewerId))}.lock`);
}

// The decision is taken on the freshest saved record, under the lock, so parallel surfaces never lose a count.
export function createBeforeCall({ reportDir, reviewerId, surface, pass, toolBudget }) {
  const key = passKey(surface, pass);
  return async (ctx, name) => {
    fs.mkdirSync(path.join(reportDir, 'harness'), { recursive: true });
    const decision = await withFileLock(budgetLockFile(reportDir, reviewerId), () => {
      const budget = loadBudget(reportDir, reviewerId);
      const current = budget.passes[key] || { calls: 0, filesRead: [], finalizeOnlyAt: null };
      const verdict = decideCall(current, { tool: name, path: ctx.pendingArgs?.path, toolBudget });
      budget.passes[key] = verdict.record;
      saveBudget(reportDir, budget);
      return verdict;
    });
    if (decision.error) throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted' });
    return decision.text ? { text: decision.text } : null;
  };
}

export function attachBudget(ctx) {
  // Debater and orchestrator sessions are bounded per session by debate-bridge.mjs, not by a review pass.
  if (!ctx?.reportDir || !ctx.agent || ['verification', 'debater', 'orchestrator'].includes(ctx.role)) return ctx;
  let toolBudget = Number(ctx.toolBudget) || 0;
  if (!toolBudget) {
    try { toolBudget = Number(readReportJson(ctx.reportDir, 'harness/reviewers.json').budgets?.toolBudget) || 40; }
    catch { toolBudget = 40; }
  }
  const pass = Number(ctx.pass) || 1;
  ctx.beforeCall = createBeforeCall({ reportDir: ctx.reportDir, reviewerId: ctx.agent, surface: ctx.surface, pass, toolBudget });
  return ctx;
}
