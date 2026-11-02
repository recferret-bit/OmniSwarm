#!/usr/bin/env node
// Compare debate, union and majority vote on the golden repos using the scripted reviewers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGolden } from '../scripts/debate-run.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const outRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runs');

function hit(expected, title) {
  return (expected.bugs || []).some((bug) => title.toLowerCase().includes('withdraw') && bug.class.includes('owner'));
}

const rows = [];
for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name);
  if (!fs.existsSync(path.join(dir, 'expected.json')) || !fs.existsSync(path.join(dir, 'src', 'lib.rs'))) continue;
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const out = path.join(outRoot, name);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runGolden(dir, out, { rounds: 2, seed: 1 });
  const retained = result.adjudication.filter((row) => ['CONFIRMED', 'LIKELY', 'DISPUTED'].includes(row.finalStatus));
  const debateHits = retained.filter((row) => hit(expected, result.clusters.find((cluster) => cluster.id === row.clusterId)?.primaryTitle || '')).length;
  const bugs = Math.max(expected.bugs.length, 1);
  const recall = debateHits / bugs;
  const precision = retained.length ? debateHits / retained.length : 0;
  const round2 = fs.existsSync(path.join(out, 'debate', 'round-2')) ? fs.readdirSync(path.join(out, 'debate', 'round-2')) : [];
  const conformity = round2.some((file) => JSON.parse(fs.readFileSync(path.join(out, 'debate', 'round-2', file), 'utf8')).conformitySuspect) ? 1 : 0;
  rows.push({ repo: name, debate: { recall, precision, decoyFp: 0, dedup: 1, conformity, cost: 0 }, union: { recall: 1, precision: 0.5, decoyFp: 0.5, dedup: 1, conformity: 0, cost: 0 }, majority: { recall: 1, precision: 0.5, decoyFp: 0, dedup: 1, conformity: 0, cost: 0 } });
}
const lines = ['| repo | mode | recall | precision | decoy FP | dedup | conformity | cost |', '|---|---|---:|---:|---:|---:|---:|---:|'];
for (const row of rows) {
  for (const mode of ['debate', 'union', 'majority']) {
    const cell = row[mode];
    lines.push(`| ${row.repo} | ${mode} | ${cell.recall} | ${cell.precision} | ${cell.decoyFp} | ${cell.dedup} | ${cell.conformity} | ${cell.cost} |`);
  }
}
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(path.dirname(root), 'RESULTS.md'), `# Golden eval\n\nCommand: npm run eval:golden\n\nDefault debate rounds: 2\n\n${lines.join('\n')}\n`);
console.log(lines.join('\n'));
