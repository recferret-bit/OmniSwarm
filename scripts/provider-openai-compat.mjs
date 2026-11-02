// One non-streaming chat-completions tool loop shared by key: and openrouter: reviewers.
// ORCHESTRATION sections 1 and 1.1. The loop never opens a socket unless the caller passes fetch
// or OMNI_LIVE=1; replay and tests inject fetch.
import fs from 'node:fs';
import path from 'node:path';
import { resetReplayTurns, selectFetch } from './http-replay.mjs';

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

function parseToolCall(entry) {
  const name = entry?.function?.name || entry?.name;
  let args = entry?.function?.arguments ?? entry?.arguments ?? {};
  if (typeof args === 'string') {
    try { args = args ? JSON.parse(args) : {}; }
    catch { args = { _raw: args }; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  return { id: String(entry?.id || name || 'call'), name: String(name || ''), args };
}

function scrubBody(body) {
  const copy = JSON.parse(JSON.stringify(body));
  return copy;
}

export async function runToolLoop({
  baseUrl, apiKey, model, headers = {}, extraBody = {}, tools = [], callTool, brief, maxTurns = 40,
  provider = 'zai', env = process.env, fetchImpl, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random, transcriptPath, timeoutMs = Number(env.OMNI_API_TIMEOUT_MS) || 300_000, maxCostUsd = null, prices = null,
} = {}) {
  if (!baseUrl || !model || typeof callTool !== 'function') throw new Error('runToolLoop needs baseUrl, model and callTool');
  if (!fetchImpl && env.OMNI_HTTP_REPLAY) resetReplayTurns();
  const fetchFn = fetchImpl || selectFetch({ env, provider });
  const messages = [{ role: 'user', content: String(brief || '') }];
  const usage = [];
  let servedModel = null;
  let turns = 0;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const writeTranscript = (row) => {
    if (!transcriptPath) return;
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.appendFileSync(transcriptPath, `${JSON.stringify(row)}\n`);
  };

  for (let turn = 1; turn <= maxTurns; turn++) {
    const body = {
      model, messages, tools, stream: false, ...extraBody,
      ...(turn === maxTurns ? { tool_choice: { type: 'function', function: { name: 'submit_audit_report' } } } : {}),
    };
    let response;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey || ''}`, ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      };
      try {
        response = await fetchFn(url, init);
      } catch (error) {
        writeTranscript({ turn, attempt, error: error.name || 'fetch_failed' });
        if (error.code === 'LIVE_REQUIRED') return { stop: 'error', failure: 'live_required', turns, usage, servedModel, transcriptPath: transcriptPath || null };
        return { stop: 'error', failure: 'timeout', turns, usage, servedModel, transcriptPath: transcriptPath || null };
      }
      if (response.status === 401 || response.status === 403) {
        writeTranscript({ turn, attempt, status: response.status });
        return { stop: 'error', failure: 'auth', turns, usage, servedModel, transcriptPath: transcriptPath || null };
      }
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        writeTranscript({ turn, attempt, status: response.status });
        await sleep(delayMs(attempt, response, random));
        continue;
      }
      break;
    }
    if (!response.ok) {
      writeTranscript({ turn, attempt, status: response.status });
      return { stop: 'error', failure: 'provider', turns, usage, servedModel, status: response.status, transcriptPath: transcriptPath || null };
    }
    const payload = typeof response.json === 'function' ? await response.json() : response.body;
    turns += 1;
    servedModel = typeof payload?.model === 'string' ? payload.model : servedModel;
    if (payload?.usage && typeof payload.usage === 'object') {
      usage.push(applyPrice({ ...payload.usage, model: payload.model }, { prices, provider, model }));
    }
    writeTranscript({ turn, status: response.status, model: servedModel, request: scrubBody(body) });
    if (!modelMatches(model, servedModel)) {
      return { stop: 'error', failure: 'model_mismatch', turns, usage, servedModel, transcriptPath: transcriptPath || null };
    }
    const spent = usage.reduce((total, row) => total + (Number(row.cost) || 0), 0);
    if (maxCostUsd != null && spent >= maxCostUsd) {
      return { stop: 'cost', turns, usage, servedModel, transcriptPath: transcriptPath || null, cost: spent };
    }
    const message = payload?.choices?.[0]?.message || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(parseToolCall) : [];
    messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: message.tool_calls } : {}) });
    if (!calls.length) return { stop: turn === maxTurns ? 'budget' : 'no_tools', turns, usage, servedModel, transcriptPath: transcriptPath || null };
    let submitted = false;
    for (const call of calls) {
      let text;
      try { text = String(await callTool(call.name, call.args) ?? ''); }
      catch (error) { text = `Tool error: ${error.message || error}`; }
      messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      if (SUBMIT_TOOLS.has(call.name)) submitted = true;
    }
    if (submitted) return { stop: 'submitted', turns, usage, servedModel, transcriptPath: transcriptPath || null };
  }
  return { stop: 'budget', turns, usage, servedModel, transcriptPath: transcriptPath || null };
}
