// Pure reading of a `tx` RPC response (wait_until FINAL). Kept free of near-api-js so the rules are
// unit-tested on recorded responses: the tx and every receipt must have succeeded, and only a single
// FunctionCall `request_review` with exactly `{request_hash}` binds a request hash.
import type { PaymentTx } from '../port.ts';

interface FunctionCallAction { FunctionCall?: { method_name?: string; args?: string; deposit?: string } }
interface TxResponse {
  final_execution_status?: string;
  status?: Record<string, unknown>;
  transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: Array<FunctionCallAction | string> };
  receipts_outcome?: Array<{ outcome?: { status?: Record<string, unknown> } }>;
}

function decodeArgs(base64: string | undefined): Record<string, unknown> | null {
  if (!base64) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function failed(response: TxResponse): boolean {
  if (!response.status || 'Failure' in response.status) return true;
  return (response.receipts_outcome ?? []).some((receipt) => receipt.outcome?.status !== undefined && 'Failure' in receipt.outcome.status);
}

export function parsePaymentTx(txHash: string, raw: unknown): PaymentTx {
  const response = (raw ?? {}) as TxResponse;
  const tx = response.transaction ?? {};
  const actions = tx.actions ?? [];
  const first = actions[0];
  const call = actions.length === 1 && typeof first === 'object' ? first.FunctionCall : undefined;
  const args = call?.method_name === 'request_review' ? decodeArgs(call.args) : null;
  const hash = args && Object.keys(args).length === 1 && typeof args.request_hash === 'string' ? args.request_hash : null;
  return {
    txHash,
    succeeded: response.final_execution_status === 'FINAL' && !failed(response) && 'SuccessValue' in (response.status ?? {}),
    signerId: String(tx.signer_id ?? ''),
    receiverId: String(tx.receiver_id ?? ''),
    requestHash: hash,
    depositYocto: /^[0-9]{1,40}$/.test(String(call?.deposit)) ? BigInt(String(call?.deposit)) : 0n,
  };
}

/** The contract panic code (ERR_*) of a failed outcome; null when the tx succeeded. */
export function panicReason(raw: unknown): string | null {
  const response = (raw ?? {}) as TxResponse;
  if (!failed(response)) return null;
  return /ERR_[A-Z_]+/.exec(JSON.stringify(response))?.[0] ?? 'ERR_TX_FAILED';
}

/** The JSON value a successful call returned (`status.SuccessValue`, base64), or undefined. */
export function returnValue(raw: unknown): unknown {
  const value = ((raw ?? {}) as TxResponse).status?.SuccessValue;
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}
