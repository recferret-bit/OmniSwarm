// One non-streaming chat-completions tool loop shared by key: and openrouter: reviewers.
// ORCHESTRATION sections 1 and 1.1. The loop never opens a socket unless the caller passes fetch
// or OMNI_LIVE=1; replay and tests inject fetch.
import fs from 'node:fs';
import path from 'node:path';
import { resetReplayTurns, selectFetch } from './http-replay.mjs';
import { parseToolCall } from './api-tool-schema.mjs';

export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
export const MAX_ATTEMPTS = 4;
const SUBMIT_TOOLS = new Set(['submit_audit_report', 'submit_crosscheck_report']);

export const PRESETS = {
  zai: {
    provider: 'zai',
    baseUrl: (env) => String(env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, ''),
    keyEnv: 'ZAI_API_KEY',
    envAllowlist: ['ZAI_API_KEY', 'ZAI_BASE_URL'],
    extraBody: { reasoning_effort: 'high' },
    headers: () => ({}),
  },
  openrouter: {
    provider: 'openrouter',
    baseUrl: () => 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    envAllowlist: ['OPENROUTER_API_KEY'],
    extraBody: { provider: { require_parameters: true, data_collection: 'deny' } },
    headers: () => ({ 'HTTP-Referer': 'https://omniswarm.dev', 'X-OpenRouter-Title': 'OmniSwarm' }),
  },
};

export function presetFor(provider) {
  const preset = PRESETS[provider];
  if (!preset) throw new Error(`unknown provider ${provider}`);
  return preset;
}

// A provider that omits usage.cost is priced from omniswarm.config.json prices.<provider>.<model>.
export function applyPrice(entry, { prices, provider, model } = {}) {
  const prompt = Number(entry.prompt_tokens) || 0;
  const completion = Number(entry.completion_tokens) || 0;
  if (entry.cost != null && entry.cost !== '' && Number.isFinite(Number(entry.cost))) {
    return { prompt_tokens: prompt, completion_tokens: completion, cost: Number(entry.cost), costSource: 'reported' };
  }
  const rate = prices?.[provider]?.[model] || prices?.[provider]?.[entry.model];
  if (!rate || !Number.isFinite(Number(rate.inPerMTok)) || !Number.isFinite(Number(rate.outPerMTok))) {
    return { prompt_tokens: prompt, completion_tokens: completion, cost: 0, costSource: 'none' };
  }
  const cost = (prompt * Number(rate.inPerMTok) + completion * Number(rate.outPerMTok)) / 1_000_000;
  return { prompt_tokens: prompt, completion_tokens: completion, cost, costSource: 'estimated' };
}

export function modelMatches(requested, served) {
  if (typeof served !== 'string' || !served) return true;
  if (served === requested) return true;
  return served.endsWith(`/${requested}`) || requested.endsWith(`/${served}`);
}

function delayMs(attempt, response, random) {
  const header = response?.headers?.get?.('retry-after');
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const base = 200 * (2 ** attempt);
  return Math.min(base + Math.floor(random() * 100), 30_000);
}

// The transcript appends one row per turn with only the messages added since the previous row, so its size
// grows with the conversation, not with its square (each turn used to repeat every earlier message).
function transcriptWriter(transcriptPath) {
  let written = 0;
  return {
    event(row) {
      if (!transcriptPath) return;
      fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
      fs.appendFileSync(transcriptPath, `${JSON.stringify(row)}\n`);
    },
    turn(row, body) {
      const { messages, ...request } = body;
      this.event({ ...row, request: { ...request, messagesFrom: written, messages: messages.slice(written) } });
      written = messages.length;
    },
  };
}

