// A reviewer's usage from the W04 raw records (harness/usage/<id>/<surface>-pass-<k>.json). Without records it
// is one stub pass per surface with costSource "none", which the pages show as an unknown cost (—), not $0.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonOr } from './report-util-files.mjs';

const EMPTY = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, costSource: 'none' };

function stubPasses(surfaces, jobs) {
  return surfaces.map((surface, index) => {
    const job = jobs.find((row) => String(row.surface?.code || row.surface || '').toUpperCase() === surface);
    return { k: index + 1, index: index + 1, role: 'discover', ...EMPTY, stop: job?.failure ? 'unknown' : 'submitted', startedAt: '', endedAt: '', surface };
  });
}

function addRecord(bucket, row) {
  bucket.calls += Number(row.calls) || 0;
  bucket.tokensIn += Number(row.tokensIn) || 0;
  bucket.tokensOut += Number(row.tokensOut) || 0;
  bucket.cost += Number(row.cost) || 0;
  if (row.costSource === 'reported' || bucket.costSource === 'none') bucket.costSource = row.costSource || bucket.costSource;
  if (['cost', 'error', 'budget'].includes(row.stop)) bucket.stop = row.stop;
}

export function loadUsage(root, reviewerId, surfaces, jobs) {
  const dir = path.join(root, 'harness', 'usage', reviewerId);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : [];
  if (!files.length) return { passes: stubPasses(surfaces, jobs), totals: { ...EMPTY }, stub: true };
  const byPass = new Map();
  for (const name of files) {
    const row = readJsonOr(root, `harness/usage/${reviewerId}/${name}`, {});
    const key = row.k || row.index || 1;
    const bucket = byPass.get(key) || { k: key, index: key, role: row.role || 'discover', ...EMPTY, stop: row.stop || 'submitted', startedAt: row.startedAt || '', endedAt: row.endedAt || '' };
    addRecord(bucket, row);
    byPass.set(key, bucket);
  }
  const passes = [...byPass.values()].sort((a, b) => a.k - b.k);
  const totals = passes.reduce((sum, row) => ({
    calls: sum.calls + row.calls, tokensIn: sum.tokensIn + row.tokensIn, tokensOut: sum.tokensOut + row.tokensOut,
    cost: Math.round((sum.cost + row.cost) * 1000) / 1000, costSource: row.costSource !== 'none' ? row.costSource : sum.costSource,
  }), { ...EMPTY });
  return { passes, totals, stub: false };
}
