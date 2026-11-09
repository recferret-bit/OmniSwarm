// @ts-check
// Sandbox JSON-RPC reads for the local explorer. nearcore 2.14.0 serves transaction status as
// `tx_status` (receipts included). `EXPERIMENTAL_tx_status` is the same method under its old name,
// and `tx` is the status method without the receipts list. The sandbox RPC already sends
// Access-Control-Allow-Origin: *, so this module never proxies a browser call.

const TX_METHODS = ['tx_status', 'EXPERIMENTAL_tx_status', 'tx'];
const EMPTY_CODE_HASH = '11111111111111111111111111111111';

/**
 * @param {string} [message]
 */
export function unreachable(message = 'The sandbox is unreachable.') {
  const error = new Error(message);
  error.code = 'UNREACHABLE';
  return error;
}

/**
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} title
 * @param {string} body
 */
export function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  code, pre { font-family: ui-monospace, SFMono-Regular, monospace; }
  pre { background: #f4f4f4; padding: 1rem; overflow: auto; white-space: pre-wrap; }
  .muted { color: #555; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function unreachablePage() {
  return page('Sandbox unreachable', '<h1>Sandbox unreachable</h1>\n<p>The sandbox is unreachable.</p>\n');
}

/**
 * @param {unknown} error
 */
function causeName(error) {
  if (!error || typeof error !== 'object') return '';
  const record = /** @type {{ cause?: { name?: unknown }, name?: unknown }} */ (error);
  if (typeof record.cause?.name === 'string') return record.cause.name;
  if (typeof record.name === 'string' && record.name !== 'HANDLER_ERROR' && record.name !== 'REQUEST_VALIDATION_ERROR') return record.name;
  return '';
}

/**
 * @param {unknown} error
 */
export function isMethodNotFound(error) {
  if (!error || typeof error !== 'object') return false;
  const record = /** @type {{ code?: unknown, message?: unknown }} */ (error);
  if (record.code === -32601 || causeName(error) === 'METHOD_NOT_FOUND') return true;
  return typeof record.message === 'string' && /method not found/i.test(record.message);
}

/**
 * @param {unknown} error
 */
export function isUnknownTransaction(error) {
  if (causeName(error) === 'UNKNOWN_TRANSACTION') return true;
  const data = error && typeof error === 'object' ? /** @type {{ data?: unknown }} */ (error).data : '';
  return typeof data === 'string' && /doesn't exist|does not exist|UNKNOWN_TRANSACTION/i.test(data);
}

/**
 * @param {unknown} error
 */
function isUnknownAccount(error) {
  const name = causeName(error);
  if (name === 'UNKNOWN_ACCOUNT' || name === 'INVALID_ACCOUNT') return true;
  const data = error && typeof error === 'object' ? /** @type {{ data?: unknown }} */ (error).data : '';
  return typeof data === 'string' && /does not exist while viewing|UNKNOWN_ACCOUNT/i.test(data);
}

/**
 * @param {unknown} error
 */
function rpcMessage(error) {
  const name = causeName(error);
  if (name) return name;
  if (error && typeof error === 'object' && typeof /** @type {{ message?: unknown }} */ (error).message === 'string') {
    return /** @type {{ message: string }} */ (error).message;
  }
  return 'rpc error';
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} rpcUrl
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {number} [timeoutMs]
 */
async function rpc(fetchImpl, rpcUrl, method, params, timeoutMs = 8000) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'omniswarm-indexer', method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw unreachable();
  }
  if (!response || typeof response.text !== 'function') throw unreachable();
  let text;
  try {
    text = await response.text();
  } catch {
    throw unreachable();
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw unreachable();
  }
  if (!body || typeof body !== 'object') throw unreachable();
  return /** @type {{ result?: unknown, error?: unknown }} */ (body);
}

/**
 * A `wait_until: NONE` answer is enough once execution has produced receipts or reached a terminal level.
 * @param {any} result
 */
function outcomeReady(result) {
  const finality = result?.final_execution_status;
  if (finality === 'EXECUTED_OPTIMISTIC' || finality === 'EXECUTED' || finality === 'FINAL') return true;
  return Array.isArray(result?.receipts_outcome) && result.receipts_outcome.length > 0;
}

/**
 * @param {any} result
 */
function unwrapTx(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.transaction || result.receipts_outcome || result.status || result.final_execution_status) return result;
  if (result.final_execution_outcome && typeof result.final_execution_outcome === 'object') {
    return { ...result.final_execution_outcome, final_execution_status: result.final_execution_status };
  }
  return result;
}

/**
 * @param {{ fetch: typeof fetch, rpcUrl: string, hash: string, senders: string[] }} query
 */
