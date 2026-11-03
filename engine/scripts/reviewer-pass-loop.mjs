// The one pass loop (W04-05). The Docker orchestrator and the host runner both drive a job's passes through
// runReviewerPasses; only `runPass` (how one turn reaches a session) differs between them.
// Per pass: archive the previous pass's submission, brief with the files still unread, run the turn, write
// the raw usage row, and record a health row. A cost stop skips the reviewer's later passes. A failed pass
// ends the job's loop and restores the last committed pass, so earlier work is never thrown away.
import fs from 'node:fs';
import path from 'node:path';
import { readReportJson } from './report-files.mjs';
import { archivePassSubmission, passCalls, writePassUsage } from './review-passes.mjs';
import { passRole, renderBrief } from './review-briefs.mjs';

const surfaceSlug = (surface) => String(surface || 's1').toLowerCase();
const submissionFile = (out, name, pass) => path.join(out, 'submissions', pass ? `${name}-pass-${pass}.json` : `${name}.json`);

// What the API shim recorded for the turn (usage rows, stop, served model). CLI sessions have none.
export function readAgentSession(directory) {
  try { return readReportJson(path.join(directory, 'workspace'), 'api-session.json'); }
  catch { return {}; }
}

// If pass k left no canonical submission, the last archived pass becomes canonical again.
export function restoreLastPass(out, name, pass) {
  const canonical = submissionFile(out, name);
  if (fs.existsSync(canonical)) return false;
  for (let k = pass - 1; k >= 1; k--) {
    if (!fs.existsSync(submissionFile(out, name, k))) continue;
    fs.copyFileSync(submissionFile(out, name, k), canonical);
    return true;
  }
  return false;
}

function passStop({ result, agent, submitted, calls, toolBudget }) {
  const reported = result.stop || agent.stop || null;
  let stop = reported === 'cost' ? 'cost' : reported === 'budget' ? 'budget' : submitted ? (calls >= toolBudget ? 'budget' : 'submitted') : 'error';
  if (result.code !== 0 && stop !== 'cost') stop = 'error';
  return stop;
}

function usageTotals(rows) {
  const sum = (key) => rows.reduce((n, row) => n + (Number(row[key]) || 0), 0);
  const costSource = rows.some((row) => row.costSource === 'reported') ? 'reported' : rows.some((row) => row.costSource === 'estimated') ? 'estimated' : 'none';
  return { tokensIn: sum('prompt_tokens'), tokensOut: sum('completion_tokens'), cost: sum('cost'), costSource };
}

function recordPass({ out, name, reviewerId, surface, pass, toolBudget, result, startedAt }) {
  const record = passCalls(out, reviewerId, surface, pass);
  const agent = result.directory ? readAgentSession(result.directory) : {};
  const submitted = fs.existsSync(submissionFile(out, name));
  const stop = passStop({ result, agent, submitted, calls: record.calls, toolBudget });
  const rows = Array.isArray(agent.usage) ? agent.usage : [];
  writePassUsage(out, { reviewerId, surface: surfaceSlug(surface), pass, role: passRole(pass), calls: record.calls, stop, startedAt, endedAt: new Date().toISOString(), ...usageTotals(rows) });
  return { stop, submitted, servedModel: typeof agent.servedModel === 'string' ? agent.servedModel : null };
}

function skipPass({ out, reviewerId, surface, pass }) {
  const at = new Date().toISOString();
  writePassUsage(out, { reviewerId, surface: surfaceSlug(surface), pass, role: passRole(pass), calls: 0, stop: 'cost', costSource: 'none', startedAt: at, endedAt: at, skipped: 'cost_ceiling' });
}

// runPass({ pass, brief, resume }) -> session result ({code, failureReason?, stop?, directory?, stopReason?}).
// A result with stopReason 'reused' is a committed job from --resume-from: nothing more to run.
// Without budgets (requests from before W04) the job is one plain turn.
export async function runReviewerPasses({ out, name, reviewerId, surface, budgets, files = [], startPass = 1, ceilings = new Set(), runPass }) {
  if (!budgets) {
    const result = await runPass({ pass: null, brief: '', resume: false });
    return { passesCompleted: result.code === 0 ? 1 : 0, result, health: [], servedModel: null };
  }
  const { passes, toolBudget } = budgets;
  const health = [];
  let completed = startPass - 1;
  let result = { code: 0, skipped: true };
  let servedModel = null;
  for (let pass = startPass; pass <= passes; pass++) {
    if (ceilings.has(reviewerId)) { skipPass({ out, reviewerId, surface, pass }); continue; }
    if (pass > startPass) archivePassSubmission(out, name, pass - 1);
    const brief = renderBrief({ pass, passes, toolBudget, filesRead: passCalls(out, reviewerId, surface, pass - 1).filesRead || [], files });
    const startedAt = new Date().toISOString();
    result = await runPass({ pass, brief, resume: pass > 1 });
    if (result.stopReason === 'reused') return { passesCompleted: passes, result, health, servedModel };
    const outcome = recordPass({ out, name, reviewerId, surface, pass, toolBudget, result, startedAt });
    servedModel = outcome.servedModel || servedModel;
    health.push({ reviewer: reviewerId, job: name, pass, stop: outcome.stop, submitted: outcome.submitted });
    if (outcome.stop === 'cost') ceilings.add(reviewerId);
    if (result.code !== 0 && outcome.stop !== 'cost') { restoreLastPass(out, name, pass); break; }
    completed = pass;
  }
  return { passesCompleted: completed, result, health, servedModel };
}
