import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReviewerRow, claudeMaxTurnsLine } from './check-agents.mjs';

test('check-agents rows report a missing or present key and never the value', () => {
  const missing = checkReviewerRow('openrouter:qwen/qwen3.8-max-0902', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.line, 'openrouter: OPENROUTER_API_KEY missing');
  const present = checkReviewerRow('openrouter:qwen/qwen3.8-max-0902', { OPENROUTER_API_KEY: 'or-test' });
  assert.equal(present.ok, true);
  assert.equal(present.line, 'openrouter: key present');
  assert.equal(present.line.includes('or-test'), false);
  assert.equal(checkReviewerRow('scripted:baseline', {}).line, 'scripted: ok');
  const zai = checkReviewerRow('key:zai:glm-5.3', {});
  assert.equal(zai.line, 'key:zai: ZAI_API_KEY missing');
});

test('claude --max-turns is reported from the binary help text', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-help-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "--max-turns N"; fi\n', { mode: 0o755 });
  assert.equal(claudeMaxTurnsLine({ PATH: bin, HOME: '/tmp' }), 'claude --max-turns: supported');
  assert.equal(claudeMaxTurnsLine({ PATH: '/nonexistent', HOME: '/tmp' }), 'claude --max-turns: not supported (bridge gate only)');
});
