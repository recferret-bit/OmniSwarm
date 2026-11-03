/** ClockPort: every "now" in the services comes from here, so tests can move time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** ISO 8601 with second precision, as the intake schema's timestamp pattern expects. */
export function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
