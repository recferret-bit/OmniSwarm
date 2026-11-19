// Rail 06. general-review.md is model prose plus the engine's own sections, often without blank lines
// between a label and its list. Render that line by line. Judge ids for triage and rules are counts:
// listing every capped cluster here repeats the cross-check cap table.
import { esc } from './report-cards.mjs';
import { DISCLAIMER } from './debate-general-review.mjs';

function inline(raw) {
  return esc(raw)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/gi, '<a href="#$2">$1</a>');
}

function lineKind(line) {
  if (!line.trim()) return 'blank';
  if (/^#{1,3}\s+\S/.test(line)) return 'heading';
  if (/^\s*\|.*\|\s*$/.test(line)) return 'table';
  if (/^\s*\d+\.\s+\S/.test(line)) return 'ordered';
  if (/^\s*[-*]\s+\S/.test(line)) return 'list';
  if (line.trim().length <= 90 && /:\s*$/.test(line.trim())) return 'kicker';
  return 'text';
}

function kickerClass(text) {
  const word = text.trim().toLowerCase().match(/^[a-z]+/)?.[0] || '';
  return ['critical', 'high', 'medium', 'low', 'info'].includes(word) ? `md-kicker sev-${word}` : 'md-kicker';
}

function listHtml(lines) {
  const nodes = lines.map((line) => {
    const match = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    return { indent: match[1].length, text: match[2], children: [] };
  });
  const root = [];
  const stack = [{ indent: -1, children: root }];
  for (const node of nodes) {
    while (stack.length > 1 && node.indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const render = (items, ordered) => `<${ordered ? 'ol' : 'ul'}>${items.map((item) => `<li>${inline(item.text)}${item.children.length ? render(item.children, false) : ''}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  return render(root, /^\s*\d+\./.test(lines[0] || ''));
}

function tableHtml(lines) {
  const body = lines.filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line));
  if (!body.length) return '';
  const cells = (line) => line.split('|').slice(1, -1).map((cell) => inline(cell.trim()));
  const row = (line, tag) => `<tr>${cells(line).map((cell) => `<${tag}>${cell}</${tag}>`).join('')}</tr>`;
  const [head, ...rest] = body;
  return `<div class="table-scroll"><table class="dense-table"><thead>${row(head, 'th')}</thead><tbody>${rest.map((line) => row(line, 'td')).join('')}</tbody></table></div>`;
}

function renderGroup(kind, lines) {
  if (kind === 'heading') {
    return lines.map((line) => {
      const text = line.replace(/^#+\s+/, '').trim();
      if (/^general review$/i.test(text)) return '';
      return `<h3>${inline(text)}</h3>`;
    }).join('');
  }
  if (kind === 'list' || kind === 'ordered') return listHtml(lines);
  if (kind === 'table') return tableHtml(lines);
  if (kind === 'kicker') return lines.map((line) => `<p class="${kickerClass(line)}">${inline(line.trim())}</p>`).join('');
  const text = lines.map((line) => line.trim()).filter(Boolean).join(' ');
  return text ? `<p>${inline(text)}</p>` : '';
}

export function safeMarkdown(markdown) {
  return String(markdown || '').replace(/\r\n/g, '\n').split(/(```[\s\S]*?```)/g).map((part) => {
    if (part.startsWith('```')) return `<pre><code>${esc(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`;
    const lines = part.split('\n');
    let html = '';
    let buf = [];
    let kind = '';
    const flush = () => { if (buf.length) html += renderGroup(kind, buf); buf = []; };
    for (const line of lines) {
      const next = lineKind(line);
      if (next === 'blank') { flush(); kind = ''; continue; }
      if (next !== kind) { flush(); kind = next; }
      buf.push(line);
    }
    flush();
    return html;
  }).join('');
}

const idNum = (id) => { const n = /(\d+)/.exec(String(id || '')); return n ? Number(n[1]) : 0; };
const SKIP_JUDGE = new Set(['triage', 'rules', 'none']);

export function parseJudges(entries) {
  return (entries || []).map((entry) => {
    const match = /^([^:]+):\s*(\S+)([\s\S]*)$/.exec(String(entry).trim());
    if (!match) return { clusterId: String(entry).trim(), judge: '', notes: '' };
    const extra = match[3] || '';
    const notes = [/\(alternate\)/i.test(extra) ? 'alternate' : '', /\(retried\)/i.test(extra) ? 'retried' : ''].filter(Boolean).join(', ');
    return { clusterId: match[1].trim(), judge: match[2], notes };
  });
}

function judgeSummary(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.judge || 'unknown', (counts.get(row.judge || 'unknown') || 0) + 1);
  const rank = (name) => (name === 'triage' || name === 'none' ? 1 : name === 'rules' ? 2 : 0);
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${count} ${name}`)
    .join(' · ');
}

function details(general) {
  const coverage = (general?.coverage || []).map((row) => `<tr><td>${esc(row.surface)}</td><td>${row.covered ? 'yes' : 'no'}</td><td>${esc((row.gaps || []).map((gap) => String(gap).replace(/_/g, ' ')).join(', '))}</td></tr>`).join('');
  const disagreements = (general?.openDisagreements || []).map((row) => `<tr><td><a href="#finding-${esc(row.clusterId)}">${esc(row.clusterId)}</a></td><td>${esc(row.summary)}</td></tr>`).join('');
  const incompletion = Array.isArray(general?.incompletionNotes) && general.incompletionNotes.length
    ? `<h3>Incompletion causes and security impact</h3><div class="table-scroll"><table class="dense-table"><thead><tr><th>Category</th><th>Source</th><th>Reason</th><th>Impact</th></tr></thead><tbody>${general.incompletionNotes.map((note) => `<tr><td>${esc(note.category)}</td><td>${esc(note.source || '')}</td><td>${esc(note.reason)}</td><td>${esc(note.impact)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const method = general?.methodology;
  const judges = parseJudges(method?.judgeAssignment);
  const debated = judges.filter((row) => row.judge && !SKIP_JUDGE.has(row.judge)).sort((a, b) => idNum(a.clusterId) - idNum(b.clusterId) || a.clusterId.localeCompare(b.clusterId));
  const methodHtml = method ? `<h3>Methodology</h3><dl class="method-grid"><div class="method-wide"><dt>Reviewers</dt><dd>${esc((method.reviewers || []).join(', '))}</dd></div><div><dt>Orchestrator</dt><dd>${esc(method.orchestrator)}</dd></div><div><dt>Passes</dt><dd>${esc(method.passes)}</dd></div><div><dt>Tool budget</dt><dd>${esc(method.toolBudget)}</dd></div><div><dt>Debate rounds</dt><dd>${esc(method.debateRounds)}</dd></div></dl>${judges.length ? `<p class="note">Judge assignments: ${esc(judgeSummary(judges))}. Triage means two vendors agreed before the debate. Rules means citation rules decided the cluster, including every cluster past the debate cap. Those ids stay in Cross-check.</p>` : ''}${debated.length ? `<details class="panel" id="judge-assignments"><summary>Debated cluster judges<span class="meta-label">${debated.length} assigned</span></summary><div class="panel-body"><div class="table-scroll"><table class="dense-table"><thead><tr><th>Cluster</th><th>Judge</th><th>Notes</th></tr></thead><tbody>${debated.map((row) => `<tr><td><a href="#finding-${esc(row.clusterId)}">${esc(row.clusterId)}</a></td><td>${esc(row.judge)}</td><td>${esc(row.notes || '—')}</td></tr>`).join('')}</tbody></table></div></div></details>` : ''}` : '';
  const contrib = (general?.contributions || []).map((row) => `<tr><td>${esc(row.reviewerId)}</td><td class="num">${esc(row.uniqueConfirmed)}</td><td class="num">${esc(row.refuted)}</td><td class="num">${esc(row.toolCalls)}</td><td class="num">${row.costUsd == null ? '—' : esc(row.costUsd)}</td></tr>`).join('');
  return `<h3>Coverage and gaps</h3><div class="table-scroll"><table class="dense-table"><thead><tr><th>Surface</th><th>Covered</th><th>Gaps</th></tr></thead><tbody>${coverage}</tbody></table></div>${disagreements ? `<h3>Open disagreements</h3><div class="table-scroll"><table class="dense-table"><thead><tr><th>Cluster</th><th>Summary</th></tr></thead><tbody>${disagreements}</tbody></table></div>` : ''}${incompletion}${methodHtml}<h3>Contributions</h3><div class="table-scroll"><table class="dense-table"><thead><tr><th>Reviewer</th><th class="num">Unique confirmed</th><th class="num">Refuted</th><th class="num">Tool calls</th><th class="num">Cost</th></tr></thead><tbody>${contrib}</tbody></table></div>`;
}

export const section = {
  id: 'general-review',
  order: 60,
  slot: 'evidence',
  rail: { num: '06', label: 'General review', anchor: 'general-review' },
  pages: ['report'],
  render({ general, markdown }) {
    const body = general ? `<div class="prose review-prose">${safeMarkdown(markdown)}</div>${details(general)}` : '<p class="notice"><b>INCOMPLETE</b> General review not run.</p>';
    return `<section id="general-review" class="report-block" aria-label="General review"><div class="section-heading"><h2><span class="section-num">06</span>General review</h2></div>${body}<p class="note">${esc(general?.disclaimer || DISCLAIMER)}</p></section>`;
  },
};