export async function loadTransaction({ fetch: fetchImpl, rpcUrl, hash, senders }) {
  let methodIndex = 0;
  /** @type {unknown} */
  let lastError = null;
  let sawUnknown = false;
  for (const sender of senders) {
    if (methodIndex >= TX_METHODS.length) break;
    while (methodIndex < TX_METHODS.length) {
      const method = TX_METHODS[methodIndex];
      const body = await rpc(fetchImpl, rpcUrl, method, {
        tx_hash: hash,
        sender_account_id: sender,
        wait_until: 'NONE',
      });
      if (body.error && isMethodNotFound(body.error)) {
        methodIndex += 1;
        continue;
      }
      if (body.error && isUnknownTransaction(body.error)) {
        sawUnknown = true;
        break;
      }
      if (body.error || body.result === undefined || body.result === null) {
        lastError = body.error ?? { message: 'empty rpc response' };
        break;
      }
      let result = unwrapTx(body.result);
      if (!outcomeReady(result)) {
        const again = await rpc(fetchImpl, rpcUrl, method, {
          tx_hash: hash,
          sender_account_id: sender,
          wait_until: 'EXECUTED',
        }, 20_000);
        if (again.result) result = unwrapTx(again.result);
      }
      return { result, unsupported: false, missing: false, error: null };
    }
  }
  return {
    result: null,
    unsupported: methodIndex >= TX_METHODS.length && !sawUnknown && !lastError,
    missing: sawUnknown && !lastError,
    error: lastError,
  };
}

/**
 * @param {unknown} status
 */
function statusKey(status) {
  if (typeof status === 'string') return status;
  if (!status || typeof status !== 'object') return 'unknown';
  const key = Object.keys(status)[0];
  return key || 'unknown';
}

/**
 * @param {any} result
 */
function receiptRows(result) {
  /** @type {Map<string, { id: string, from: string, to: string, status: string }>} */
  const rows = new Map();
  const list = Array.isArray(result?.receipts) ? result.receipts : [];
  for (const receipt of list) {
    const id = String(receipt?.receipt_id ?? '');
    rows.set(id || `in:${rows.size}`, {
      id,
      from: String(receipt?.predecessor_id ?? ''),
      to: String(receipt?.receiver_id ?? ''),
      status: '',
    });
  }
  const outcomes = Array.isArray(result?.receipts_outcome) ? result.receipts_outcome : [];
  for (const receipt of outcomes) {
    const id = String(receipt?.id ?? '');
    const status = statusKey(receipt?.outcome?.status);
    const executor = String(receipt?.outcome?.executor_id ?? '');
    const existing = id ? rows.get(id) : undefined;
    if (existing) {
      existing.status = status;
      if (!existing.to) existing.to = executor;
    } else {
      rows.set(id || `out:${rows.size}`, { id, from: '', to: executor, status });
    }
  }
  return [...rows.values()];
}

/**
 * @param {any} result
 */
function collectLogs(result) {
  /** @type {Array<{ kind: 'event' | 'log', name: string | null, json: unknown, raw: string }>} */
  const rows = [];
  /**
   * @param {unknown} logs
   */
  const take = (logs) => {
    if (!Array.isArray(logs)) return;
    for (const line of logs) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('EVENT_JSON:')) {
        const raw = line.slice('EVENT_JSON:'.length);
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
        const name = json && typeof json === 'object' && typeof /** @type {{ event?: unknown }} */ (json).event === 'string'
          ? /** @type {{ event: string }} */ (json).event
          : null;
        rows.push({ kind: 'event', name, json, raw: line });
      } else {
        rows.push({ kind: 'log', name: null, json: null, raw: line });
      }
    }
  };
  take(result?.transaction_outcome?.outcome?.logs);
  if (Array.isArray(result?.receipts_outcome)) {
    for (const receipt of result.receipts_outcome) take(receipt?.outcome?.logs);
  }
  return rows;
}

/**
 * @param {unknown} value
 */
