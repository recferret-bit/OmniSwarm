// @ts-check
// Local indexer for the near-sandbox stack. Binds 127.0.0.1:3031 only.
// Account age is the NearBlocks shape, filled from the creation file seed writes later.
// Explorer pages read the sandbox RPC. Dev keys are served to loopback clients only.
// The W15-00 spike showed the sandbox already sends Access-Control-Allow-Origin: *, so RPC is not proxied.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, loadAddress, loadTransaction, page, renderAddress, renderTransaction, unreachablePage } from './indexer-rpc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

export const CORS_ORIGIN = 'http://omniswarm.localhost:18480';
export const DEFAULT_PORT = 3031;
export const DEFAULT_CREATED_FILE = path.join(REPO_ROOT, 'infra/compose/.local/near/created.json');
export const DEFAULT_KEYS_DIR = path.join(REPO_ROOT, 'infra/compose/.local/near/keys');
export const DEFAULT_RPC_URL = 'http://127.0.0.1:3030';
export const DEFAULT_CONTRACT_ID = 'registry.test.near';

// Same shape nearcore accepts. `..` and a leading dot are not account ids.
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LOOPBACK_RPC = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

// Genesis validator, the registry, and the accounts seed creates. Used when a tx URL has no sender.
const LOCAL_ACCOUNTS = [
  'test.near',
  'registry.test.near',
  'owner.test.near',
  'operator.test.near',
  'treasury.test.near',
  'alice.test.near',
  'bob.test.near',
  'good-dex.test.near',
  'drained-vault.test.near',
  'phish.test.near',
];

const USAGE = `usage: node infra/near-local/indexer.mjs [--port 3031] [--created file] [--keys dir] [--rpc url] [--contract id]

Serves the local NearBlocks account route, /txns/<hash>, /address/<id>, and /wallet/accounts.
Binds 127.0.0.1 only. Does not proxy the sandbox RPC.
`;

export class IndexerError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {string} id
 */
export function isAccountId(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 && ACCOUNT_ID.test(id);
}

/**
 * @param {string} hash
 */
export function isTxHash(hash) {
  return TX_HASH.test(hash);
}

/**
 * Loopback only. Node reports 127.0.0.1 for a socket bound to 127.0.0.1, and ::1 for IPv6 loopback.
 * @param {string | undefined | null} address
 */
export function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1';
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ help?: boolean, port?: number, createdFile?: string, keysDir?: string, rpcUrl?: string, contractId?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--port') {
      const value = next();
      if (!/^\d+$/.test(value)) throw new Error('--port must be an integer from 0 to 65535');
      out.port = Number(value);
    } else if (arg === '--created') out.createdFile = next();
    else if (arg === '--keys') out.keysDir = next();
    else if (arg === '--rpc') out.rpcUrl = next();
    else if (arg === '--contract') out.contractId = next();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (out.port === 3030) throw new Error('port 3030 is the sandbox RPC; the indexer binds 3031');
  return out;
}

/**
 * @param {{ port?: number, createdFile?: string, keysDir?: string, rpcUrl?: string, contractId?: string, fetch?: typeof fetch }} [options]
 */
export function resolveOptions(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535');
  if (port === 3030) throw new Error('port 3030 is the sandbox RPC; the indexer binds 3031');
  const rpcUrl = options.rpcUrl ?? process.env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;
  if (!LOOPBACK_RPC.test(rpcUrl)) throw new Error('NEAR_RPC_URL must be an http:// loopback URL');
  const contractId = options.contractId ?? process.env.NEAR_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
  if (!isAccountId(contractId)) throw new Error('NEAR_CONTRACT_ID is not an account id');
  return {
    port,
    host: '127.0.0.1',
    createdFile: options.createdFile ?? process.env.CREATED_ACCOUNTS_FILE ?? DEFAULT_CREATED_FILE,
    keysDir: options.keysDir ?? process.env.NEAR_KEYS_DIR ?? DEFAULT_KEYS_DIR,
    rpcUrl,
    contractId,
    fetch: options.fetch ?? globalThis.fetch,
  };
}

