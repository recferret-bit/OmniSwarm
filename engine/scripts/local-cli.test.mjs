import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localAuditArgs, parseLocalArgs, selectLocalPanel, selectProviderPanel } from './local-cli.mjs';

test('opus orchestrates when claude is installed, and every installed CLI reviews', () => {
  const panel = selectLocalPanel(['agy', 'claude', 'grok']);
  assert.deepEqual(panel, {
    reviewers: ['cli:claude:opus', 'cli:grok:grok-4.7', 'cli:agy:gemini-4-argon-high'],
    orchestrator: 'cli:claude:opus',
  });
});

test('a machine with only agy uses argon as orchestrator and reviewer', () => {
  const panel = selectLocalPanel(['agy']);
  assert.deepEqual(panel, {
    reviewers: ['cli:agy:gemini-4-argon-high'],
    orchestrator: 'cli:agy:gemini-4-argon-high',
  });
});

test('codex is the orchestrator when it is the first installed CLI and claude is absent', () => {
  assert.equal(selectLocalPanel(['codex', 'grok']).orchestrator, 'cli:codex:gpt-6.1-sol');
  assert.equal(selectLocalPanel([]), null);
});

test('the local command reviews the current directory unless a target is passed', () => {
  const panel = { reviewers: ['cli:agy:gemini-4-argon-high'], orchestrator: 'cli:agy:gemini-4-argon-high' };
  assert.deepEqual(localAuditArgs(panel, { repo: '', github: '' }).slice(0, 4), ['run', '--repo', '.', '--reviewers']);
  assert.deepEqual(localAuditArgs(panel, { repo: '', github: 'near/near-sdk-rs' }).slice(0, 3), ['run', '--github', 'near/near-sdk-rs']);
});

test('--nearai makes the first NEAR AI model the orchestrator and every model a reviewer', () => {
  const target = parseLocalArgs(['--nearai', 'deepseek-ai/DeepSeek-V4, Qwen/Qwen3.8-Max,deepseek-ai/DeepSeek-V4', '--scope', 'web3']);
  assert.equal(target.provider, 'nearai');
  assert.deepEqual(target.models, ['deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.8-Max']);
  const panel = selectProviderPanel('nearai', target.models, { installed: ['claude'] });
  assert.deepEqual(panel, { reviewers: ['nearai:deepseek-ai/DeepSeek-V4', 'nearai:Qwen/Qwen3.8-Max'], orchestrator: 'nearai:deepseek-ai/DeepSeek-V4' });
  const args = localAuditArgs(panel, target);
  assert.equal(args[args.indexOf('--orchestrator') + 1], 'nearai:deepseek-ai/DeepSeek-V4');
  assert.equal(args.join(' ').includes('KEY'), false);
});

test('--with-clis adds installed CLIs after the NEAR AI models and keeps NEAR AI orchestrating', () => {
  const panel = selectProviderPanel('nearai', ['m1'], { installed: ['claude', 'grok'], withClis: true });
  assert.deepEqual(panel, { reviewers: ['nearai:m1', 'cli:claude:opus', 'cli:grok:grok-4.7'], orchestrator: 'nearai:m1' });
});

test('--nearai rejects a missing or malformed model and --with-clis needs --nearai', () => {
  assert.throws(() => parseLocalArgs(['--nearai']), /needs a model/);
  assert.throws(() => parseLocalArgs(['--nearai', '--repo', 'x']), /needs a model/);
  assert.throws(() => parseLocalArgs(['--nearai', 'a b']), /invalid model/);
  assert.throws(() => parseLocalArgs(['--nearai', 'a;rm']), /invalid model/);
  assert.throws(() => parseLocalArgs(['--with-clis']), /only applies with --provider or --nearai/);
  assert.equal(parseLocalArgs([]).provider, '');
});

test('--provider takes only nearai; removed providers are unknown', () => {
  const near = parseLocalArgs(['--models', 'Qwen/Qwen3.8-Max,moonshotai/Kimi-K3', '--provider', 'nearai']);
  assert.deepEqual(selectProviderPanel(near.provider, near.models), { reviewers: ['nearai:Qwen/Qwen3.8-Max', 'nearai:moonshotai/Kimi-K3'], orchestrator: 'nearai:Qwen/Qwen3.8-Max' });
  for (const removed of ['zai', 'openrouter', 'local', 'anthropic']) {
    assert.throws(() => parseLocalArgs(['--provider', removed, '--models', 'm']), /unknown API provider .*\(one of: nearai\)/, removed);
  }
  assert.throws(() => parseLocalArgs(['--provider', 'nearai']), /needs --models/);
  assert.throws(() => parseLocalArgs(['--models', 'm']), /needs --provider/);
});
