import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRunConfig, loadConfigFile, ConfigError, parseFlags } from './run-config.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const example = path.join(here, '..', 'omniswarm.config.example.json');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'runcfg-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const write = (d, name, value) => { const f = path.join(d, name); fs.writeFileSync(f, JSON.stringify(value)); return f; };

test('without flags or file the legacy four cli reviewers keep round-robin and OD-03 defaults', (t) => {
  const r = resolveRunConfig({ flags: {}, root: tmp(t) });
  assert.deepEqual(r.reviewers.map((x) => x.id), ['cli-claude-opus', 'cli-grok-grok-4-7', 'cli-agy-gemini-4-argon-high', 'cli-codex-gpt-6-1-sol']);
  assert.equal(r.assign, 'round-robin');
  assert.deepEqual([r.budgets.passes, r.budgets.toolBudget, r.budgets.debate.rounds], [2, 40, 2]);
});

test('--agents and the model flags keep their old precedence and map to cli reviewers', (t) => {
  const r = resolveRunConfig({ flags: parseFlags(['--agents', 'claude,codex', '--model', 'm1', '--models', 'claude=m2', '--model-claude', 'sonnet']), root: tmp(t) });
  assert.deepEqual(r.reviewers.map((x) => x.model), ['sonnet', 'm1']);
  assert.equal(r.reviewers[0].id, 'cli-claude-sonnet');
  assert.throws(() => resolveRunConfig({ flags: { agents: 'nope' }, root: tmp(t) }), /Unknown agent/);
  assert.throws(() => resolveRunConfig({ flags: { agents: 'claude', reviewers: 'cli:claude:opus' }, root: tmp(t) }), ConfigError);
});

test('W01-07: --claude-model is the planned spelling and --model-claude stays an alias', (t) => {
  const planned = resolveRunConfig({ flags: parseFlags(['--agents', 'claude', '--claude-model', 'sonnet']), root: tmp(t) });
  const alias = resolveRunConfig({ flags: parseFlags(['--agents', 'claude', '--model-claude', 'sonnet']), root: tmp(t) });
  assert.equal(planned.reviewers[0].id, 'cli-claude-sonnet');
  assert.deepEqual(planned.reviewers, alias.reviewers);
  assert.throws(() => parseFlags(['--nobody-model', 'x']), /unknown option/);
  const viaCli = spawnSync(path.join(here, '../..', 'bin', 'audit'), ['run', '--repo', path.join(here, 'demo-fixture'), '--claude-model', 'sonnet', '--surface', 's1', '--plan'], { encoding: 'utf8' });
  assert.equal(viaCli.status, 0, viaCli.stderr);
  assert.match(viaCli.stdout, /cli-claude-sonnet/);
});

test('--max-cost-usd must be a non-negative dollar amount', (t) => {
  for (const bad of ['abc', '-1', '', 'NaN', 'Infinity']) assert.throws(() => resolveRunConfig({ flags: { maxCostUsd: bad }, root: tmp(t) }), /must be a number of US dollars/);
  assert.equal(resolveRunConfig({ flags: { maxCostUsd: '0.25' }, root: tmp(t) }).budgets.maxCostUsd, 0.25);
});

test('flags override a preset, which overrides the file, which overrides defaults', (t) => {
  const d = tmp(t);
  const file = write(d, 'c.json', { reviewers: ['cli:claude:opus'], passes: 2, presets: { p: { reviewers: ['scripted:baseline'], passes: 4 } } });
  assert.equal(resolveRunConfig({ flags: { config: file, passes: '3' } }).budgets.passes, 3);
  assert.equal(resolveRunConfig({ flags: { config: file } }).budgets.passes, 2);
  const p = resolveRunConfig({ flags: { config: file, preset: 'p' } });
  assert.equal(p.budgets.passes, 4);
  assert.equal(p.reviewers[0].id, 'scripted-baseline');
  assert.equal(p.assign, 'matrix');
  assert.equal(resolveRunConfig({ flags: { config: file, preset: 'p', passes: '1', reviewers: 'cli:codex:x' } }).reviewers[0].id, 'cli-codex-x');
});

test('invalid files and values exit with the schema error path', (t) => {
  const d = tmp(t);
  const bad = write(d, 'bad.json', { reviewers: ['cli:claude:opus'], passes: 9 });
  assert.throws(() => loadConfigFile(bad), /\$\.passes/);
  assert.throws(() => resolveRunConfig({ flags: { config: bad } }), ConfigError);
  assert.throws(() => resolveRunConfig({ flags: { config: write(d, 'ok.json', { reviewers: ['cli:claude:opus'] }), preset: 'missing' } }), /unknown preset/);
  assert.throws(() => resolveRunConfig({ flags: { passes: '7' }, root: tmp(t) }), /passes/);
  assert.throws(() => resolveRunConfig({ flags: { passes: 'x' }, root: tmp(t) }), /integer/);
  assert.throws(() => resolveRunConfig({ flags: { preset: 'demo' }, root: tmp(t) }), /needs a config file/);
  const r = spawnSync(process.execPath, [path.join(here, 'run-config.mjs'), 'resolve', '--config', bad], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\$\.passes/);
});

