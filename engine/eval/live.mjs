#!/usr/bin/env node
// Live eval on golden/fullstack-dapp with real models. Two steps, neither of which calls a provider:
//   node engine/eval/live.mjs prepare [--scope web2|web3|infra]
//       copies the fixture WITHOUT expected.json to eval/runs/live/<stamp>/target and prints the review command.
//       The review itself is started by the operator (it uses their subscriptions or keys).
//   node engine/eval/live.mjs score <report-dir> [--scope web2|web3|infra]
//       scores a finished report against the answer key; writes live-score.{json,md} beside the target copy
//       (or into eval/runs/live/ when the report is elsewhere) and prints the markdown.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScore, scoreReport } from './score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'golden', 'fullstack-dapp');
const RUNS = path.join(HERE, 'runs', 'live');
const SCOPES = ['web2', 'web3', 'infra'];

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : '';
}

export function copyWithoutKey(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (source) => path.basename(source) !== 'expected.json' });
  if (fs.existsSync(path.join(to, 'expected.json'))) throw new Error('the answer key was copied into the target');
  return to;
}

// With --scope the key is cut to that layer: a scoped run is not expected to find the other layers' bugs.
export function expectedFor(scope = '') {
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
  if (!SCOPES.includes(scope)) return expected;
  return { ...expected, bugs: expected.bugs.filter((row) => row.layer === scope), decoys: expected.decoys.filter((row) => row.layer === scope) };
}

function prepare(argv) {
  const scope = flag(argv, '--scope');
  if (scope && !SCOPES.includes(scope)) throw new Error(`--scope must be one of ${SCOPES.join(', ')}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const dir = path.join(RUNS, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const target = copyWithoutKey(FIXTURE, path.join(dir, 'target'));
  const report = path.join(dir, 'report');
  const scoped = scope ? ` --scope ${scope}` : '';
  process.stdout.write([
    `Target (no answer key): ${target}`,
    '',
    'Start the review yourself; it calls your models:',
    `  ./bin/audit run --repo ${target} --config engine/omniswarm.config.example.json --preset local-subscriptions --out ${report}${scoped}`,
    '',
    'A cheaper first pass (two CLIs, one surface):',
    `  ./bin/audit run --repo ${target} --reviewers cli:claude:opus,cli:codex:gpt-6.1-sol --orchestrator cli:claude:opus --surface s3 --out ${report}${scoped}`,
    '',
    'Then score it:',
    `  node engine/eval/live.mjs score ${report}${scoped}`,
    '',
  ].join('\n'));
}

function score(argv) {
  const reportDir = argv.find((arg) => !arg.startsWith('--') && arg !== flag(argv, '--scope'));
  if (!reportDir) throw new Error('usage: live.mjs score <report-dir> [--scope web2|web3|infra]');
  const file = path.join(reportDir, 'findings-and-scores.json');
  if (!fs.existsSync(file)) throw new Error(`${file} does not exist: the review has not produced scored findings`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = fs.existsSync(path.join(reportDir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(reportDir, 'meta.json'), 'utf8')) : {};
  const scope = flag(argv, '--scope') || (SCOPES.includes(meta.scope) ? meta.scope : '');
  const result = scoreReport(rows, expectedFor(scope));
  const health = fs.existsSync(path.join(reportDir, 'report-health.json')) ? JSON.parse(fs.readFileSync(path.join(reportDir, 'report-health.json'), 'utf8')) : null;
  const run = { reportDir: path.resolve(reportDir), scope: scope || 'full', surface: meta.surface || null, reviewers: (meta.reviewers || []).map((r) => r.id), orchestrator: meta.orchestrator?.id || meta.orchestrator || null, budgets: meta.budgets || null, state: health?.state || null, stageFailures: meta.stageFailures || [] };
  const title = `Live eval: fullstack-dapp, ${run.scope} scope, surface ${run.surface || '?'}, ${run.reviewers.length} reviewer(s)`;
  const note = run.state === 'incomplete' || run.stageFailures.length ? `\nThe report is INCOMPLETE (${run.stageFailures.join('; ') || 'see report-health.json'}); the numbers below describe a partial run.\n` : '';
  const markdown = renderScore(result, { title }).replace('\n', `\n${note}`);
  const outDir = path.dirname(path.resolve(reportDir)).startsWith(RUNS) ? path.dirname(path.resolve(reportDir)) : RUNS;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'live-score.json'), `${JSON.stringify({ run, ...result }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'live-score.md'), markdown);
  process.stdout.write(`${markdown}\nWritten to ${path.join(outDir, 'live-score.md')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...argv] = process.argv.slice(2);
  try {
    if (command === 'prepare') prepare(argv);
    else if (command === 'score') score(argv);
    else throw new Error('usage: live.mjs prepare [--scope <layer>] | score <report-dir> [--scope <layer>]');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
}
