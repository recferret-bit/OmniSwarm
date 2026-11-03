// One directory per attempt: RUNS_ROOT/<requestId>/<attempt>/{report/, worker.log, result.json}.
// A retry never reuses an out dir (the engine refuses a non-empty --out), and a finished attempt that
// a crash interrupted before publishing can be published instead of running the engine again.
import fs from 'node:fs';
import path from 'node:path';
import type { EngineRunResult } from '../engine/port.ts';
import { classify, readJson } from './classify.ts';

export interface AttemptDirs { root: string; out: string; log: string; result: string }

export function attemptDirs(runsRoot: string, requestId: string, attempt: number): AttemptDirs {
  let root = path.join(runsRoot, requestId, String(attempt));
  for (let n = 1; fs.existsSync(root); n++) root = path.join(runsRoot, requestId, `${attempt}.${n}`);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return { root, out: path.join(root, 'report'), log: path.join(root, 'worker.log'), result: path.join(root, 'result.json') };
}

export function recordResult(dirs: AttemptDirs, result: EngineRunResult): void {
  fs.writeFileSync(dirs.result, `${JSON.stringify(result)}\n`, { mode: 0o600 });
}

/** The out dir of an earlier attempt whose engine run completed, if any (newest first). */
export function completedAttempt(runsRoot: string, requestId: string): { out: string; incomplete: boolean } | null {
  const base = path.join(runsRoot, requestId);
  if (!fs.existsSync(base)) return null;
  const attempts = fs.readdirSync(base).sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
  for (const name of attempts) {
    const result = readJson(path.join(base, name, 'result.json')) as EngineRunResult | null;
    if (!result) continue;
    const out = path.join(base, name, 'report');
    const outcome = classify(result, out);
    if (outcome.kind === 'completed') return { out, incomplete: outcome.incomplete };
  }
  return null;
}

/** Total model cost of a run from reviewers/<id>/usage.json (0 when a reviewer reports none). */
export function runCostUsd(outDir: string): number {
  const dir = path.join(outDir, 'reviewers');
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const cost = Number(readJson(path.join(dir, name, 'usage.json'))?.costUsd ?? 0);
    if (Number.isFinite(cost) && cost > 0) total += cost;
  }
  return Math.round(total * 1e6) / 1e6;
}