test('the example config is valid and every preset resolves', () => {
  loadConfigFile(example);
  for (const preset of ['local-subscriptions', 'api-only', 'mixed', 'hosted', 'demo']) {
    const r = resolveRunConfig({ flags: { config: example, preset } });
    assert.ok(r.reviewers.length >= 2, preset);
  }
  assert.equal(resolveRunConfig({ flags: { config: example, preset: 'hosted' } }).alternateJudge.id, 'openrouter-openai-gpt-6-1-sol');
});

test('more than eight reviewers fall back to round-robin with a warning', (t) => {
  const specs = Array.from({ length: 9 }, (_, i) => `scripted:baseline:r${i}`).join(',');
  const r = resolveRunConfig({ flags: { reviewers: specs }, root: tmp(t) });
  assert.equal(r.assign, 'round-robin');
  assert.equal(r.warnings.length, 1);
  assert.equal(resolveRunConfig({ flags: { reviewers: specs, assign: 'matrix' }, root: tmp(t) }).assign, 'matrix');
});

test('--debate-rounds, --debate-max-clusters and --debate-tool-budget are validated and override the file', (t) => {
  const d = tmp(t);
  const file = write(d, 'c.json', { reviewers: ['cli:claude:opus'], debate: { rounds: 1, maxClusters: 10 } });
  const r = resolveRunConfig({ flags: parseFlags(['--config', file, '--debate-rounds', '3', '--debate-tool-budget', '6']) });
  assert.deepEqual(r.budgets.debate, { rounds: 3, toolBudget: 6, maxClusters: 10, turnMs: 180000, phaseMs: 900000 });
  assert.deepEqual(resolveRunConfig({ flags: { config: file } }).budgets.debate, { rounds: 1, toolBudget: 12, maxClusters: 10, turnMs: 180000, phaseMs: 900000 });
  const timed = resolveRunConfig({ flags: parseFlags(['--config', file, '--debate-turn-ms', '20000', '--debate-phase-ms', '120000']) });
  assert.deepEqual([timed.budgets.debate.turnMs, timed.budgets.debate.phaseMs], [20000, 120000]);
  assert.throws(() => resolveRunConfig({ flags: parseFlags(['--debate-turn-ms', '1000']), root: tmp(t) }), /--debate-turn-ms must be 15000–600000/);
  assert.throws(() => resolveRunConfig({ flags: parseFlags(['--debate-phase-ms', '10']), root: tmp(t) }), /--debate-phase-ms must be 60000–3600000/);
  const bad = [[['--debate-rounds', '4'], /debate_rounds_max_3/], [['--debate-rounds', '0'], /--debate-rounds must be 1–3/], [['--debate-rounds', 'two'], /--debate-rounds must be an integer/],
    [['--debate-max-clusters', '501'], /--debate-max-clusters must be 1–500/], [['--debate-tool-budget', '0'], /--debate-tool-budget must be 1–100/]];
  for (const [argv, message] of bad) assert.throws(() => resolveRunConfig({ flags: parseFlags(argv), root: tmp(t) }), message, argv.join(' '));
  assert.throws(() => resolveRunConfig({ flags: { config: write(d, 'r4.json', { reviewers: ['cli:claude:opus'], debate: { rounds: 4 } }) } }), /\$\.debate\.rounds: above maximum 3/);
  const viaCli = spawnSync(path.join(here, '../..', 'bin', 'audit'), ['run', '--repo', path.join(here, 'demo-fixture'), '--reviewers', 'scripted:baseline', '--debate-rounds', '4', '--plan'], { encoding: 'utf8' });
  assert.equal(viaCli.status, 2);
  assert.match(viaCli.stderr, /debate_rounds_max_3/);
});

test('the default debate rounds are the golden-eval OD-14 decision recorded in eval/RESULTS.md', (t) => {
  const results = fs.readFileSync(path.join(here, '..', 'eval', 'RESULTS.md'), 'utf8');
  const recorded = Number(/^Default debate rounds: (\d)\./m.exec(results)?.[1]);
  assert.deepEqual(resolveRunConfig({ flags: {}, root: tmp(t) }).budgets.debate, { rounds: recorded, toolBudget: 12, maxClusters: 25, turnMs: 180000, phaseMs: 900000 });
});

test('scripted_judge_demo_only: the scripted judge is refused at plan time on anything but a bundled fixture', (t) => {
  const real = path.join(here, '../..', 'contracts', 'review-registry');
  for (const flags of [{ orchestrator: 'scripted:judge' }, { orchestrator: 'cli:claude:opus', alternateJudge: 'scripted:judge' }]) {
    assert.throws(() => resolveRunConfig({ flags: { ...flags, target: real }, root: tmp(t) }), /^ConfigError: scripted_judge_demo_only: --(orchestrator|alternate-judge) scripted:judge/);
  }
  for (const fixture of [path.join(here, 'demo-fixture'), path.join(here, '..', 'eval', 'golden', 'near-escrow')]) {
    assert.equal(resolveRunConfig({ flags: { orchestrator: 'scripted:judge', target: fixture }, root: tmp(t) }).orchestrator.id, 'scripted-judge');
  }
  const viaCli = (repo) => spawnSync(path.join(here, '../..', 'bin', 'audit'), ['run', '--repo', repo, '--reviewers', 'scripted:baseline', '--orchestrator', 'scripted:judge', '--surface', 's1', '--plan'], { encoding: 'utf8' });
  const refused = viaCli(real);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /scripted_judge_demo_only/);
  assert.equal(viaCli(path.join(here, 'demo-fixture')).status, 0);
});
