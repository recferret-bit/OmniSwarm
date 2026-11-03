// Dev/e2e only. The JSON-RPC endpoint (NEXT_PUBLIC_RPC_URL) answering
// `query/call_function get_attestation` from the mock chain, and the reports
// origin serving each request's canonical report files.
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { env } from '@/lib/env';
import { base64ToBytes } from '@/lib/near/nep413';
import { REPORTS_ORIGIN, reportFiles } from '../chain';
import { readState } from '../db';

interface RpcBody {
  id: string | number;
  method: string;
  params: { request_type?: string; account_id?: string; method_name?: string; args_base64?: string };
}

function rpcResult(id: RpcBody['id'], value: unknown) {
  const bytes = [...new TextEncoder().encode(JSON.stringify(value))];
  return HttpResponse.json({ jsonrpc: '2.0', id, result: { result: bytes, logs: [], block_height: 1, block_hash: '11111111111111111111111111111111' } });
}

function rpcError(id: RpcBody['id'], message: string) {
  return HttpResponse.json({ jsonrpc: '2.0', id, error: { code: -32000, name: 'HANDLER_ERROR', message, data: message, cause: { name: 'UNKNOWN', info: {} } } });
}

const rpc = http.post(env.rpcUrl, async ({ request }) => {
  const body = (await request.json()) as RpcBody;
  const { params } = body;
  if (body.method !== 'query' || params.request_type !== 'call_function') return rpcError(body.id, 'mock RPC only answers call_function');
  if (params.account_id !== env.contractId) return rpcError(body.id, `account ${params.account_id} does not exist`);
  if (params.method_name !== 'get_attestation') return rpcError(body.id, `method ${params.method_name} not found`);
  const args = JSON.parse(new TextDecoder().decode(base64ToBytes(params.args_base64 ?? ''))) as { request_hash: string };
  return rpcResult(body.id, readState().attestations[args.request_hash] ?? null);
});

const files = http.get<{ id: string; file: string }>(`${REPORTS_ORIGIN}/:id/:file`, ({ params }) => {
  const row = readState().requests.find((item) => item.id === params.id);
  if (!row) return new HttpResponse(null, { status: 404 });
  const content = reportFiles(readState().controls.tampered);
  if (params.file === 'findings-and-scores.json') return HttpResponse.json(content.findings as JsonBodyType);
  if (params.file === 'general-review.json') return HttpResponse.json(content.general as JsonBodyType);
  return new HttpResponse(null, { status: 404 });
});

export const chainHandlers = [rpc, files];
