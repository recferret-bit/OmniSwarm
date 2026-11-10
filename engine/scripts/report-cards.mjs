// Shared pieces of the audit HTML report. generate-html-report.mjs and the per-reviewer pages both use these
// so a reviewer page keeps today's cards, pills, toolbar and page shell.
// Everything an auditor wrote is untrusted (it was derived from a third-party repo), so it is HTML-escaped.
import crypto from 'node:crypto';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function severityLevel(raw) {
  const token = String(raw ?? '').toLowerCase().match(/[a-z]+/)?.[0] || '';
  if (token === 'critical') return 'high';
  return token;
}

const toneOf = (level) => ({ critical: 'red', high: 'red', medium: 'orange', low: 'blue', info: 'blue' })[level] || 'blue';

// Format only inert text; source Markdown never supplies links, HTML or attributes.
export function inline(value) {
  return esc(value).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

export function prose(value) {
  return String(value || '').split(/(```[\s\S]*?```)/g).map((part) => {
    if (part.startsWith('```')) return `<pre><code>${esc(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`;
    return part.split(/\n\s*\n/).filter(Boolean).map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
      if (lines.every((line) => /^\s*\d+\. /.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\. /, ''))}</li>`).join('')}</ol>`;
      return `<p>${inline(block)}</p>`;
    }).join('');
  }).join('');
}

export const block = (title, text, tone = '') => (text ? `<div class="content-block ${tone}"><h4>${esc(title)}</h4><div class="prose">${prose(text)}</div></div>` : '');
export const citations = (items) => (items?.length ? `<div class="citations">${items.map((item) => `<code>${esc(item)}</code>`).join('')}</div>` : '');
export const disclosure = (title, body) => `<details class="disclosure"><summary>${esc(title)}</summary>${body}</details>`;

// Merged clusters show how many auditors agreed and where their severities differed.
function mergeBadges(f) {
  const out = [];
  if ((f.claimIds || []).length > 1) out.push(`<span class="pill" title="Claims merged by shared root cause">${f.claimIds.length} claims · ${f.auditorCount || 1} auditor${f.auditorCount > 1 ? 's' : ''}</span>`);
  if ((f.severities || []).length > 1) out.push(`<span class="pill orange" title="Auditors rated this issue differently; the highest rating is used">severity ${esc(f.severities.join(' / '))}</span>`);
  if (f.compound) out.push('<span class="pill orange" title="Title lists several defects; review claim by claim">bundled claim</span>');
  return out.join('');
}

// Scored clusters retain only a short impact. Recover the full analysis from the accepted claims.
export function claimIndex(reports) {
  const map = new Map();
  for (const report of reports) report.data.filter((item) => item.title && !item.verified_safe).forEach((item, index) => map.set(`${report.name}#${index}`, item));
  return map;
}

// The status pill: the debate's final status when there is one (statusPill from the v2 registry), else the
// peer-review status as plain text, exactly as before v2.
function statusTag(f, statusPill) {
  return f.finalStatus && statusPill ? statusPill(f.finalStatus) : `<span class="pill">${esc(String(f.status || '').replace(/_/g, ' ').toLowerCase())}</span>`;
}

