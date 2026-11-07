import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localAuditArgs, selectLocalPanel } from './local-cli.mjs';

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