// POST one turn with retries on 429/5xx (Retry-After honoured). Returns {response} or {failure, status?}.
async function postTurn({ fetchFn, url, body, apiKey, headers, timeoutMs, sleep, random, transcript, turn }) {
  for (let attempt = 1; ; attempt++) {
    const init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey || ''}`, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) };
    let response;
    try { response = await fetchFn(url, init); }
    catch (error) {
      transcript.event({ turn, attempt, error: error.name || 'fetch_failed' });
      return { failure: error.code === 'LIVE_REQUIRED' ? 'live_required' : 'timeout' };
    }
    if (response.status === 401 || response.status === 403) { transcript.event({ turn, attempt, status: response.status }); return { failure: 'auth' }; }
    if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      transcript.event({ turn, attempt, status: response.status });
      await sleep(delayMs(attempt, response, random));
      continue;
    }
    if (!response.ok) { transcript.event({ turn, attempt, status: response.status }); return { failure: 'provider', status: response.status }; }
    return { response };
  }
}

// Run the model's tool calls through the bridge; a call the bridge refuses comes back as tool text.
async function runCalls(calls, callTool, messages) {
  let submitted = false;
  for (const call of calls) {
    let text;
    if (call.error) text = `Tool error: ${call.error}`;
    else {
      try { text = String(await callTool(call.name, call.args) ?? ''); }
      catch (error) { text = `Tool error: ${error.message || error}`; }
    }
    messages.push({ role: 'tool', tool_call_id: call.id, content: text });
    if (SUBMIT_TOOLS.has(call.name)) submitted = true;
  }
  return submitted;
}

export async function runToolLoop({
  baseUrl, apiKey, model, headers = {}, extraBody = {}, tools = [], callTool, brief, maxTurns = 40, submitTool = 'submit_audit_report',
  provider = 'zai', env = process.env, fetchImpl, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random, transcriptPath, timeoutMs = Number(env.OMNI_API_TIMEOUT_MS) || 300_000, maxCostUsd = null, prices = null,
} = {}) {
  if (!baseUrl || !model || typeof callTool !== 'function') throw new Error('runToolLoop needs baseUrl, model and callTool');
  if (!SUBMIT_TOOLS.has(submitTool)) throw new Error(`runToolLoop: unknown submit tool ${submitTool}`);
  if (!fetchImpl && env.OMNI_HTTP_REPLAY) resetReplayTurns();
  const fetchFn = fetchImpl || selectFetch({ env, provider });
  const messages = [{ role: 'user', content: String(brief || '') }];
  const usage = [];
  const transcript = transcriptWriter(transcriptPath);
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  let servedModel = null;
  let turns = 0;
  const end = (stop, extra = {}) => ({ stop, turns, usage, servedModel, transcriptPath: transcriptPath || null, ...extra });
  for (let turn = 1; turn <= maxTurns; turn++) {
    const body = { model, messages, tools, stream: false, ...extraBody, ...(turn === maxTurns ? { tool_choice: { type: 'function', function: { name: submitTool } } } : {}) };
    const posted = await postTurn({ fetchFn, url, body, apiKey, headers, timeoutMs, sleep, random, transcript, turn });
    if (posted.failure) return end('error', { failure: posted.failure, ...(posted.status ? { status: posted.status } : {}) });
    const payload = typeof posted.response.json === 'function' ? await posted.response.json() : posted.response.body;
    turns += 1;
    servedModel = typeof payload?.model === 'string' ? payload.model : servedModel;
    if (payload?.usage && typeof payload.usage === 'object') usage.push(applyPrice({ ...payload.usage, model: payload.model }, { prices, provider, model }));
    transcript.turn({ turn, status: posted.response.status, model: servedModel }, body);
    if (!modelMatches(model, servedModel)) return end('error', { failure: 'model_mismatch' });
    const spent = usage.reduce((total, row) => total + (Number(row.cost) || 0), 0);
    if (maxCostUsd != null && spent >= maxCostUsd) return end('cost', { cost: spent });
    const message = payload?.choices?.[0]?.message || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(parseToolCall) : [];
    messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: message.tool_calls } : {}) });
    if (!calls.length) return end(turn === maxTurns ? 'budget' : 'no_tools');
    if (await runCalls(calls, callTool, messages)) return end('submitted');
  }
  return end('budget');
}
