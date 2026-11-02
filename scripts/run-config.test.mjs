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
