import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { END, README, RESULTS, START, evalBlock, inject } from './readme-eval-table.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'readme-eval-table.mjs');

test('README.md carries the current golden-eval totals from engine/eval/RESULTS.md', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr}\nRun: node tools/readme-eval-table.mjs`);
  const readme = fs.readFileSync(README, 'utf8');
  assert.ok(readme.includes(evalBlock(fs.readFileSync(RESULTS, 'utf8'))));
});

test('the block is the decision line and every totals row, without the per-repo rows or the commit', () => {
  const block = evalBlock(fs.readFileSync(RESULTS, 'utf8'));
  assert.match(block, /^Default debate rounds: \d\./);
  for (const mode of ['union', 'majority', 'debate-1', 'debate-2']) assert.match(block, new RegExp(`^\\| ${mode} \\|`, 'm'));
  assert.doesNotMatch(block, /near-escrow|commit [0-9a-f]{7}/);
});

test('a changed number in RESULTS.md makes the README stale, and inject repairs it', () => {
  const results = fs.readFileSync(RESULTS, 'utf8');
  const readme = fs.readFileSync(README, 'utf8');
  const changed = results.replace(/^(\| \*\*total\*\* \| union \| )[^|]+/m, '$10.01 ');
  assert.notEqual(changed, results);
  const next = inject(readme, evalBlock(changed));
  assert.notEqual(next, readme);
  assert.ok(next.includes('| union | 0.01 |'));
  assert.equal(inject(next, evalBlock(changed)), next);
});

test('missing markers or a malformed RESULTS.md fail loudly', () => {
  assert.throws(() => inject('# no markers\n', 'x'), /no eval-table markers/);
  assert.throws(() => inject(`${END}\n${START}\n`, 'x'), /no eval-table markers/);
  assert.throws(() => evalBlock('# Golden eval\n'), /no "Default debate rounds:"/);
  assert.throws(() => evalBlock('Default debate rounds: 2.\n| repo | mode |\n|---|\n| a | union |\n'), /no \*\*total\*\* rows/);
});
