// The `request_review` payment transaction (INTAKE section 3, step 6). The
// receiver is pinned to the build-time contract id: a compromised or
// misconfigured API that names another contract cannot redirect the deposit.
import { AppError } from '../api/errors';
import { env } from '../env';

export const REQUEST_REVIEW_GAS = '30000000000000';
const HEX64 = /^[0-9a-f]{64}$/;
const YOCTO = /^(0|[1-9][0-9]{0,38})$/;

export interface FunctionCallAction {
  type: 'FunctionCall';
  params: { methodName: string; args: { request_hash: string }; gas: string; deposit: string };
}

export interface PaymentTransaction {
  receiverId: string;
  actions: [FunctionCallAction];
}

export function buildPaymentTx(input: { contractId: string; requestHash: string; priceYocto: string }, contractId = env.contractId): PaymentTransaction {
  if (input.contractId !== contractId) throw new AppError('CONTRACT_MISMATCH');
  if (!HEX64.test(input.requestHash)) throw new Error('request hash must be 64 lowercase hex characters');
  if (!YOCTO.test(input.priceYocto) || input.priceYocto === '0') throw new Error('price must be a positive yoctoNEAR amount');
  return {
    receiverId: contractId,
    actions: [{
      type: 'FunctionCall',
      params: { methodName: 'request_review', args: { request_hash: input.requestHash }, gas: REQUEST_REVIEW_GAS, deposit: input.priceYocto },
    }],
  };
}

const YOCTO_PER_NEAR = 10n ** 24n;

export function formatNear(yocto: string): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, '0').replace(/0+$/, '').slice(0, 4);
  return `${whole}${fraction ? `.${fraction}` : ''} NEAR`;
}