/**
 * seed writes `{ accountId: { blockTimestampNs, blockHeight } }`.
 * Nanosecond timestamps do not fit in a JSON number, so a non-safe integer is refused rather than rounded.
 * A missing file means nothing has been seeded yet.
 * @param {string} file
 */
export async function loadCreated(file) {
  let text;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {};
    throw new IndexerError(500, 'cannot read created accounts file');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IndexerError(500, 'created.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new IndexerError(500, 'created.json must be an object');
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {unknown} record
 * @param {string} accountId
 * @returns {number | string}
 */
function timestampOf(record, accountId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new IndexerError(500, `created.json entry for ${accountId} is not an object`);
  }
  const raw = /** @type {{ blockTimestampNs?: unknown }} */ (record).blockTimestampNs;
  if (typeof raw === 'string' && /^\d{1,22}$/.test(raw)) return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
  throw new IndexerError(500, `blockTimestampNs for ${accountId} must be a decimal string or a safe integer`);
}

/**
 * Near-cli credentials (`private_key`) and validator-key files (`secret_key`). Secrets stay in the JSON body.
 * @param {string} dir
 */
export async function readDevKeys(dir) {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new IndexerError(500, 'cannot read dev keys');
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  /** @type {Array<{ account_id: string, public_key?: string, private_key?: string }>} */
  const accounts = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    let text;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > 65_536) continue;
      text = await fs.promises.readFile(file, 'utf8');
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = /** @type {{ account_id?: unknown, public_key?: unknown, private_key?: unknown, secret_key?: unknown }} */ (parsed);
    const fromName = entry.name.slice(0, -'.json'.length);
    const accountId = typeof record.account_id === 'string' && isAccountId(record.account_id)
      ? record.account_id
      : (isAccountId(fromName) ? fromName : null);
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    /** @type {{ account_id: string, public_key?: string, private_key?: string }} */
    const row = { account_id: accountId };
    if (typeof record.public_key === 'string') row.public_key = record.public_key;
    const secret = typeof record.private_key === 'string' ? record.private_key : (typeof record.secret_key === 'string' ? record.secret_key : null);
    if (secret) row.private_key = secret;
    accounts.push(row);
  }
  return accounts;
}

/**
 * @param {Awaited<ReturnType<typeof resolveOptions>>} ctx
 * @param {string | null} explicit
 */
