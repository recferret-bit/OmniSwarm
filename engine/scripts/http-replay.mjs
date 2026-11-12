// Recorded provider responses for offline runs. OMNI_HTTP_REPLAY serves them; OMNI_HTTP_RECORD writes them
// with Authorization removed. A request that is neither replayed nor marked OMNI_LIVE=1 fails before any socket.
import fs from 'node:fs';
import path from 'node:path';

const counters = new Map();

function turnFile(root, provider) {
  const key = `${root}\0${provider}`;
  const turn = counters.get(key) || 0;
  counters.set(key, turn + 1);
  return path.join(root, provider, `${turn}.json`);
}

export function resetReplayTurns() { counters.clear(); }

function responseFrom(recorded) {
  const status = recorded.status || 200;
  const headers = recorded.headers || {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => recorded.body,
    text: async () => JSON.stringify(recorded.body ?? {}),
  };
}

export function replayFetch(root, provider) {
  return async () => {
    const file = turnFile(root, provider);
    if (!fs.existsSync(file)) {
      const error = new Error('refusing a live provider request without OMNI_LIVE=1');
      error.code = 'LIVE_REQUIRED';
      throw error;
    }
    return responseFrom(JSON.parse(fs.readFileSync(file, 'utf8')));
  };
}

function scrubHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/authorization|api-key|x-api-key/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function recordExchange(root, provider, init, response) {
  const file = turnFile(root, provider);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = typeof response.json === 'function' ? await response.json() : response.body;
  const headers = {};
  if (response.headers?.forEach) response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const saved = { status: response.status || 200, headers, body, requestHeaders: scrubHeaders(init?.headers) };
  fs.writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
  return responseFrom(saved);
}

export function selectFetch({ env = process.env, provider = 'nearai' } = {}) {
  if (env.OMNI_HTTP_REPLAY) return replayFetch(env.OMNI_HTTP_REPLAY, provider);
  return async (url, init) => {
    if (env.OMNI_LIVE !== '1') {
      const error = new Error('refusing a live provider request without OMNI_LIVE=1');
      error.code = 'LIVE_REQUIRED';
      throw error;
    }
    const response = await globalThis.fetch(url, init);
    if (env.OMNI_HTTP_RECORD) return recordExchange(env.OMNI_HTTP_RECORD, provider, init, response);
    return response;
  };
}
