// Mechanical citation checker (ORCHESTRATION 4.2). It reads the snapshot the reviewers saw: when
// source-manifest.json is given, a file whose bytes no longer match it is refused. Whitespace is collapsed
// and the quote must sit inside the cited line range. A debate argument's citation also has to land near
// one of the cluster's own anchors, so a valid quote about some other function does not decide a cluster.
import { sha256Hex } from './hash-util.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { LINE_TOLERANCE } from './cluster-findings.mjs';

const MAX_RANGE_LINES = 400;
// A quote shorter than this (a brace, `;`, `Ok`) matches almost any range and proves nothing.
const MIN_QUOTE_CHARS = 6;

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
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end - start < MAX_RANGE_LINES ? { start, end } : null;
}

export function checkCitation(reader, citation) {
  const read = reader.lines(citation?.file);
  if (read.error) return { ...citation, valid: false, reason: read.error };
  const span = range(citation);
  if (!span || span.end > read.lines.length) return { ...citation, valid: false, reason: 'line_out_of_range' };
  const slice = normalizeQuote(read.lines.slice(span.start - 1, span.end).join('\n'));
  const quote = normalizeQuote(citation.quote);
  if (!quote || !slice.includes(quote)) return { ...citation, valid: false, reason: 'quote_not_found' };
  if (quote.replace(/\s/g, '').length < MIN_QUOTE_CHARS) return { ...citation, valid: false, reason: 'quote_too_short' };
  return { ...citation, valid: true };
}

// The lines the quote actually occupies inside its cited range: the tightest window that still contains it.
// Relevance is judged on these lines, so a wide range that merely touches the cluster cannot carry a quote
// from somewhere else in the file.
export function quoteSpan(reader, citation) {
  const read = reader.lines(citation?.file);
  const span = range(citation);
  const quote = normalizeQuote(citation?.quote);
  if (read.error || !span || !quote) return null;
  for (let start = span.start; start <= span.end; start++) {
    for (let end = start; end <= span.end; end++) {
      if (normalizeQuote(read.lines.slice(start - 1, end).join('\n')).includes(quote)) {
        let tight = start;
        while (tight < end && normalizeQuote(read.lines.slice(tight, end).join('\n')).includes(quote)) tight += 1;
        return { start: tight, end };
      }
    }
  }
  return null;
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

const FUNCTION_SPAN = 80;
const HAS_FUNCTIONS = /\.(?:rs|[cm]?[jt]sx?|py|go|sol|java|kt|rb|php|c|cc|cpp|h|cs|swift|move|vy|cairo|vue|svelte)$/i;
const DECLARATION_BOUNDARY = /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|def|function|class|struct|enum|impl|trait|mod|interface)\b/;
const ARROW_BOUNDARY = /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/;
const METHOD_CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'throw', 'new', 'super', 'import', 'export', 'match', 'loop']);

function isMethodBoundary(text) {
  const m = /^\s{0,4}(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([A-Za-z0-9_$,\s:?=.\[\]<>|&'"]*\)\s*(?::\s*[A-Za-z0-9_$,\s.<>|&\[\]?]+)?\{\s*$/.exec(text);
  return Boolean(m && !METHOD_CONTROL.has(m[1]));
}

function isFunctionBoundary(text, sawIndented) {
  if (DECLARATION_BOUNDARY.test(text) || ARROW_BOUNDARY.test(text) || isMethodBoundary(text)) return true;
  if (sawIndented && /^[A-Za-z_@][\w.]*\s*(?:=|\(|:)/.test(text)) return true;
  return false;
}

function sameFunctionSpan(lines, span, anchorLine, maxDistance = FUNCTION_SPAN) {
  if (!Array.isArray(lines)) return false;
  if (anchorLine >= span.start && anchorLine <= span.end) return true;
  const below = anchorLine < span.start;
  const first = below ? anchorLine : span.start;
  const from = below ? anchorLine + 1 : span.end + 1;
  const to = below ? span.start : anchorLine;
  if (to - from > maxDistance) return false;
  let sawIndented = /^\s+\S/.test(lines[first - 1] ?? '');
  for (let i = from; i <= to; i++) {
    const text = lines[i - 1] ?? '';
    if (/^\}(?:\s*\))?\s*;?\s*$/.test(text)) return false;
    if ((below || i < to) && isFunctionBoundary(text, sawIndented)) return false;
    if (/^\s+\S/.test(text)) sawIndented = true;
  }
  return true;
}

const indentOf = (text) => /^\s*/.exec(text)[0].replace(/\t/g, '    ').length;

// True when a non-blank line strictly between the two lines is indented less than both of them: the block
// that holds one of the lines closed, or a new one opened, before the other line.
function blockEndsBetween(lines, a, b) {
  const [from, to] = a < b ? [a, b] : [b, a];
  const floor = Math.min(indentOf(lines[from - 1] ?? ''), indentOf(lines[to - 1] ?? ''));
  for (let i = from + 1; i < to; i++) {
    const text = lines[i - 1] ?? '';
    if (text.trim() && indentOf(text) < floor) return true;
  }
  return false;
}

export function relevantTo(citation, anchors, tolerance = LINE_TOLERANCE, reader = null) {
  const span = (reader && quoteSpan(reader, citation)) || range(citation);
  if (!span) return false;
  const lines = reader ? reader.lines(citation.file)?.lines : null;
  return anchors.some((anchor) => {
    if (anchor.file !== citation.file) return false;
    if (anchor.line >= span.start - tolerance && anchor.line <= span.end + tolerance) {
      // Near is not enough when a block ends in between: the next service of a compose file, the next
      // function or the next location block is a different subject three lines away.
      const edge = anchor.line < span.start ? span.start : anchor.line > span.end ? span.end : anchor.line;
      if (!lines || !blockEndsBetween(lines, anchor.line, edge)) return true;
    }
    // The same-function widening needs functions: configuration files (YAML, TOML, proxy and Docker files) have none.
    return lines && HAS_FUNCTIONS.test(citation.file) ? sameFunctionSpan(lines, span, anchor.line) : false;
  });
}

// Check every citation of a debate turn against the source and the cluster's anchors.
export function checkTurnCitations(reader, citations, anchors) {
  return (Array.isArray(citations) ? citations : []).map((citation) => {
    const checked = checkCitation(reader, citation);
    if (!checked.valid) return checked;
    return relevantTo(checked, anchors, LINE_TOLERANCE, reader) ? checked : { ...checked, valid: false, reason: 'not_about_this_cluster' };
  });
}

export function parseLocation(location) {
  const match = /^(.+):(\d+)$/.exec(String(location));
  return match ? { file: match[1], line: Number(match[2]) } : null;
}
