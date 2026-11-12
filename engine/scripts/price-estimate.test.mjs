import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPrice, runToolLoop } from './provider-openai-compat.mjs';
import { writePassUsage } from './review-passes.mjs';
import { readReportJson } from './report-contract.mjs';

test('a model without a reported cost is priced from the config table', async () => {
  const prices = { nearai: { 'deepseek-ai/DeepSeek-V4': { inPerMTok: 1, outPerMTok: 1 } } };
  assert.equal(applyPrice({ prompt_tokens: 1000, completion_tokens: 500 }, { prices, provider: 'nearai', model: 'deepseek-ai/DeepSeek-V4' }).cost, 0.0015);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'price-replay-'));
  fs.mkdirSync(path.join(root, 'nearai'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nearai', '0.json'), JSON.stringify({
    status: 200,
    body: { model: 'deepseek-ai/DeepSeek-V4', choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } },
  }));
  const result = await runToolLoop({
    baseUrl: 'https://cloud-api.near.ai/v1', apiKey: 'k', model: 'deepseek-ai/DeepSeek-V4', provider: 'nearai', tools: [],
    prices, callTool: async () => '', brief: 'review', sleep: async () => {},
    env: { OMNI_HTTP_REPLAY: root },
  });
  assert.equal(result.usage[0].cost, 0.0015);
  assert.equal(result.usage[0].costSource, 'estimated');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'price-pass-'));
  writePassUsage(out, {
    reviewerId: 'nearai-deepseek-ai-deepseek-v4', surface: 's1', pass: 1, role: 'discover', calls: 0,
    tokensIn: 1000, tokensOut: 500, cost: result.usage[0].cost, costSource: result.usage[0].costSource,
    stop: 'submitted', startedAt: '2026-11-02T00:00:00Z', endedAt: '2026-11-02T00:00:01Z',
  });
  const saved = readReportJson(out, 'harness/usage/nearai-deepseek-ai-deepseek-v4/s1-pass-1.json');
  assert.equal(saved.cost, 0.0015);
  assert.equal(saved.costSource, 'estimated');
});
