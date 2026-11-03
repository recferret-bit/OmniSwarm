import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelMatches, presetFor, runToolLoop } from './provider-openai-compat.mjs';
import { buildApiLaunch } from './provider-api-launch.mjs';

function scriptedFetch(steps) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const next = steps[calls.length - 1];
    const status = next.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => next.headers?.[name.toLowerCase()] ?? null },
      json: async () => next.body,
      text: async () => JSON.stringify(next.body || {}),
    };
  };
  return { fetch, calls };
}

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const message = (model, calls) => ({ model, choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });

test('a 3-turn script executes each tool call and stops on submit', async () => {
  const seen = [];
  const { fetch, calls } = scriptedFetch([
    { body: message('glm-5.3', [toolCall('c1', 'read_file', { path: 'src/lib.rs' })]) },
    { body: message('glm-5.3', [toolCall('c2', 'search_code', { pattern: 'owner' })]) },
    { body: message('glm-5.3', [toolCall('c3', 'submit_audit_report', { findings: [], verified_safe: [] })]) },
  ]);
  const result = await runToolLoop({
    baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'glm-5.3', tools: [],
    callTool: async (name, args) => { seen.push({ name, args }); return `ok ${name}`; },
    brief: 'review', fetchImpl: fetch, sleep: async () => {},
  });
  assert.equal(calls.length, 3);
  assert.equal(result.stop, 'submitted');
  assert.equal(result.turns, 3);
  assert.deepEqual(seen.map((row) => row.name), ['read_file', 'search_code', 'submit_audit_report']);
  const second = calls[1].body.messages.find((row) => row.role === 'tool');
  assert.equal(second.tool_call_id, 'c1');
  assert.equal(calls[0].headers.authorization, 'Bearer test-key');
});

test('429 then 503 then 200 retries and records one usage entry; 401 does not retry', async () => {
  const retry = scriptedFetch([
    { status: 429, headers: { 'retry-after': '1' }, body: {} },
    { status: 503, body: {} },
    { body: { model: 'glm-5.3', choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 4, completion_tokens: 1 } } },
  ]);
  const ok = await runToolLoop({
    baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [], callTool: async () => '',
    brief: 'review', fetchImpl: retry.fetch, sleep: async () => {},
  });
  assert.equal(retry.calls.length, 3);
  assert.equal(ok.stop, 'no_tools');
  assert.equal(ok.usage.length, 1);
  const denied = scriptedFetch([{ status: 401, body: {} }]);
  const auth = await runToolLoop({
    baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [], callTool: async () => '',
    brief: 'review', fetchImpl: denied.fetch, sleep: async () => {},
  });
  assert.equal(denied.calls.length, 1);
  assert.equal(auth.stop, 'error');
  assert.equal(auth.failure, 'auth');
});

