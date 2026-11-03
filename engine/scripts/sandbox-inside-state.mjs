// Shared state of the in-container check run: the results file under /out, the time budget, and the
// directories whose dependency install succeeded (the local server may start only from one of those).
import fs from 'node:fs';
import path from 'node:path';

export const outDir = process.env.SANDBOX_OUT || '/out';
const budgetMs = Number(process.env.SANDBOX_BUDGET_MS || 45 * 60 * 1000);
const deadline = Date.now() + budgetMs;
const checks = [];
export const installed = new Set();

export function save(note) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'results.json');
  fs.writeFileSync(file, `${JSON.stringify({ checks, note: note || '' }, null, 2)}\n`);
  try { fs.chmodSync(file, 0o644); } catch { /* the report dir is already writable by the host */ }
}

export function put(id, result, detail) {
  const idx = checks.findIndex((row) => row.id === id);
  const row = { id, result, detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 700) };
  if (idx >= 0) checks[idx] = row;
  else checks.push(row);
  save();
}

export function timeLeft() {
  return deadline - Date.now();
}

export function publish(name, obj) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, `${JSON.stringify(obj)}\n`);
  try { fs.chmodSync(file, 0o644); } catch { /* the report dir is already writable by the host */ }
}
