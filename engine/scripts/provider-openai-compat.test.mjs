import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelMatches, presetFor, runToolLoop } from './provider-openai-compat.mjs';
import { buildApiLaunch } from './provider-api-launch.mjs';
import { costLedger, spentUsd } from './bridge-budget.mjs';

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

test('the loop transcript records each message once, not the whole conversation every turn', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-transcript-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcriptPath = path.join(dir, 'loop-transcript.jsonl');
  const { fetch } = scriptedFetch([
    { body: message('glm-5.3', [toolCall('a', 'read_file', { path: 'src/lib.rs' })]) },
    { body: message('glm-5.3', [toolCall('b', 'search_code', { pattern: 'owner' })]) },
    { body: message('glm-5.3', [toolCall('c', 'submit_audit_report', { findings: [] })]) },
  ]);
  const result = await runToolLoop({ baseUrl: 'https://example.invalid/v1', model: 'glm-5.3', callTool: async (name) => `${name} text`, brief: 'Review S1', fetchImpl: fetch, transcriptPath });
  assert.equal(result.stop, 'submitted');
  const rows = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.request.messagesFrom), [0, 1, 3]);
  assert.deepEqual(rows.map((row) => row.request.messages.length), [1, 2, 2], 'only the messages added since the previous turn');
  assert.equal(rows.flatMap((row) => row.request.messages).filter((m) => m.role === 'user').length, 1);
});

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

// Cost ceiling (ORCHESTRATION section 3): one reviewer's spend over the whole run, on the budget-file ledger.
const priced = (calls, cost) => ({ ...message('glm-5.3', calls), usage: { prompt_tokens: 3, completion_tokens: 2, cost } });
const read = (id) => toolCall(id, 'read_file', { path: 'src/lib.rs' });
const submit = (id) => toolCall(id, 'submit_audit_report', { findings: [], verified_safe: [] });
const pricedLoop = (fetch, ledger) => runToolLoop({
  baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'glm-5.3', tools: [], callTool: async (name) => `ok ${name}`,
  brief: 'review', fetchImpl: fetch, sleep: async () => {}, maxCostUsd: 1, ledger,
});

test('the cost ceiling is the reviewer total: a later pass on the run ledger stops once the total reaches it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-ceiling-'));
  const ledger = () => costLedger(root, 'key-zai-glm-5-3');
  const first = scriptedFetch([{ body: priced([read('a1')], 0.3) }, { body: priced([submit('a2')], 0.3) }]);
  assert.equal((await pricedLoop(first.fetch, ledger())).stop, 'submitted');
  const second = scriptedFetch([{ body: priced([read('b1')], 0.3) }, { body: priced([read('b2')], 0.3) }, { body: priced([submit('b3')], 0.3) }]);
  const stopped = await pricedLoop(second.fetch, ledger());
  assert.equal(stopped.stop, 'cost', 'its own 0.6 is under the ceiling; the reviewer total 1.2 is not');
  assert.equal(second.calls.length, 2);
  assert.ok(Math.abs(spentUsd(root, 'key-zai-glm-5-3') - 1.2) < 1e-9);
  const third = scriptedFetch([]);
  assert.equal((await pricedLoop(third.fetch, ledger())).stop, 'cost');
  assert.equal(third.calls.length, 0, 'a loop that starts over the ceiling sends no request');
});

test('parallel surfaces of one reviewer share one ceiling', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-ceiling-par-'));
  const script = (id) => scriptedFetch([{ body: priced([read(`${id}1`)], 0.4) }, { body: priced([read(`${id}2`)], 0.4) }, { body: priced([submit(`${id}3`)], 0.4) }]);
  const [s1, s2] = [script('s1-'), script('s2-')];
  const results = await Promise.all([s1, s2].map((surface) => pricedLoop(surface.fetch, costLedger(root, 'key-zai-glm-5-3'))));
  assert.deepEqual(results.map((result) => result.stop), ['cost', 'cost'], 'each surface alone (1.2) would have submitted');
  assert.ok(s1.calls.length + s2.calls.length < 6);
});

test('an auditor launch books its spend on the run budget file; debate and judge sessions do not', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'api-ledger-'));
  const env = { PATH: '/bin', HOME: '/tmp', ZAI_API_KEY: 'zk-test' };
  const bridgeArgs = ['--report-dir', '/reports/run', '--role', 'auditor', '--agent', 'key-zai-glm-5-3', '--surface', 'S1'];
  const ledgerOf = (role, args = bridgeArgs) => {
    buildApiLaunch({ provider: 'zai', model: 'glm-5.3' }, { workDir: work, env, role, bridgeArgs: args, maxCostUsd: 25 }, presetFor('zai'));
    return JSON.parse(fs.readFileSync(path.join(work, 'api-launch.json'), 'utf8')).spendLedger;
  };
  assert.deepEqual(ledgerOf('auditor'), { reportDir: '/reports/run', reviewerId: 'key-zai-glm-5-3' });
  assert.deepEqual(ledgerOf('crosscheck'), { reportDir: '/reports/run', reviewerId: 'key-zai-glm-5-3' });
  for (const role of ['debater', 'orchestrator']) assert.equal(ledgerOf(role), null, role);
  assert.equal(ledgerOf('auditor', []), null, 'no report dir: the loop counts its own spend');
});