test('zai and openrouter presets set the base url, reasoning effort and data collection deny', async () => {
  const zai = presetFor('zai');
  const zaiFetch = scriptedFetch([{ body: { model: 'glm-5.3', choices: [{ message: { content: 'done' } }], usage: {} } }]);
  await runToolLoop({
    baseUrl: zai.baseUrl({}), apiKey: 'k', model: 'glm-5.3', headers: zai.headers(), extraBody: zai.extraBody,
    tools: [], callTool: async () => '', brief: 'review', fetchImpl: zaiFetch.fetch, sleep: async () => {},
  });
  assert.equal(zaiFetch.calls[0].url, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(zaiFetch.calls[0].body.reasoning_effort, 'high');
  const openrouter = presetFor('openrouter');
  const orFetch = scriptedFetch([{ body: { model: 'qwen/qwen3.8-max-0902', choices: [{ message: { content: 'done' } }], usage: { cost: 0.01 } } }]);
  const result = await runToolLoop({
    baseUrl: openrouter.baseUrl({}), apiKey: 'k', model: 'qwen/qwen3.8-max-0902', headers: openrouter.headers(), extraBody: openrouter.extraBody,
    tools: [], callTool: async () => '', brief: 'review', fetchImpl: orFetch.fetch, sleep: async () => {},
  });
  assert.equal(orFetch.calls[0].body.provider.require_parameters, true);
  assert.equal(orFetch.calls[0].body.provider.data_collection, 'deny');
  assert.equal(orFetch.calls[0].headers['X-OpenRouter-Title'], 'OmniSwarm');
  assert.equal(result.usage[0].cost, 0.01);
  assert.equal(modelMatches('glm-5.3', 'glm-5.1'), false);
});

test('a served model that is not the requested model stops as model_mismatch', async () => {
  const { fetch } = scriptedFetch([{ body: { model: 'glm-5.1', choices: [{ message: { content: 'no' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }]);
  const result = await runToolLoop({
    baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [], callTool: async () => '',
    brief: 'review', fetchImpl: fetch, sleep: async () => {},
  });
  assert.equal(result.failure, 'model_mismatch');
  assert.equal(result.servedModel, 'glm-5.1');
  assert.equal(result.stop, 'error');
});

test('the last turn forces the submit tool of the reviewer role', async () => {
  for (const [submitTool, expected] of [[undefined, 'submit_audit_report'], ['submit_crosscheck_report', 'submit_crosscheck_report']]) {
    const { fetch, calls } = scriptedFetch([
      { body: message('glm-5.3', [toolCall('c1', 'read_file', { path: 'a' })]) },
      { body: message('glm-5.3', [toolCall('c2', 'read_file', { path: 'b' })]) },
      { body: message('glm-5.3', [toolCall('c3', expected, { verdicts: [] })]) },
    ]);
    const result = await runToolLoop({
      baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [], maxTurns: 3, ...(submitTool ? { submitTool } : {}),
      callTool: async () => 'ok', brief: 'review', fetchImpl: fetch, sleep: async () => {},
    });
    assert.equal(result.stop, 'submitted');
    assert.equal(calls[0].body.tool_choice, undefined);
    assert.equal(calls[1].body.tool_choice, undefined);
    assert.deepEqual(calls[2].body.tool_choice, { type: 'function', function: { name: expected } });
  }
  await assert.rejects(runToolLoop({ baseUrl: 'https://example.invalid/v1', model: 'm', callTool: async () => '', submitTool: 'read_file' }), /unknown submit tool/);
});

test('a crosscheck launch configures the crosscheck submit tool', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'api-role-'));
  const env = { PATH: '/bin', HOME: '/tmp', ZAI_API_KEY: 'zk-test' };
  for (const [role, tool] of [['auditor', 'submit_audit_report'], ['crosscheck', 'submit_crosscheck_report']]) {
    buildApiLaunch({ provider: 'zai', model: 'glm-5.3' }, { workDir: work, env, role, toolBudget: 5 }, presetFor('zai'));
    const config = JSON.parse(fs.readFileSync(path.join(work, 'api-launch.json'), 'utf8'));
    assert.equal(config.submitTool, tool);
    assert.equal(config.maxTurns, 8);
  }
});

test('a tool call with malformed arguments is answered with an error, not sent to the bridge', async () => {
  const seen = [];
  const bad = { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{not json' } };
  const { fetch, calls } = scriptedFetch([
    { body: message('glm-5.3', [bad]) },
    { body: message('glm-5.3', [toolCall('c2', 'submit_audit_report', { findings: [] })]) },
  ]);
  const result = await runToolLoop({
    baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [],
    callTool: async (name) => { seen.push(name); return 'ok'; }, brief: 'review', fetchImpl: fetch, sleep: async () => {},
  });
  assert.equal(result.stop, 'submitted');
  assert.deepEqual(seen, ['submit_audit_report']);
  const reply = calls[1].body.messages.find((row) => row.role === 'tool' && row.tool_call_id === 'c1');
  assert.match(reply.content, /Tool error: invalid tool arguments/);
});
