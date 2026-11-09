// @ts-check
// Read-only MCP server for the guard. Stdio, JSON-RPC, no dependencies beyond this package.
// It holds no key and never signs. Tools: guard_verdict, get_attestation, is_reported.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGuard, isAccountId, registryReader, toSchemaAttestation } from './index.mjs';
import { createRecordedReader } from './src/recorded-reader.mjs';

const NETWORKS = new Set(['testnet', 'mainnet', 'sandbox']);

/** @typedef {import('./types.js').ChainReader} ChainReader */
/** @typedef {import('./types.js').Verdict} Verdict */
/** @typedef {import('./types.js').ChainAttestation} ChainAttestation */

export const TOOLS = [
  {
    name: 'guard_verdict',
    description: 'Read-only allow, warn or block for a NEAR account before anything is signed. This server holds no key.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'NEAR account id' },
        network: { type: 'string', enum: ['testnet', 'mainnet', 'sandbox'] },
      },
    },
  },
  {
    name: 'get_attestation',
    description: 'Read the registry attestation for an account, or for a request hash. Read-only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        account: { type: 'string', description: 'NEAR account id' },
        request_hash: { type: 'string', description: '64-hex request hash. Needs --rpc and --contract, or a recorded snapshot.' },
      },
    },
  },
  {
    name: 'is_reported',
    description: 'Read whether the registry blocklist reports an account. Read-only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['account'],
      properties: { account: { type: 'string', description: 'NEAR account id' } },
    },
  },
];

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ api: string | null, network: 'testnet' | 'mainnet' | 'sandbox', rpc: string | null, contract: string | null, recorded: string | null }} */
  const out = { api: null, network: 'sandbox', rpc: null, contract: null, recorded: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--key' || flag === '--secret' || flag === '--keystore') throw new Error('the guard MCP server holds no key');
    if (!flag?.startsWith('--')) throw new Error(`unexpected argument ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    i += 1;
    if (flag === '--api') out.api = value;
    else if (flag === '--network') {
      if (!NETWORKS.has(value)) throw new Error(`unknown network ${value}`);
      out.network = /** @type {'testnet' | 'mainnet' | 'sandbox'} */ (value);
    } else if (flag === '--rpc') out.rpc = value;
    else if (flag === '--contract') out.contract = value;
    else if (flag === '--recorded') out.recorded = value;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!out.api && !out.recorded && !(out.rpc && out.contract)) throw new Error('pass --api, --recorded, or both --rpc and --contract');
  if ((out.rpc && !out.contract) || (!out.rpc && out.contract)) throw new Error('--rpc and --contract are used together');
  return out;
}

/**
 * @param {unknown} account
 */
function accountOf(account) {
  if (!isAccountId(account)) throw new Error('account must be a NEAR account id');
  return account;
}

/**
 * @param {unknown} network
 * @param {'testnet' | 'mainnet' | 'sandbox'} fallback
 */
function networkOf(network, fallback) {
  if (network === undefined) return fallback;
  if (typeof network !== 'string' || !NETWORKS.has(network)) throw new Error('network must be testnet, mainnet or sandbox');
  return /** @type {'testnet' | 'mainnet' | 'sandbox'} */ (network);
}

/**
 * @param {string} rpcUrl
 * @param {string} method
 * @param {unknown} params
 * @param {typeof fetch} fetchImpl
 */
async function rpcCall(rpcUrl, method, params, fetchImpl) {
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'omniswarm-guard', method, params }),
  });
  if (!response.ok) throw new Error(`rpc answered ${response.status}`);
  const body = await response.json();
  if (body?.error) throw new Error(body.error.message || 'rpc error');
  return body.result;
}

/**
 * @param {string} rpcUrl
 * @param {string} contractId
 * @param {string} method
 * @param {Record<string, unknown>} args
 * @param {typeof fetch} fetchImpl
 */
async function contractCall(rpcUrl, contractId, method, args, fetchImpl) {
  const result = await rpcCall(rpcUrl, 'query', {
    request_type: 'call_function', account_id: contractId, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final',
  }, fetchImpl);
  const text = new TextDecoder().decode(Uint8Array.from(result?.result ?? []));
  return text ? JSON.parse(text) : null;
}

/** A ChainReader over JSON-RPC view calls. No key and no broadcast. */
export function rpcReader(rpcUrl, contractId, fetchImpl) {
  const view = (method, args) => contractCall(rpcUrl, contractId, method, args ?? {}, fetchImpl);
  return {
    ...registryReader(view),
    getAccount: async (id) => {
      const result = await rpcCall(rpcUrl, 'query', { request_type: 'view_account', account_id: id, finality: 'final' }, fetchImpl);
      return result?.code_hash ? { codeHash: result.code_hash } : null;
    },
    getBlockTimestampMs: async (height) => {
      const result = await rpcCall(rpcUrl, 'block', { block_id: height }, fetchImpl);
      return Number(BigInt(result.header.timestamp) / 1_000_000n);
    },
  };
}

/**
 * @param {{ apiUrl: string, network: 'testnet' | 'mainnet' | 'sandbox', fetchImpl: typeof fetch }} options
 * @param {string} account
 * @returns {Promise<Verdict>}
 */
async function apiVerdict(options, account) {
  const url = new URL('/api/guard/verdict', options.apiUrl);
  url.searchParams.set('account', account);
  url.searchParams.set('network', options.network);
  const response = await options.fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`guard API answered ${response.status}`);
  const body = await response.json();
  if (!body || typeof body.verdict !== 'string' || !Array.isArray(body.reasons)) throw new Error('malformed guard verdict');
  return body;
}

/**
 * @param {ChainAttestation | null | undefined} attestation
 */
function schemaAttestation(attestation) {
  if (!attestation) return null;
  return toSchemaAttestation(attestation);
}

/**
 * @param {{
 *   reader?: ChainReader | null,
 *   records?: { attestations?: Record<string, ChainAttestation> } | null,
 *   apiUrl?: string | null,
 *   network?: 'testnet' | 'mainnet' | 'sandbox',
 *   rpcUrl?: string | null,
 *   contractId?: string | null,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function createGuardServer(options) {
  const network = options.network ?? 'sandbox';
  const fetchImpl = options.fetchImpl ?? fetch;
  const reader = options.reader ?? (options.rpcUrl && options.contractId ? rpcReader(options.rpcUrl, options.contractId, fetchImpl) : null);
  const guard = reader ? createGuard({ reader }) : null;

  async function verdict(account, asked) {
    const id = accountOf(account);
    const selected = networkOf(asked, network);
    if (options.apiUrl) return apiVerdict({ apiUrl: options.apiUrl, network: selected, fetchImpl }, id);
    if (!guard) throw new Error('guard_verdict needs --api or a reader');
    return guard.check(id);
  }

  return {
    tools: () => TOOLS,
    /**
     * @param {string} name
     * @param {Record<string, unknown>} args
     */
    async call(name, args) {
      if (name === 'guard_verdict') return verdict(args.account, args.network);
      if (name === 'get_attestation') return { attestation: await attestationOf(args) };
      if (name === 'is_reported') return { reported: await reportedOf(args.account) };
      throw new Error(`unknown tool ${name}`);
    },
  };

  /**
   * @param {Record<string, unknown>} args
   */
  async function attestationOf(args) {
    const hasAccount = args.account !== undefined;
    const hasHash = args.request_hash !== undefined;
    if (hasAccount === hasHash) throw new Error('pass account or request_hash');
    if (hasHash) {
      if (typeof args.request_hash !== 'string' || !/^[0-9a-f]{64}$/.test(args.request_hash)) throw new Error('request_hash must be 64 hex characters');
      const stored = Object.values(options.records?.attestations ?? {}).find((row) => row?.request_hash === args.request_hash);
      if (stored) return schemaAttestation(stored);
      if (options.rpcUrl && options.contractId) {
        const parsed = await contractCall(options.rpcUrl, options.contractId, 'get_attestation', { request_hash: args.request_hash }, fetchImpl);
        return schemaAttestation(parsed);
      }
      throw new Error('request_hash needs --rpc and --contract, or a recorded snapshot');
    }
    const id = accountOf(args.account);
    if (reader?.getAttestationForAccount) return schemaAttestation(await reader.getAttestationForAccount(id));
    const body = await verdict(id, args.network);
    return body.attestation ?? null;
  }

  /**
   * @param {unknown} account
   */
  async function reportedOf(account) {
    const id = accountOf(account);
    if (reader?.isReported) return reader.isReported(id);
    const body = await verdict(id, undefined);
    if (body.reasons.includes('REPORTED')) return true;
    const unavailable = /** @type {{ unavailable?: unknown }} */ (body.signals).unavailable;
    if (Array.isArray(unavailable) && unavailable.includes('reported')) throw new Error('is_reported unavailable');
    return false;
  }
}

/**
 * @param {unknown} message
 */
function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

/**
 * @param {ReturnType<typeof createGuardServer>} server
 * @param {any} message
 */
export async function handleMessage(server, message) {
  if (!message || typeof message !== 'object') return null;
  if (typeof message.method === 'string' && message.method.startsWith('notifications/')) return null;
  const id = message.id ?? null;
  try {
    if (message.method === 'initialize') {
      return result(id, {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'omniswarm-guard', version: '0.0.0' },
      });
    }
    if (message.method === 'ping') return result(id, {});
    if (message.method === 'tools/list') return result(id, { tools: server.tools() });
    if (message.method === 'tools/call') {
      const body = await server.call(message.params?.name, message.params?.arguments ?? {});
      return result(id, { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false });
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${message.method}` } };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (message.method === 'tools/call') return result(id, { content: [{ type: 'text', text }], isError: true });
    return { jsonrpc: '2.0', id, error: { code: -32000, message: text } };
  }
}

