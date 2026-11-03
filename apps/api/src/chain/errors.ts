import { AppError } from '../shared/errors.ts';

/** The contract panicked (ERR_BAD_STATUS, ERR_NOT_FOUND, ...): retrying the same call will not help. */
export class ChainRejectedError extends Error {
  override name = 'ChainRejectedError';
  readonly reason: string;
  constructor(reason: string, message = `contract rejected the call: ${reason}`) {
    super(message);
    this.reason = reason;
  }
}

export function chainUnavailable(cause: unknown): AppError {
  return new AppError('CHAIN_UNAVAILABLE', 'The NEAR chain could not be reached', { cause });
}
