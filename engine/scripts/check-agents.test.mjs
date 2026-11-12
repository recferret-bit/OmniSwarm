import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReviewerRow, claudeMaxTurnsLine, grokMaxTurnsLine } from './check-agents.mjs';

test('check-agents rows report a missing or present key and never the value', () => {
  const missing = checkReviewerRow('nearai:Qwen/Qwen3.8-Max', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.line, 'nearai: NEARAI_API_KEY missing');
  const present = checkReviewerRow('nearai:Qwen/Qwen3.8-Max', { NEARAI_API_KEY: 'nk-test' });
  assert.equal(present.ok, true);
  assert.equal(present.line, 'nearai: key present');
  assert.equal(present.line.includes('nk-test'), false);
  assert.equal(checkReviewerRow('scripted:baseline', {}).line, 'scripted: ok');
  // Removed providers: key:zai and cli:claude-zai are unknown providers, whatever keys the shell still holds.
  const zai = checkReviewerRow('key:zai:glm-5.3', { ZAI_API_KEY: 'zk-stale' });
  assert.deepEqual(zai, { ok: false, line: 'key-zai-glm-5-3: unknown provider zai' });
  const claudeZai = checkReviewerRow('cli:claude-zai:glm-5.3', { ZAI_API_KEY: 'zk-stale' });
  assert.deepEqual(claudeZai, { ok: false, line: 'cli-claude-zai-glm-5-3: unknown provider claude-zai' });
  assert.throws(() => checkReviewerRow('openrouter:qwen/qwen3.8-max-0902', {}), { code: 'REVIEWER_SPEC_INVALID' });
});

test('claude --max-turns is reported from the binary help text', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-help-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "--max-turns N"; fi\n', { mode: 0o755 });
  assert.equal(claudeMaxTurnsLine({ PATH: bin, HOME: '/tmp' }), 'claude --max-turns: supported');
  assert.equal(claudeMaxTurnsLine({ PATH: '/nonexistent', HOME: '/tmp' }), 'claude --max-turns: not supported (bridge gate only)');
});

test('grok --max-turns is reported from grok agent help', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-help-'));
  fs.writeFileSync(path.join(bin, 'grok'), '#!/bin/sh\nif [ "$1" = agent ] && [ "$2" = "--help" ]; then echo "--max-turns N"; fi\n', { mode: 0o755 });
  assert.equal(grokMaxTurnsLine({ PATH: bin, HOME: '/tmp' }), 'grok --max-turns: supported');
  assert.equal(grokMaxTurnsLine({ PATH: '/nonexistent', HOME: '/tmp' }), 'grok --max-turns: not supported (bridge gate only)');
});
