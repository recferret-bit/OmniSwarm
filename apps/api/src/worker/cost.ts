// Model cost of a request (W09-18): every attempt's reviewers/<id>/usage.json
// (packages/schemas/usage.schema.json: `totals.cost`, else the sum of `passes[].cost`), summed over all
// attempts of the request, because a retried run spent money too. Recorded into `request_cost` when the
// request is published or failed, before disk hygiene may remove the attempt dirs.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './classify.ts';

export interface RunCost { costUsd: number; reviewers: number }

function finite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The cost one usage.json reports, or null when the file is absent or not a usage record. */
export function usageCostUsd(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const totals = usage.totals as { cost?: unknown } | undefined;
  if (totals && totals.cost !== undefined) return finite(totals.cost);
  if (!Array.isArray(usage.passes)) return null;
  return usage.passes.reduce((sum: number, pass: { cost?: unknown }) => sum + finite(pass?.cost), 0);
}

/** Cost of one engine out dir. */
export function outDirCost(outDir: string): RunCost {
  const dir = path.join(outDir, 'reviewers');
  const result: RunCost = { costUsd: 0, reviewers: 0 };
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cost = usageCostUsd(readJson(path.join(dir, entry.name, 'usage.json')));
    if (cost === null) continue;
    result.costUsd += cost;
    result.reviewers += 1;
  }
  return result;
}

/** Cost of every attempt of a request under RUNS_ROOT; reviewers is the most any one attempt ran. */
export function requestCost(runsRoot: string, requestId: string): RunCost {
  const base = path.join(runsRoot, requestId);
  const total: RunCost = { costUsd: 0, reviewers: 0 };
  if (!fs.existsSync(base)) return total;
  for (const attempt of fs.readdirSync(base)) {
    const cost = outDirCost(path.join(base, attempt, 'report'));
    total.costUsd += cost.costUsd;
    total.reviewers = Math.max(total.reviewers, cost.reviewers);
  }
  return { costUsd: Math.round(total.costUsd * 1e6) / 1e6, reviewers: total.reviewers };
}
