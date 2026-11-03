import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymize, stripIdentity } from './debate-anonymize.mjs';

test('the same seed anonymizes identically, per cluster, and hides model names', () => {
  const ids = ['cli-claude-opus', 'cli-codex-gpt-5-5', 'key-zai-glm-5-3', 'scripted-wrong'];
  assert.deepEqual(anonymize(ids, 7, 'CLUSTER-1'), anonymize(ids, 7, 'CLUSTER-1'));
  const perCluster = ['CLUSTER-1', 'CLUSTER-2', 'CLUSTER-3', 'CLUSTER-4'].map((id) => anonymize(ids, 7, id)['cli-claude-opus']);
  assert.ok(new Set(perCluster).size > 1, 'one reviewer keeps the same label in every cluster');
  assert.ok(Object.values(anonymize(ids, 7, 'CLUSTER-1')).every((label) => /^Reviewer [A-D]$/.test(label)));
  assert.equal(stripIdentity('Claude and qwen agree with key-zai-glm-5-3', ['key-zai-glm-5-3']).match(/claude|qwen|glm/i), null);
});
