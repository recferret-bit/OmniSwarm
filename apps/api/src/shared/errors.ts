// One error type for every layer. The code set is the `error-code` enum of
// packages/schemas/intake-api.schema.json; test/unit/errors.test.ts keeps the two equal.

const CODES = {
  VALIDATION_ERROR: [400, false],
  REPO_INVALID: [400, false],
  REPO_PRIVATE: [400, false],
  REPO_ARCHIVED: [400, false],
  REPO_TOO_LARGE: [400, false],
  REPO_DENIED: [403, false],
  REPO_NOT_FOUND: [404, false],
  REF_NOT_FOUND: [404, false],
  REF_CHANGED: [409, false],
  PRESET_NOT_ALLOWED: [400, false],
  PAYLOAD_TOO_LARGE: [413, false],
  QUEUE_FULL: [503, true],
  NONCE_EXPIRED: [401, false],
  NONCE_USED: [409, false],
  NONCE_UNKNOWN: [401, false],
  SIG_INVALID: [401, false],
  KEY_NOT_FULL_ACCESS: [401, false],
  ACCOUNT_MISMATCH: [401, false],
  UNAUTHORIZED: [401, false],
  FORBIDDEN: [403, false],
  INVALID_TRANSITION: [409, false],
  RATE_LIMITED: [429, true],
  NOT_FOUND: [404, false],
  REQUEST_NOT_FOUND: [404, false],
  GITHUB_UNAVAILABLE: [503, true],
  INTERNAL: [500, true],
} as const satisfies Record<string, readonly [number, boolean]>;

export type ErrorCode = keyof typeof CODES;
export const ERROR_CODES = Object.keys(CODES) as ErrorCode[];

export class AppError extends Error {
  override name = 'AppError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    const [status, retryable] = CODES[code];
    this.code = code;
    this.status = options.status ?? status;
    this.retryable = retryable;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

export function fail(code: ErrorCode, message: string, cause?: unknown): never {
  throw new AppError(code, message, { cause });
}

export function isAppError(error: unknown, code?: ErrorCode): error is AppError {
  return error instanceof AppError && (code === undefined || error.code === code);
}
