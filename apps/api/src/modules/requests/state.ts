// Request lifecycle (INTAKE section 4): awaiting_payment -> queued -> running -> publishing -> done,
// running -> failed -> refunded, plus admin refunds from queued/running/failed and the reconciler's
// expiry of unpaid requests. Every status change goes through this table.

export const STATUSES = ['awaiting_payment', 'queued', 'running', 'publishing', 'done', 'failed', 'refunded', 'expired'] as const;
export type Status = (typeof STATUSES)[number];

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  awaiting_payment: ['queued', 'expired'],
  queued: ['running', 'failed', 'refunded'],
  // running -> running is a retry attempt of the same job.
  running: ['running', 'publishing', 'failed', 'refunded'],
  // A published report is attested, never refunded (OD-07).
  publishing: ['done'],
  failed: ['refunded'],
  done: [],
  refunded: [],
  expired: [],
};

/** Statuses a request may be in for `to` to be legal. */
export function sourcesOf(to: Status): Status[] {
  return STATUSES.filter((from) => TRANSITIONS[from].includes(to));
}

export const ACTIVE: readonly Status[] = ['queued', 'running', 'publishing'];
export const TERMINAL: readonly Status[] = ['done', 'refunded', 'expired'];
/** Admin refunds (W09-17): never for a review that completed or was already refunded. */
export const ADMIN_REFUNDABLE: readonly Status[] = ['queued', 'running', 'failed'];
