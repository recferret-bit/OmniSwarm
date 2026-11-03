// Bounded, symlink-free tree walk and regex lead collection shared by the harness lead writers, the scanners
// and the review plans (audit-plans.mjs). Mounted alone into the sandbox: keep it free of engine imports.
import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules', 'target', 'dist', 'build', '.git', 'vendor', 'coverage', '.next',
  '__pycache__', 'harness-fixtures', '.cargo',
]);
const MAX_FILE = 512 * 1024;
export const PER_PATTERN = 40;

// Depth-first walk; onFile(fullPath) for every regular file. `sorted` visits each directory's entries by name.
export function walk(root, onFile, { skipDirs = SKIP_DIRS, sorted = false } = {}) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    if (sorted) entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) onFile(full);
    }
  }
}

export function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }

export function readText(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_FILE || st.size === 0) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

// 1-based line numbers of the first `max` matches of `re` in `text`.
export function matchLines(text, re, max) {
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  let m;
  while ((m = r.exec(text))) {
    out.push(text.slice(0, m.index).split('\n').length);
    if (out.length >= max) break;
  }
  return out;
}

const hits = (text, re) => matchLines(text, re, PER_PATTERN + 1);

export function cookieLeads(text) {
  const r = /\.cookie\s*\(|\bsetCookie\s*\(|Set-Cookie/g;
  const out = [];
  let m;
  while ((m = r.exec(text))) {
    const window = text.slice(m.index, m.index + 240);
    if (!/httpOnly|httponly/.test(window)) out.push(text.slice(0, m.index).split('\n').length);
    if (out.length > PER_PATTERN) break;
  }
  return out;
}

export function collect(root, wantExt, patterns, extra) {
  const found = new Map(patterns.map((p) => [p.id, []]));
  if (extra) found.set(extra.id, []);
  let files = 0;
  walk(root, (file) => {
    const ext = path.extname(file);
    if (wantExt && !wantExt(file, ext)) return;
    const text = readText(file);
    if (text == null || text.includes('\0')) return;
    files++;
    const name = rel(root, file);
    for (const p of patterns) {
      const lines = hits(text, p.re);
      const bucket = found.get(p.id);
      for (const line of lines) {
        if (bucket.length >= PER_PATTERN) break;
        bucket.push(`${name}:${line}`);
      }
    }
    if (extra) {
      const bucket = found.get(extra.id);
      for (const line of extra.scan(text)) {
        if (bucket.length >= PER_PATTERN) break;
        bucket.push(`${name}:${line}`);
      }
    }
  });
  return { files, found };
}

export function section(patterns, found) {
  const lines = [];
  let total = 0;
  for (const p of patterns) {
    const rows = found.get(p.id) || [];
    total += rows.length;
    lines.push(`## ${p.id} (${p.cls || p.surface})`);
    lines.push(p.note);
    if (!rows.length) lines.push('no hit');
    else for (const row of rows) lines.push(`- ${row}`);
    lines.push('');
  }
  return { total, body: lines.join('\n') };
}
