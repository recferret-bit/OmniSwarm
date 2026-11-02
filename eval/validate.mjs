#!/usr/bin/env node
// Check every golden repo: at least two bugs, two decoys, and every line range exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const repos = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, 'expected.json')));
let failed = 0;
for (const name of repos) {
  const expected = JSON.parse(fs.readFileSync(path.join(root, name, 'expected.json'), 'utf8'));
  const bugs = expected.bugs || [];
  const decoys = expected.decoys || [];
  if (bugs.length < 2 || decoys.length < 2) { console.error(`${name}: need >= 2 bugs and >= 2 decoys`); failed += 1; continue; }
  for (const row of [...bugs, ...decoys]) {
    const file = path.join(root, name, row.file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    if (row.startLine < 1 || row.endLine > lines.length) { console.error(`${name}: ${row.file}:${row.startLine} is outside the file`); failed += 1; }
  }
}
if (!repos.length) { console.error('no golden repos'); failed += 1; }
console.log(`${repos.length} golden repos`);
process.exit(failed ? 1 : 0);
