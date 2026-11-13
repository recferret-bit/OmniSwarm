// Request lifecycle (INTAKE section 4): queued -> running -> publishing -> done, or failed from queued or
// running. Reviews are free on the account's own provider key, so there is no payment, refund or expiry
// state. Every status change goes through this table.

export const STATUSES = ['queued', 'running', 'publishing', 'done', 'failed'] as const;
export type Status = (typeof STATUSES)[number];

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  queued: ['running', 'failed'],
  // running -> running is a retry attempt of the same job.
  running: ['running', 'publishing', 'failed'],
  publishing: ['done'],
  done: [],
  failed: [],
};

/** Statuses a request may be in for `to` to be legal. */
export function sourcesOf(to: Status): Status[] {
  return STATUSES.filter((from) => TRANSITIONS[from].includes(to));
}

export const ACTIVE: readonly Status[] = ['queued', 'running', 'publishing'];
export const TERMINAL: readonly Status[] = ['done', 'failed'];
