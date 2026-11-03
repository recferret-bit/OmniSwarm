// Mechanical citation checker (ORCHESTRATION 4.2). It reads the snapshot the reviewers saw: when
// source-manifest.json is given, a file whose bytes no longer match it is refused. Whitespace is collapsed
// and the quote must sit inside the cited line range. A debate argument's citation also has to land near
// one of the cluster's own anchors, so a valid quote about some other function does not decide a cluster.
import { sha256Hex } from './hash-util.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { LINE_TOLERANCE } from './cluster-findings.mjs';

function normalizeQuote(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

// manifest: the parsed source-manifest.json ({files: [{path, sha256}]}) or null for an unsealed fixture.
export function sourceReader(root, manifest = null) {
  const base = path.resolve(root);
  const hashes = manifest ? new Map((manifest.files || []).map((row) => [row.path, row.sha256])) : null;
  const cache = new Map();
  const load = (file) => {
    const rel = String(file || '');
    if (!rel || rel.split(/[\\/]/).includes('..') || path.isAbsolute(rel)) return { error: 'path_outside_snapshot' };
    const full = path.resolve(base, rel);
    if (!full.startsWith(`${base}${path.sep}`)) return { error: 'path_outside_snapshot' };
    let stat;
    try { stat = fs.lstatSync(full); } catch { return { error: 'file_not_in_snapshot' }; }
    if (!stat.isFile()) return { error: 'file_not_in_snapshot' };
    const bytes = fs.readFileSync(full);
    if (hashes && !hashes.has(rel)) return { error: 'file_not_in_snapshot' };
    if (hashes && hashes.get(rel) !== sha256Hex(bytes)) return { error: 'source_changed' };
    return { lines: bytes.toString('utf8').split(/\r?\n/) };
  };
  return {
    lines(file) {
      if (!cache.has(file)) cache.set(file, load(file));
      return cache.get(file);
    },
  };
}

function range(citation) {
  const start = Number(citation?.startLine);
  const end = Number(citation?.endLine ?? start);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end - start <= 400 ? { start, end } : null;
}

export function checkCitation(reader, citation) {
  const read = reader.lines(citation?.file);
  if (read.error) return { ...citation, valid: false, reason: read.error };
  const span = range(citation);
  if (!span || span.end > read.lines.length) return { ...citation, valid: false, reason: 'line_out_of_range' };
  const slice = normalizeQuote(read.lines.slice(span.start - 1, span.end).join('\n'));
  const quote = normalizeQuote(citation.quote);
  if (!quote || !slice.includes(quote)) return { ...citation, valid: false, reason: 'quote_not_found' };
  return { ...citation, valid: true };
}

// The source line behind a finding's `file:line` location, checked like any citation. A blank line or a lone
// brace is not evidence of anything.
export function anchorEvidence(reader, { file, line }) {
  const read = reader.lines(file);
  if (read.error) return { file, startLine: line, endLine: line, quote: '', valid: false, reason: read.error };
  const text = read.lines[line - 1];
  if (text === undefined) return { file, startLine: line, endLine: line, quote: '', valid: false, reason: 'line_out_of_range' };
  const quote = text.trim();
  if (!quote || /^[{}()[\];,]+$/.test(quote)) return { file, startLine: line, endLine: line, quote, valid: false, reason: 'not_evidence' };
  return { file, startLine: line, endLine: line, quote, valid: true };
}

export function relevantTo(citation, anchors, tolerance = LINE_TOLERANCE) {
  const span = range(citation);
  return Boolean(span) && anchors.some((anchor) => anchor.file === citation.file && anchor.line >= span.start - tolerance && anchor.line <= span.end + tolerance);
}

// Check every citation of a debate turn against the source and the cluster's anchors.
export function checkTurnCitations(reader, citations, anchors) {
  return (Array.isArray(citations) ? citations : []).map((citation) => {
    const checked = checkCitation(reader, citation);
    if (!checked.valid) return checked;
    return relevantTo(checked, anchors) ? checked : { ...checked, valid: false, reason: 'not_about_this_cluster' };
  });
}

export function parseLocation(location) {
  const match = /^(.+):(\d+)$/.exec(String(location));
  return match ? { file: match[1], line: Number(match[2]) } : null;
}
