// The app's one error-code union: every intake ErrorCode from the schema plus the
// few failures that happen before or outside the API (wallet, network, contract
// pin). The copy table is exhaustive over the union, so a code added to
// intake-api.schema.json fails `tsc` here until it has a user-facing message.
import type { ErrorCode } from './schema.gen';

// Failures that never come from the API: the wallet, the network and the contract pin.
const CLIENT_CODES = ['WALLET_REJECTED', 'WALLET_UNAVAILABLE', 'NETWORK_ERROR', 'CONTRACT_MISMATCH'] as const;
export type AppErrorCode = ErrorCode | (typeof CLIENT_CODES)[number];

export const ERROR_COPY: Record<AppErrorCode, string> = {
  VALIDATION_ERROR: 'The request was not accepted. Check the repository and try again.',
  REPO_INVALID: 'Not a GitHub repository. Use owner/name or a github.com URL.',
  REPO_NOT_FOUND: 'That repository was not found on GitHub.',
  REPO_PRIVATE: 'This repository is private. Only public repositories can be reviewed.',
  REPO_ARCHIVED: 'This repository is archived and cannot be reviewed.',
  REPO_TOO_LARGE: 'This repository is too large to clone. It is above the hard size cap.',
  REPO_DENIED: 'This repository is not accepted for hosted reviews.',
  QUEUE_FULL: 'Queue is full, try later. Nothing was charged.',
  NONCE_EXPIRED: 'The sign-in challenge expired. Sign the request again.',
  NONCE_USED: 'This challenge was already used. Sign the request again.',
  NONCE_UNKNOWN: 'The server did not recognise this challenge. Sign the request again.',
  SIG_INVALID: 'The wallet signature did not verify.',
  KEY_NOT_FULL_ACCESS: 'Sign with a full-access key of this account.',
  ACCOUNT_MISMATCH: 'The signed account does not match the connected account.',
  MESSAGE_INVALID: 'The signed request message was not accepted.',
  PAYMENT_NOT_FOUND: 'The payment is not visible on chain yet.',
  PAYMENT_MISMATCH: 'The payment does not match this request.',
  TX_ALREADY_USED: 'This transaction was already used for another request.',
  ACTIVE_REQUEST_EXISTS: 'You already have a review in progress.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  UNAUTHORIZED: 'Sign the request again to continue.',
  FORBIDDEN: 'This request belongs to another account.',
  NOT_FOUND: 'Request not found.',
  CHAIN_UNAVAILABLE: 'NEAR RPC is unavailable. Try again shortly.',
  GITHUB_UNAVAILABLE: 'GitHub is unavailable. Try again shortly.',
  INTERNAL: 'Something went wrong on our side. Try again.',
  REF_NOT_FOUND: 'That branch, tag or commit was not found in the repository.',
  REF_CHANGED: 'The signed commit no longer resolves. Get a new quote and sign again.',
  NETWORK_DISABLED: 'This service does not take requests on that network.',
  PRESET_NOT_ALLOWED: 'The signed review preset is not offered by this service.',
  PAYLOAD_TOO_LARGE: 'The request was too large.',
  PAYMENT_SIGNER_MISMATCH: 'The payment was sent from a different account than the request.',
  INVALID_TRANSITION: 'This request is no longer in a state that allows that.',
  REFUND_NOT_ALLOWED: 'This request cannot be refunded.',
  REQUEST_NOT_FOUND: 'Request not found.',
  WALLET_REJECTED: 'Payment cancelled in wallet.',
  WALLET_UNAVAILABLE: 'No NEAR wallet is connected.',
  NETWORK_ERROR: 'The service could not be reached. Check your connection.',
  CONTRACT_MISMATCH: 'The API named a different contract than this site pays. Payment was not sent.',
};

// True for a code the intake API may return (unknown codes map to INTERNAL).
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_COPY, value) && !(CLIENT_CODES as readonly string[]).includes(value);
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: AppErrorCode, message = ERROR_COPY[code], options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 0;
  }
}

export function messageFor(code: AppErrorCode): string {
  return ERROR_COPY[code];
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL', error instanceof Error ? error.message : String(error));
}
