#!/usr/bin/env node
// Golden eval (ORCHESTRATION 7): union, majority vote and the debate, all computed from the same scripted
// submissions on every eval/golden repo. Writes eval/RESULTS.md (only when the numbers change), including the
// OD-14 default-rounds decision; this run's date and commit go to eval/runs/last-run.json.
// Offline only; real models (OMNI_LIVE=1) are not wired here yet.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClusters } from '../scripts/debate-cluster.mjs';
import { sourceReader } from '../scripts/debate-citations.mjs';
import { offlinePlan } from '../scripts/debate-plan.mjs';
import { runDebateStages } from '../scripts/debate-run.mjs';
import { runPanel, STRATEGIES } from './panel.mjs';
import { decideDefaultRounds, rates, retainedBy, score, sum } from './metrics.mjs';
import { writeResults } from './results.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden');
const RUNS = path.join(HERE, 'runs');
const MODES = ['union', 'majority', 'debate-1', 'debate-2'];

// maxClusters: every cluster is debated. The eval measures the protocol, not the cluster cap (a budget knob).
async function debate(dir, panel, rounds, out, maxClusters) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const result = await runDebateStages(offlinePlan({ out, sourceRoot: dir, claims: panel.claims, controls: panel.controls, reviewers: panel.reviewers, rounds, maxClusters }));
  const turns = [...result.debated.values()].flatMap((row) => row.turns);
  return { adjudication: result.rows, turns: turns.length, suspect: turns.filter((t) => t.conformitySuspect).length };
}

async function evalRepo(name) {
  const dir = path.join(GOLDEN, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const work = path.join(RUNS, name);
  const panel = await runPanel(dir, expected, path.join(work, 'panel'));
  const { clusters } = buildClusters(panel.claims, { reader: sourceReader(dir) });
  const submitters = new Set(panel.claims.map((c) => c.reviewerId)).size;
  const row = {
    union: score(retainedBy('union', clusters), expected),
    majority: score(retainedBy('majority', clusters, { submitters }), expected),
  };
  for (const rounds of [1, 2]) {
    const run = await debate(dir, panel, rounds, path.join(work, `debate-r${rounds}`), Math.max(clusters.length, 25));
    row[`debate-${rounds}`] = { ...score(retainedBy('debate', clusters, { adjudication: run.adjudication }), expected), turns: run.turns, suspect: run.suspect };
  }
  return { name, row };
}

function table(results, totals) {
  const lines = ['| repo | mode | recall | precision | decoy FP | dedup | conformity | cost USD |', '|---|---|---:|---:|---:|---:|---:|---:|'];
  const push = (name, counts) => MODES.forEach((mode) => {
    const r = rates(counts[mode]);
    lines.push(`| ${name} | ${mode} | ${r.recall} | ${r.precision} | ${r.decoyFp} | ${r.dedup} | ${r.conformity} | ${r.cost} |`);
  });
  results.forEach(({ name, row }) => push(name, row));
  push('**total**', totals);
  return lines.join('\n');
}

function commit() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

const repos = fs.readdirSync(GOLDEN).filter((name) => fs.existsSync(path.join(GOLDEN, name, 'expected.json'))).sort();
const results = [];
for (const name of repos) results.push(await evalRepo(name));
const totals = Object.fromEntries(MODES.map((mode) => [mode, sum(results.map(({ row }) => row[mode]))]));
const decision = decideDefaultRounds({ debate: totals['debate-2'], union: totals.union, majority: totals.majority });
const text = table(results, totals);
const body = `Reviewers: ${STRATEGIES.map((s) => `scripted:${s}`).join(', ')}; judge scripted:judge. Cost: none (no model was called).

These are scripted reviewers whose answers derive from each repo's expected.json by the fixed policy in
eval/panel.mjs, so the table measures the debate protocol (citation checks, conformity rule, evidence floor),
not model skill. The live eval with real models (\`OMNI_LIVE=1\`) is pending.

Default debate rounds: ${decision.rounds}. ${decision.reason}

Union keeps every cluster. Majority keeps clusters reported by more than half of the reviewers that submitted
a finding. debate-N keeps every cluster the N-round debate did not REFUTE; every cluster is debated (no cluster
cap), so the table measures the protocol and not the cap. Totals are micro-averaged.

${text}
`;
const { changed } = writeResults({ file: path.join(HERE, 'RESULTS.md'), runsDir: RUNS, body, date: new Date().toISOString().slice(0, 10), commit: commit() });
console.log(text);
console.log(`Default debate rounds: ${decision.rounds}. ${decision.reason}`);
console.log(changed ? 'RESULTS.md updated: the numbers changed.' : 'RESULTS.md unchanged: same numbers as the committed table.');