export function encodeFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

export class FrameDecoder {
  constructor() {
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {any[]}
   */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    /** @type {any[]} */
    const messages = [];
    while (this.buf.length) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep === -1) break;
      const header = this.buf.subarray(0, sep).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buf = this.buf.subarray(sep + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = sep + 4;
      if (this.buf.length < start + length) break;
      messages.push(JSON.parse(this.buf.subarray(start, start + length).toString('utf8')));
      this.buf = this.buf.subarray(start + length);
    }
    return messages;
  }
}

/**
 * @param {string[]} argv
 * @param {typeof fetch} [fetchImpl]
 */
export async function serverFromArgs(argv, fetchImpl = fetch) {
  const args = parseArgs(argv);
  if (args.recorded) {
    const records = JSON.parse(readFileSync(args.recorded, 'utf8'));
    return createGuardServer({ reader: createRecordedReader(records), records, network: args.network, fetchImpl });
  }
  return createGuardServer({
    apiUrl: args.api, network: args.network, rpcUrl: args.rpc, contractId: args.contract, fetchImpl,
  });
}

async function main() {
  const server = await serverFromArgs(process.argv.slice(2));
  const decoder = new FrameDecoder();
  for await (const chunk of process.stdin) {
    for (const message of decoder.push(Buffer.from(chunk))) {
      const response = await handleMessage(server, message);
      if (response) process.stdout.write(encodeFrame(response));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