function pretty(value) {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

/**
 * @param {string} hash
 * @param {any} loaded
 */
export function renderTransaction(hash, loaded) {
  if (loaded.unsupported) {
    return {
      status: 200,
      html: page(`Transaction ${hash}`, `<h1>Transaction <code>${escapeHtml(hash)}</code></h1>\n<p>The sandbox RPC does not support tx status.</p>\n`),
    };
  }
  if (!loaded.result) {
    const detail = loaded.error ? escapeHtml(rpcMessage(loaded.error)) : 'Transaction not found on the sandbox.';
    const text = loaded.error ? `Transaction status failed: ${detail}` : detail;
    return {
      status: loaded.error ? 200 : 404,
      html: page(`Transaction ${hash}`, `<h1>Transaction <code>${escapeHtml(hash)}</code></h1>\n<p>${text}</p>\n`),
    };
  }
  const result = loaded.result;
  const finality = String(result.final_execution_status ?? 'unknown');
  const execution = statusKey(result.status);
  const signer = String(result.transaction?.signer_id ?? '');
  const receiver = String(result.transaction?.receiver_id ?? '');
  const receipts = receiptRows(result);
  const receiptList = receipts.length === 0
    ? '<p class="muted">No receipts.</p>'
    : `<ul>\n${receipts.map((row) => {
      const route = [row.from, row.to].filter(Boolean).join(' → ');
      const bits = [row.id && `<code>${escapeHtml(row.id)}</code>`, route && escapeHtml(route), row.status && escapeHtml(row.status)].filter(Boolean);
      return `  <li>${bits.join(' — ')}</li>`;
    }).join('\n')}\n</ul>`;
  const logs = collectLogs(result);
  const events = logs.filter((row) => row.kind === 'event');
  const eventList = events.length === 0
    ? '<p class="muted">No EVENT_JSON logs.</p>'
    : events.map((row) => {
      const title = row.name ?? 'event';
      const body = row.json === null ? row.raw : pretty(row.json);
      return `<section>\n<h3>${escapeHtml(title)}</h3>\n<pre>${escapeHtml(body)}</pre>\n</section>`;
    }).join('\n');
  const otherLogs = logs.filter((row) => row.kind === 'log');
  const other = otherLogs.length === 0
    ? ''
    : `<h2>Logs</h2>\n<pre>${escapeHtml(otherLogs.map((row) => row.raw).join('\n'))}</pre>\n`;
  const failure = execution === 'Failure' ? `<h2>Failure</h2>\n<pre>${escapeHtml(pretty(result.status))}</pre>\n` : '';
  const html = page(`Transaction ${hash}`, `<h1>Transaction <code>${escapeHtml(hash)}</code></h1>
<p>Status: ${escapeHtml(finality)}</p>
<p>Execution: ${escapeHtml(execution)}</p>
<p>Signer: <code>${escapeHtml(signer)}</code> → <code>${escapeHtml(receiver)}</code></p>
<h2>Receipts</h2>
${receiptList}
<h2>Events</h2>
${eventList}
${failure}${other}`);
  return { status: 200, html };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} rpcUrl
 * @param {string} accountId
 */
async function viewAccount(fetchImpl, rpcUrl, accountId) {
  const body = await rpc(fetchImpl, rpcUrl, 'query', {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  if (body.error) {
    if (isUnknownAccount(body.error)) return { missing: true, codeHash: null, error: null };
    return { missing: false, codeHash: null, error: rpcMessage(body.error) };
  }
  const codeHash = /** @type {{ code_hash?: unknown }} */ (body.result ?? {}).code_hash;
  return { missing: false, codeHash: typeof codeHash === 'string' ? codeHash : null, error: null };
}

/**
 * @param {unknown} result
 */
function decodeCallResult(result) {
  const raw = result && typeof result === 'object' ? /** @type {{ result?: unknown }} */ (result).result : undefined;
  if (Array.isArray(raw)) return Buffer.from(raw).toString('utf8');
  if (typeof raw === 'string') {
    try {
      return Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} rpcUrl
 * @param {string} contractId
 * @param {string} accountId
 */
async function viewAttestation(fetchImpl, rpcUrl, contractId, accountId) {
  const args = Buffer.from(JSON.stringify({ account: accountId }), 'utf8').toString('base64');
  const body = await rpc(fetchImpl, rpcUrl, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: 'get_attestation_for_account',
    args_base64: args,
  });
  if (body.error) {
    if (isUnknownAccount(body.error)) return { value: null, error: null };
    return { value: null, error: rpcMessage(body.error) };
  }
  const text = decodeCallResult(body.result);
  if (text === null || text === '' || text === 'null') return { value: null, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch {
    return { value: null, error: 'attestation was not JSON' };
  }
}

/**
 * @param {{ fetch: typeof fetch, rpcUrl: string, contractId: string, accountId: string }} query
 */
export async function loadAddress({ fetch: fetchImpl, rpcUrl, contractId, accountId }) {
  const view = await viewAccount(fetchImpl, rpcUrl, accountId);
  const attestation = await viewAttestation(fetchImpl, rpcUrl, contractId, accountId);
  return { view, attestation };
}

/**
 * @param {string} accountId
 * @param {{ missing: boolean, codeHash: string | null, error: string | null }} view
 * @param {{ value: unknown, error: string | null }} attestation
 */
export function renderAddress(accountId, view, attestation) {
  let codeLine;
  if (view.missing) codeLine = 'Code hash: account not found';
  else if (view.error) codeLine = `Code hash: unavailable (${view.error})`;
  else if (!view.codeHash) codeLine = 'Code hash: unknown';
  else if (view.codeHash === EMPTY_CODE_HASH) codeLine = `Code hash: ${view.codeHash} (no contract deployed)`;
  else codeLine = `Code hash: ${view.codeHash}`;
  let attestLine;
  if (attestation.error) attestLine = `Attestation: unavailable (${attestation.error})`;
  else if (attestation.value === null || attestation.value === undefined) attestLine = 'Attestation: none';
  else if (typeof attestation.value === 'object' && attestation.value && typeof /** @type {{ max_severity?: unknown }} */ (attestation.value).max_severity === 'string') {
    attestLine = `Attestation: ${/** @type {{ max_severity: string }} */ (attestation.value).max_severity}`;
  } else attestLine = 'Attestation: present';
  const detail = attestation.value === null || attestation.value === undefined
    ? ''
    : `<pre>${escapeHtml(pretty(attestation.value))}</pre>\n`;
  return page(`Account ${accountId}`, `<h1>Account <code>${escapeHtml(accountId)}</code></h1>
<p>${escapeHtml(codeLine)}</p>
<p>${escapeHtml(attestLine)}</p>
${detail}`);
}