// f: a findings-and-scores row. opts: {originalClaims, v2: {statusPill, debate(f)} | null}.
export function findingCard(f, index, { originalClaims = new Map(), v2 = null } = {}) {
  const originals = (f.claimIds || []).map((id) => originalClaims.get(id)).filter(Boolean);
  const primary = originals[0] || f.findings?.[0] || {};
  const impact = primary.impact || 'No impact statement was provided by the auditor.';
  const reviews = Array.isArray(f.reviews) ? f.reviews : [];
  const technical = originals.length ? originals : [primary];
  const anchor = v2 ? ` id="finding-${esc(f.debateClusterId || f.clusterId || '')}" data-reviewers="${esc((f.auditors || []).join(' '))}" data-status="${esc(f.finalStatus || f.status || '')}"` : '';
  return `<details${anchor} class="finding ${toneOf(f.severity)}" data-severity="${esc(severityLevel(f.severity))}" data-surface="${esc(String(f.surface).toUpperCase().slice(0, 2))}"${f.layer ? ` data-layer="${esc(f.layer)}"` : ''}>
    <summary><span class="finding-index">${String(index + 1).padStart(2, '0')}</span><div>
      <div class="finding-tags"><span class="pill ${toneOf(f.severity)}">${esc(f.severity)}</span><span class="meta-label">${esc(f.surface)}</span>${f.layer ? `<span class="meta-label">${esc(f.layer)}</span>` : ''}${statusTag(f, v2?.statusPill)}${mergeBadges(f)}</div>
      <h3>${esc(f.title)}</h3><p class="finding-preview">${esc(impact)}</p>
    </div><span class="expand-icon" aria-hidden="true"></span></summary>
    <div class="finding-body">
      <div class="finding-priority"><strong>Priority ${esc(f.score)}</strong><span>Heuristic · not a probability</span><span>${esc((f.auditors || f.vendors || []).join(' · '))}</span></div>
      <div class="action-grid">${block('Impact', impact, 'red')}${block('Recommended fix', f.remediation || primary.fix || 'No fix was provided.', 'green')}</div>
      ${disclosure('Source analysis & validation', technical.map((claim, i) => `${technical.length > 1 ? `<p class="meta-label">Claim ${i + 1} · ${esc(f.claimIds?.[i] || '')}</p>` : ''}${block('Preconditions', claim.preconditions)}${block('Analysis', claim.analysis)}${block('Validation & limits', claim.validation)}${claim.attack?.length ? block('Historical review notes', claim.attack.join('\n\n')) : ''}`).join(''))}
      ${f.locations?.length ? disclosure(`Affected files · ${f.locations.length}`, citations(f.locations)) : ''}
      ${reviews.length ? disclosure(`Peer reviews · ${reviews.length}`, `<p class="note">Model statements; no independent reproduction evidence.</p>${reviews.map((r) => `<div class="review"><span class="pill ${r.verdict === 'refuted' ? 'red' : r.verdict === 'upheld' ? 'green' : 'orange'}">${esc(r.reviewer)} · ${esc(r.verdict)}</span><div class="prose">${prose(r.reason)}</div>${citations(r.evidence)}</div>`).join('')}`) : ''}
      ${f.pocs?.length ? disclosure('Historical regression material · unexecuted', `<pre>${esc(f.pocs.join('\n'))}</pre>`) : ''}
    ${v2?.debate?.(f) || ''}</div></details>`;
}

// The severity filter, optional extra controls (status chips, reviewer select) and the search box that the
// browser script (report-cards-browser.mjs) drives.
export function findingsToolbar(counts, extra = '') {
  const buttons = [['all', 'All', counts.total], ['high', 'High+', counts.high], ['medium', 'Medium', counts.medium], ['low', 'Low + info', counts.low + counts.info]]
    .map(([key, label, n]) => `<button type="button" class="filter-btn${key === 'all' ? ' active' : ''}" data-filter="${key}" aria-pressed="${key === 'all'}">${label}<span>${n}</span></button>`).join('');
  return `<div class="toolbar"><div class="filter-group" role="group" aria-label="Filter by severity">
      ${buttons}
    </div>${extra}<label class="search-wrap"><span aria-hidden="true">⌕</span><input type="search" id="search-box" aria-label="Search findings, files, fixes and evidence" placeholder="Search findings, files, fixes…"></label></div>
    <div class="list-caption"><span id="results-count" role="status" aria-live="polite">${counts.total} / ${counts.total} findings</span><button type="button" id="reset-filters" class="text-button" hidden>Clear filters</button><button type="button" id="expand-all" class="text-button">Expand findings</button></div>`;
}

export function severityCounts(rows) {
  const level = (row) => severityLevel(row.severity);
  return { total: rows.length, high: rows.filter((r) => level(r) === 'high').length, medium: rows.filter((r) => level(r) === 'medium').length, low: rows.filter((r) => level(r) === 'low').length, info: rows.filter((r) => level(r) === 'info').length };
}

export const newNonce = () => crypto.randomBytes(24).toString('base64');
export const cspPolicy = (nonce) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;

export function pageDocument({ body, modelPage = false, policy, targetName, styles, railHtml, meta, nonce, browserScript, dateLabel, expected, extraCss = '', styleNonce = false }) {
  const styleOpen = styleNonce ? `<style nonce="${nonce}">` : '<style>';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${esc(policy)}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(targetName)} — ${modelPage ? 'Findings by model' : 'Security audit'}</title>${styleOpen}${styles}${extraCss}</style></head>
    <body><a class="skip-link" href="#main">Skip to report</a>${railHtml}<div class="workspace">
    ${meta.demo ? '<p style="margin:0;padding:10px 16px;background:#111;color:#fff;font-weight:700">DEMO — not a review</p>' : ''}
    <div class="topbar"><span><b>Security intelligence</b> / ${modelPage ? 'Model comparison' : 'Audit overview'}</span><span class="topbar-detail">${esc(dateLabel)} &nbsp; / &nbsp; ${expected} review assignments</span></div>
    <main id="main">${body}<footer class="footer"><span>Audit / Core · Source security review</span><span>Model assertions · Unverified provenance</span><span>${esc(meta.commit || dateLabel)}</span></footer></main></div>
    ${browserScript ? `<script nonce="${nonce}">${browserScript}</script>` : ''}</body></html>`;
}