async function transactionSenders(ctx, explicit) {
  const created = await loadCreated(ctx.createdFile);
  const keys = await readDevKeys(ctx.keysDir);
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();
  for (const id of [explicit ?? '', ...Object.keys(created), ...keys.map((row) => row.account_id), ...LOCAL_ACCOUNTS]) {
    if (!id || seen.has(id) || !isAccountId(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} headers
 */
function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * @param {string} contentType
 * @param {Record<string, string>} [extra]
 */
function headers(contentType, extra = {}) {
  return {
    'access-control-allow-origin': CORS_ORIGIN,
    'cache-control': 'no-store',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  send(res, status, `${JSON.stringify(body)}\n`, headers('application/json; charset=utf-8'));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} text
 */
function sendText(res, status, text) {
  send(res, status, text.endsWith('\n') ? text : `${text}\n`, headers('text/plain; charset=utf-8'));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
function sendHtml(res, status, html) {
  send(res, status, html, headers('text/html; charset=utf-8', {
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  }));
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Awaited<ReturnType<typeof resolveOptions>>} ctx
 */
async function route(req, res, ctx) {
  if (!isLoopback(req.socket?.remoteAddress)) {
    sendText(res, 403, 'forbidden');
    return;
  }
  if (req.method === 'OPTIONS') {
    send(res, 204, '', headers('text/plain; charset=utf-8', {
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'accept, authorization, content-type',
      'access-control-max-age': '600',
      'content-length': '0',
    }));
    return;
  }
  if (req.method !== 'GET') throw new IndexerError(405, 'method not allowed');

  let url;
  try {
    url = new URL(req.url || '/', 'http://127.0.0.1');
  } catch {
    throw new IndexerError(400, 'bad request');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
  } catch {
    throw new IndexerError(400, 'bad request');
  }

  const account = /^\/v1\/account\/([^/]+)$/.exec(pathname);
  if (account) {
    if (!isAccountId(account[1])) throw new IndexerError(400, 'account id is invalid');
    const created = await loadCreated(ctx.createdFile);
    if (!Object.prototype.hasOwnProperty.call(created, account[1])) {
      sendJson(res, 200, { account: [] });
      return;
    }
    const blockTimestamp = timestampOf(created[account[1]], account[1]);
    sendJson(res, 200, { account: [{ created: { block_timestamp: blockTimestamp } }] });
    return;
  }

  const tx = /^\/txns\/([^/]+)$/.exec(pathname);
  if (tx) {
    if (!isTxHash(tx[1])) throw new IndexerError(400, 'transaction hash is invalid');
    const explicit = url.searchParams.get('sender') ?? url.searchParams.get('account_id');
    if (explicit !== null && !isAccountId(explicit)) throw new IndexerError(400, 'sender is not an account id');
    const senders = await transactionSenders(ctx, explicit);
    try {
      const loaded = await loadTransaction({ fetch: ctx.fetch, rpcUrl: ctx.rpcUrl, hash: tx[1], senders });
      const rendered = renderTransaction(tx[1], loaded);
      sendHtml(res, rendered.status, rendered.html);
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error).code === 'UNREACHABLE') {
        sendHtml(res, 502, unreachablePage());
        return;
      }
      throw error;
    }
    return;
  }

  const address = /^\/address\/([^/]+)$/.exec(pathname);
  if (address) {
    if (!isAccountId(address[1])) throw new IndexerError(400, 'account id is invalid');
    try {
      const loaded = await loadAddress({
        fetch: ctx.fetch,
        rpcUrl: ctx.rpcUrl,
        contractId: ctx.contractId,
        accountId: address[1],
      });
      sendHtml(res, 200, renderAddress(address[1], loaded.view, loaded.attestation));
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error).code === 'UNREACHABLE') {
        sendHtml(res, 502, unreachablePage());
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/wallet/accounts') {
    const accounts = await readDevKeys(ctx.keysDir);
    sendJson(res, 200, { accounts });
    return;
  }

  sendText(res, 404, 'not found');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Awaited<ReturnType<typeof resolveOptions>>} ctx
 */
export async function handleRequest(req, res, ctx) {
  try {
    await route(req, res, ctx);
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof IndexerError) {
      const html = req.url && (/^\/txns\/|^\/address\//.test(req.url));
      if (html) sendHtml(res, error.status, page('Indexer', `<p>${escapeHtml(error.message)}</p>\n`));
      else sendText(res, error.status, error.message);
      return;
    }
    console.error(`indexer: ${error instanceof Error ? error.message : 'request failed'}`);
    sendText(res, 500, 'indexer error');
  }
}

/**
 * @param {Parameters<typeof resolveOptions>[0]} [options]
 */
export function createServer(options = {}) {
  const ctx = resolveOptions(options);
  const server = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((error) => {
      console.error(`indexer: ${error instanceof Error ? error.message : 'request failed'}`);
    });
  });
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

/**
 * @param {Parameters<typeof resolveOptions>[0]} [options]
 * @returns {Promise<import('node:http').Server>}
 */
export function startServer(options = {}) {
  const server = createServer(options);
  const ctx = resolveOptions(options);
  return new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ error) => reject(error);
    server.once('error', onError);
    server.listen(ctx.port, ctx.host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

/**
 * @param {import('node:http').Server} server
 */
export function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`indexer: ${error instanceof Error ? error.message : 'bad arguments'}`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  let server;
  try {
    server = await startServer(args);
  } catch (error) {
    console.error(`indexer: ${error instanceof Error ? error.message : 'failed to listen'}`);
    process.exit(1);
  }
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : args.port;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const done = () => process.exit(0);
    const timer = setTimeout(done, 1000);
    timer.unref();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => {
      clearTimeout(timer);
      done();
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log(`indexer listening on http://127.0.0.1:${port}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
