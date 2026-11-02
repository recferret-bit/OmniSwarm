// Shared pieces of the audit HTML report. generate-html-report.mjs and the per-reviewer pages both use these
// so a reviewer page keeps today's cards, pills and page shell.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function severityLevel(raw) {
  const token = String(raw ?? '').toLowerCase().match(/[a-z]+/)?.[0] || '';
  if (token === 'critical') return 'high';
  return token;
}

export const toneOf = (level) => ({ critical: 'red', high: 'red', medium: 'orange', low: 'blue', info: 'blue' })[level] || 'blue';

export function findingCard(f, index, { originalClaims, mergeBadges, block, citations, disclosure, prose }) {
  const originals = (f.claimIds || []).map((id) => originalClaims.get(id)).filter(Boolean);
  const primary = originals[0] || f.findings?.[0] || {};
  const impact = primary.impact || 'No impact statement was provided by the auditor.';
  const status = String(f.status || '').replace(/_/g, ' ').toLowerCase();
  const reviews = Array.isArray(f.reviews) ? f.reviews : [];
  const technical = originals.length ? originals : [primary];
  return `<details class="finding ${toneOf(f.severity)}" data-severity="${esc(severityLevel(f.severity))}" data-surface="${esc(String(f.surface).toUpperCase().slice(0, 2))}">
    <summary><span class="finding-index">${String(index + 1).padStart(2, '0')}</span><div>
      <div class="finding-tags"><span class="pill ${toneOf(f.severity)}">${esc(f.severity)}</span><span class="meta-label">${esc(f.surface)}</span><span class="pill">${esc(status)}</span>${mergeBadges(f)}</div>
      <h3>${esc(f.title)}</h3><p class="finding-preview">${esc(impact)}</p>
    </div><span class="expand-icon" aria-hidden="true"></span></summary>
    <div class="finding-body">
      <div class="finding-priority"><strong>Priority ${esc(f.score)}</strong><span>Heuristic · not a probability</span><span>${esc((f.auditors || f.vendors || []).join(' · '))}</span></div>
      <div class="action-grid">${block('Impact', impact, 'red')}${block('Recommended fix', f.remediation || primary.fix || 'No fix was provided.', 'green')}</div>
      ${disclosure('Source analysis & validation', technical.map((claim, i) => `${technical.length > 1 ? `<p class="meta-label">Claim ${i + 1} · ${esc(f.claimIds?.[i] || '')}</p>` : ''}${block('Preconditions', claim.preconditions)}${block('Analysis', claim.analysis)}${block('Validation & limits', claim.validation)}${claim.attack?.length ? block('Historical review notes', claim.attack.join('\n\n')) : ''}`).join(''))}
      ${f.locations?.length ? disclosure(`Affected files · ${f.locations.length}`, citations(f.locations)) : ''}
      ${reviews.length ? disclosure(`Peer reviews · ${reviews.length}`, `<p class="note">Model statements; no independent reproduction evidence.</p>${reviews.map((r) => `<div class="review"><span class="pill ${r.verdict === 'refuted' ? 'red' : r.verdict === 'upheld' ? 'green' : 'orange'}">${esc(r.reviewer)} · ${esc(r.verdict)}</span><div class="prose">${prose(r.reason)}</div>${citations(r.evidence)}</div>`).join('')}`) : ''}
      ${f.pocs?.length ? disclosure('Historical regression material · unexecuted', `<pre>${esc(f.pocs.join('\n'))}</pre>`) : ''}
    </div></details>`;
}

export function pageDocument({ body, modelPage = false, policy, targetName, styles, railHtml, meta, nonce, browserScript, dateLabel, expected, extraCss = '', extraScript = '', styleNonce = false }) {
  const styleOpen = styleNonce ? `<style nonce="${nonce}">` : '<style>';
  const extra = extraScript ? `<script nonce="${nonce}">${extraScript}</script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${esc(policy)}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(targetName)} — ${modelPage ? 'Findings by model' : 'Security audit'}</title>${styleOpen}${styles}${extraCss}</style></head>
    <body><a class="skip-link" href="#main">Skip to report</a>${railHtml}<div class="workspace">
    ${meta.demo ? '<p style="margin:0;padding:10px 16px;background:#111;color:#fff;font-weight:700">DEMO — not a review</p>' : ''}
    <div class="topbar"><span><b>Security intelligence</b> / ${modelPage ? 'Model comparison' : 'Audit overview'}</span><span class="topbar-detail">${esc(dateLabel)} &nbsp; / &nbsp; ${expected} review assignments</span></div>
    <main id="main">${body}<footer class="footer"><span>Audit / Core · Source security review</span><span>Model assertions · Unverified provenance</span><span>${esc(meta.commit || dateLabel)}</span></footer></main></div>
    ${!modelPage ? `<script nonce="${nonce}">${browserScript}</script>` : ''}${extra}</body></html>`;
}
