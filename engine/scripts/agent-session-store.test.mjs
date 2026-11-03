import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, openSessionStore, validModelId } from './agent-session-store.mjs';

const identity = (model) => ({ name: 'openrouter-qwen-qwen3-8-max-0902-s1-auth', agent: 'openrouter-qwen-qwen3-8-max-0902', role: 'auditor', workflow: 'source_security_review_v1', model, sourceDigest: digest('src'), assignmentDigest: digest('s1') });
const scratch = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-')); fs.chmodSync(dir, 0o700); return dir; };

test('an OpenRouter model slug with a vendor prefix opens a session store', () => {
  const store = openSessionStore(path.join(scratch(), 'session'), identity('qwen/qwen3.8-max-0902'));
  assert.equal(store.state.identity.model, 'qwen/qwen3.8-max-0902');
  assert.ok(validModelId('anthropic/claude-opus-5.5'));
  assert.ok(validModelId('gpt-6.1-sol'));
});

test('model ids that are paths, blank, spaced or oversized are refused', () => {
  const dir = scratch();
  ['../x', 'a/../b', '/abs', 'trail/', 'a//b', 'has space', '', 'x'.repeat(129), 'a\nb', 'qwen\\x'].forEach((model, i) => {
    assert.equal(validModelId(model), false, JSON.stringify(model));
    assert.throws(() => openSessionStore(path.join(dir, `s-${i}`), identity(model)), /session_identity_rejected/, JSON.stringify(model));
  });
});
