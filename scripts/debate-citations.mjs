// Mechanical quote check. Whitespace is collapsed; the quote must sit inside the cited line range.
import fs from 'node:fs';
import path from 'node:path';

export function normalizeQuote(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function checkCitation(root, citation) {
  const file = String(citation?.file || '');
  if (!file || file.includes('..') || path.isAbsolute(file)) return { ...citation, valid: false, reason: 'path_outside_snapshot' };
  const base = path.resolve(root);
  const full = path.resolve(base, file);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) return { ...citation, valid: false, reason: 'path_outside_snapshot' };
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return { ...citation, valid: false, reason: 'quote_not_found' };
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  const start = Number(citation.startLine) || 1;
  const end = Number(citation.endLine) || start;
  const slice = lines.slice(start - 1, end).join('\n');
  const ok = normalizeQuote(slice).includes(normalizeQuote(citation.quote));
  return ok ? { ...citation, valid: true } : { ...citation, valid: false, reason: 'quote_not_found' };
}

export function checkCitations(root, citations) {
  return (citations || []).map((citation) => checkCitation(root, citation));
}
