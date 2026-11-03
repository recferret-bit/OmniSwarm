// Archive a committed pass so the next pass can submit a replacement, and write the raw usage row.
import fs from 'node:fs';
import path from 'node:path';
import { writeReportFile } from './report-files.mjs';
import { loadBudget, passKey } from './bridge-budget.mjs';

export function archivePassSubmission(root, name, passIndex) {
  const file = path.join(root, 'submissions', `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(file, path.join(root, 'submissions', `${name}-pass-${passIndex}.json`));
  fs.rmSync(file);
  return true;
}

export function usageRel(reviewerId, surface, pass) {
  const slug = String(surface || 's1').toLowerCase().replace(/^s([1-6]).*/, 's$1');
  return `harness/usage/${reviewerId}/${slug}-pass-${pass}.json`;
}

export function writePassUsage(root, { reviewerId, surface, pass, role, calls, tokensIn = 0, tokensOut = 0, cost = 0, costSource = 'none', stop, startedAt, endedAt, skipped = null }) {
  const row = {
    k: pass, index: pass, role, calls, tokensIn, tokensOut, cost, costSource, stop,
    startedAt, endedAt, ...(skipped ? { skipped } : {}),
  };
  const rel = usageRel(reviewerId, surface, pass);
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeReportFile(root, rel, `${JSON.stringify(row, null, 2)}\n`);
  return row;
}

export function passCalls(root, reviewerId, surface, pass) {
  const budget = loadBudget(root, reviewerId);
  return budget.passes[passKey(surface, pass)] || { calls: 0, filesRead: [], finalizeOnlyAt: null };
}

export function sumCost(usage) {
  return (usage || []).reduce((total, row) => total + (Number(row.cost) || 0), 0);
}
