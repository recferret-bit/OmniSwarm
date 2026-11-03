// Read-only RPC view client for the review-registry contract. Nothing here can
// sign: it only issues `query/call_function` at finality `final`. near-api-js is
// imported on first use so the landing route does not carry it.
import { env } from '../env';
import type { Severity } from '../api/schema.gen';

// The contract's `get_attestation` JSON (snake_case, contracts/review-registry).
export interface OnChainAttestation {
  request_hash: string;
  repo: string;
  commit: string;
  report_sha256: string;
  report_uri: string;
  deployed: string | null;
  code_hash: string | null;
  max_severity: Severity;
  block_height: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function parseAttestation(value: unknown): OnChainAttestation | null {
  if (value === null || value === undefined) return null;
  const record = value as Partial<OnChainAttestation>;
  if (typeof record !== 'object' || !HEX64.test(String(record.request_hash)) || !HEX64.test(String(record.report_sha256))) {
    throw new Error('get_attestation returned an unexpected shape');
  }
  return record as OnChainAttestation;
}

export interface ViewProvider {
  callFunction(params: { contractId: string; method: string; args: Record<string, unknown>; blockQuery: { finality: 'final' } }): Promise<unknown>;
}

async function defaultProvider(): Promise<ViewProvider> {
  const { JsonRpcProvider } = await import('near-api-js');
  return new JsonRpcProvider({ url: env.rpcUrl });
}

export async function getAttestation(requestHash: string, provider?: ViewProvider): Promise<OnChainAttestation | null> {
  if (!HEX64.test(requestHash)) throw new Error('request hash must be 64 lowercase hex characters');
  const rpc = provider ?? (await defaultProvider());
  const result = await rpc.callFunction({
    contractId: env.contractId,
    method: 'get_attestation',
    args: { request_hash: requestHash },
    blockQuery: { finality: 'final' },
  });
  return parseAttestation(result);
}
