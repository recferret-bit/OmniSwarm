import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fingerprintOf, providerStatus, readProviderEnv, writeProviderSecrets } from '../../src/modules/providers/secrets.ts';
import { panelConfigDocument, panelPresetName, panelSpecs } from '../../src/worker/panel.ts';

test('the panel always reviews with GLM and Qwen, and adds the chosen models in order', () => {
  assert.equal(panelPresetName([]), 'panel');
  assert.equal(panelPresetName(['grok', 'opus']), 'panel-opus-grok');
  assert.throws(() => panelPresetName(['claude']), /unknown model/);
  const specs = panelSpecs('panel-opus-grok');
  assert.deepEqual(specs.reviewers, [
    'key:zai:glm-5.3',
    'openrouter:qwen/qwen3.8-max-0902',
    'openrouter:anthropic/claude-opus-5.5',
    'openrouter:x-ai/grok-4.7',
  ]);
  assert.equal(specs.orchestrator, 'key:zai:glm-5.3');
  assert.equal(specs.alternateJudge, 'openrouter:qwen/qwen3.8-max-0902');
  const doc = panelConfigDocument('panel') as { presets: { panel: { orchestrator: string } } };
  assert.equal(doc.presets.panel.orchestrator, 'key:zai:glm-5.3');
});

test('provider keys are stored sealed and only a fingerprint comes back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keys-'));
  const file = path.join(dir, 'providers.json');
  const secret = 's'.repeat(40);
  const status = writeProviderSecrets(file, secret, { zai: 'zai-secret-value', openrouter: 'or-secret-value' });
  assert.equal(status.zai.fingerprint, fingerprintOf('zai-secret-value'));
  assert.equal(status.openrouter.set, true);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('zai-secret-value'));
  assert.ok(!raw.includes('or-secret-value'));
  assert.deepEqual(readProviderEnv(file, secret), { ZAI_API_KEY: 'zai-secret-value', OPENROUTER_API_KEY: 'or-secret-value' });
  assert.equal(writeProviderSecrets(file, secret, { zai: '' }).zai.set, false);
  assert.equal(providerStatus(file).openrouter.set, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
});
