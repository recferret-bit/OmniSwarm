// Rail 06: general-review.md as inert markup, then coverage, open disagreements, methodology and one
// contribution row per reviewer. Links are kept only when they point inside the page.
import { esc } from './report-cards.mjs';
import { DISCLAIMER } from './debate-general-review.mjs';

function markdownBlock(block) {
  const lines = block.split('\n');
  if (lines.every((line) => /^\s*\|.*\|\s*$/.test(line))) {
    const rows = lines.filter((line) => !/^\s*\|?\s*-+/.test(line));
    return `<table>${rows.map((line) => `<tr>${line.split('|').slice(1, -1).map((cell) => `<td>${esc(cell.trim())}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  const local = (text) => esc(text).replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/gi, '<a href="#$2">$1</a>');
  if (lines.every((line) => /^\s*[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${local(line.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
  if (lines.every((line) => /^#{1,3} /.test(line))) {
    return lines.map((line) => { const level = Math.min(line.match(/^#+/)[0].length + 2, 4); return `<h${level}>${esc(line.replace(/^#+\s+/, ''))}</h${level}>`; }).join('');
  }
  return `<p>${local(block)}</p>`;
}

function safeMarkdown(markdown) {
  return String(markdown || '').split(/(```[\s\S]*?```)/g).map((part) => (part.startsWith('```')
    ? `<pre><code>${esc(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`
    : part.split(/\n\s*\n/).filter((block) => block.trim()).map(markdownBlock).join(''))).join('');
}

function details(general) {
  const coverage = (general?.coverage || []).map((row) => `<tr><td>${esc(row.surface)}</td><td>${row.covered ? 'yes' : 'no'}</td><td>${esc((row.gaps || []).join(', '))}</td></tr>`).join('');
  const disagreements = (general?.openDisagreements || []).map((row) => `<li>${esc(row.clusterId)}: ${esc(row.summary)}</li>`).join('');
  const incompletion = Array.isArray(general?.incompletionNotes) && general.incompletionNotes.length
    ? `<h3>Incompletion causes and security impact</h3><ul>${general.incompletionNotes.map((n) => `<li><strong>[${esc(n.category)}]</strong> ${esc(n.reason)} — <em>Impact:</em> ${esc(n.impact)}</li>`).join('')}</ul>`
    : '';
  const m = general?.methodology;
  const method = m ? `<p>Reviewers ${esc((m.reviewers || []).join(', '))}. Orchestrator ${esc(m.orchestrator)}. Passes ${esc(m.passes)}. Tool budget ${esc(m.toolBudget)}. Debate rounds ${esc(m.debateRounds)}.${(m.judgeAssignment || []).length ? ` Judges: ${esc(m.judgeAssignment.join('; '))}.` : ''}</p>` : '';
  const contrib = (general?.contributions || []).map((row) => `<tr><td>${esc(row.reviewerId)}</td><td>${esc(row.uniqueConfirmed)}</td><td>${esc(row.refuted)}</td><td>${esc(row.toolCalls)}</td><td>${row.costUsd == null ? '—' : esc(row.costUsd)}</td></tr>`).join('');
  return `<h3>Coverage and gaps</h3><table><thead><tr><th>Surface</th><th>Covered</th><th>Gaps</th></tr></thead><tbody>${coverage}</tbody></table>${disagreements ? `<h3>Open disagreements</h3><ul>${disagreements}</ul>` : ''}${incompletion}${method}<h3>Contributions</h3><table><thead><tr><th>Reviewer</th><th>Unique confirmed</th><th>Refuted</th><th>Tool calls</th><th>Cost</th></tr></thead><tbody>${contrib}</tbody></table>`;
}

export const section = {
  id: 'general-review',
  order: 60,
  slot: 'evidence',
  rail: { num: '06', label: 'General review', anchor: 'general-review' },
  pages: ['report'],
  render({ general, markdown }) {
    const body = general ? `<div class="prose">${safeMarkdown(markdown)}</div>${details(general)}` : '<p class="notice"><b>INCOMPLETE</b> General review not run.</p>';
    return `<section id="general-review" aria-label="General review"><h2><span>06</span> General review</h2>${body}<p>${esc(general?.disclaimer || DISCLAIMER)}</p></section>`;
  },
};
