// findings-by-model.html before v2: each adapter's own raw findings, counted by severity. A cluster in
// findings-and-scores.json is shared, so it is the wrong count here.
import { adapterOf } from './report-contract-auditor.mjs';
import { esc, severityLevel } from './report-cards.mjs';
import { reviewersOfMeta } from './reviewer-registry.mjs';

export const SEVERITY_LEVELS = ['high', 'medium', 'low', 'info'];

function bucketsOf({ reports, meta }) {
  const buckets = new Map();
  const ensure = (key) => {
    if (!buckets.has(key)) buckets.set(key, { key, counts: {} });
    return buckets.get(key);
  };
  for (const { name, data: items } of reports) {
    const row = ensure(adapterOf(name));
    for (const item of items) {
      if (!item || typeof item !== 'object' || item.verified_safe) continue;
      if (!item.severity && !item.title) continue;
      const level = severityLevel(item.severity);
      if (level) row.counts[level] = (row.counts[level] || 0) + 1;
    }
  }
  if (Array.isArray(meta.agents)) for (const agent of meta.agents) ensure(String(agent).toLowerCase());
  return buckets;
}

export function loadModelRows({ reports, meta, health }) {
  const buckets = bucketsOf({ reports, meta });
  const extra = [];
  for (const row of buckets.values()) for (const level of Object.keys(row.counts)) if (!SEVERITY_LEVELS.includes(level) && !extra.includes(level)) extra.push(level);
  const levels = [...SEVERITY_LEVELS, ...extra.sort()];
  const reviewers = reviewersOfMeta(meta);
  const order = reviewers.map((r) => r.id); // the run's reviewer order
  const rank = (key) => (order.includes(key) ? order.indexOf(key) : Infinity);
  const rows = [...buckets.values()].map((row) => {
    const reviewer = reviewers.find((r) => r.id === row.key);
    const slug = reviewer ? `${reviewer.id} (${reviewer.family})` : meta.models && meta.models[row.key];
    const total = levels.reduce((n, level) => n + (row.counts[level] || 0), 0);
    const available = reports.some((r) => adapterOf(r.name) === row.key);
    const expectedOutputs = (health.expected || []).filter((name) => adapterOf(name) === row.key).length;
    const acceptedOutputs = (health.accepted || []).filter((name) => adapterOf(name) === row.key).length;
    return { ...row, label: slug || row.key, available, total, expectedOutputs, acceptedOutputs };
  }).sort((a, b) => (rank(a.key) === rank(b.key) ? a.key.localeCompare(b.key) : rank(a.key) - rank(b.key)));
  return { rows, levels };
}

const outputs = (row) => (row.available ? `${row.acceptedOutputs}/${row.expectedOutputs} outputs received` : 'no valid outputs');

export function modelChart({ rows, levels }) {
  if (!rows.length) return '<p class="note">No auditor findings were filed.</p>';
  const max = Math.max(1, ...rows.map((r) => r.total));
  return rows.map((row) => {
    const width = row.total ? (row.total / max) * 100 : 0;
    const segs = levels.map((level) => {
      const n = row.counts[level] || 0;
      if (!n) return '';
      return `<span class="seg seg-${SEVERITY_LEVELS.includes(level) ? level : 'other'}" style="width:${((n / row.total) * 100).toFixed(2)}%"></span>`;
    }).join('');
    return `<div class="chart-row">
      <div class="chart-name">${esc(row.label)}<div class="note">${outputs(row)}</div></div>
      <div class="chart-track"><div class="chart-fill" style="width:${width.toFixed(2)}%">${segs}</div></div>
      <div class="chart-total">${row.total}</div>
    </div>`;
  }).join('');
}

export function modelTable({ rows, levels }) {
  const head = levels.map((level) => `<th>${esc(level)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = levels.map((level) => {
      const n = row.counts[level] || 0;
      const cls = !n ? 'zero' : (level === 'high' ? 'high' : '');
      return `<td${cls ? ` class="${cls}"` : ''}>${n}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(row.label)}<div class="note">${outputs(row)}</div></th>${cells}<td>${row.total}</td></tr>`;
  }).join('');
  const totals = levels.map((level) => {
    const n = rows.reduce((sum, row) => sum + (row.counts[level] || 0), 0);
    return `<td${level === 'high' && n ? ' class="high"' : ''}>${n}</td>`;
  }).join('');
  const grand = rows.reduce((sum, row) => sum + row.total, 0);
  return `<table>
    <thead><tr><th>Model</th>${head}<th>Total</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">All models</th>${totals}<td>${grand}</td></tr></tfoot>
  </table>`;
}
