#!/usr/bin/env node
// Check every golden repo: at least two bugs and two decoys, every range inside its file and on real code
// (not a blank line or a lone brace), and no two repos with the same source.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');

function sourceDigest(dir) {
  const files = fs.readdirSync(dir, { recursive: true }).filter((rel) => rel !== 'expected.json' && fs.statSync(path.join(dir, rel)).isFile()).sort();
  return crypto.createHash('sha256').update(files.map((rel) => `${rel}\0${fs.readFileSync(path.join(dir, rel), 'utf8')}`).join('\0')).digest('hex');
}

export function problemsOf(name, dir) {
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const bugs = expected.bugs || [];
  const decoys = expected.decoys || [];
  const problems = [];
  if (bugs.length < 2 || decoys.length < 2) problems.push(`${name}: need >= 2 bugs and >= 2 decoys`);
  for (const row of bugs) if (!row.class || !row.title) problems.push(`${name}: bug at ${row.file}:${row.startLine} needs class and title`);
  for (const row of decoys) if (!row.reason || !row.claim) problems.push(`${name}: decoy at ${row.file}:${row.startLine} needs reason and claim`);
  for (const row of [...bugs, ...decoys]) {
    const file = path.join(dir, row.file);
    if (!fs.existsSync(file)) { problems.push(`${name}: ${row.file} does not exist`); continue; }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    if (!(row.startLine >= 1 && row.endLine >= row.startLine && row.endLine <= lines.length)) { problems.push(`${name}: ${row.file}:${row.startLine}-${row.endLine} is outside the file`); continue; }
    const text = lines.slice(row.startLine - 1, row.endLine).join('\n').trim();
    if (!text || /^[{}()[\];,]+$/.test(text)) problems.push(`${name}: ${row.file}:${row.startLine} is blank or a lone brace`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repos = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, 'expected.json'))).sort();
  const problems = repos.flatMap((name) => problemsOf(name, path.join(root, name)));
  const seen = new Map();
  for (const name of repos) {
    const digest = sourceDigest(path.join(root, name));
    if (seen.has(digest)) problems.push(`${name}: same source as ${seen.get(digest)}`);
    seen.set(digest, name);
  }
  if (repos.length < 6) problems.push(`need >= 6 golden repos, found ${repos.length}`);
  for (const problem of problems) console.error(problem);
  console.log(`${repos.length} golden repos`);
  process.exit(problems.length ? 1 : 0);
}
