// One LISTEN connection per API process on `request_events`, fanned out in memory to the SSE streams
// of that process. Any replica's (or worker's) NOTIFY reaches every replica, so a client can stream
// from whichever replica the load balancer picked. On reconnect every subscriber is poked to re-read,
// which closes the gap of notifications missed while the connection was down.
import pg from 'pg';
import { EVENTS_CHANNEL } from '../../db/repositories/requests.ts';
import type { Logger } from '../../shared/logger.ts';

type Listener = () => void;

export class EventHub {
  readonly #url: string;
  readonly #log: Logger;
  readonly #listeners = new Map<string, Set<Listener>>();
  #client: pg.Client | null = null;
  #closed = false;
  #retry: NodeJS.Timeout | null = null;

  constructor(url: string, log: Logger) {
    this.#url = url;
    this.#log = log;
  }

  async start(): Promise<void> {
    const client = new pg.Client({ connectionString: this.#url, application_name: 'omniswarm-events' });
    client.on('notification', (message) => {
      if (message.channel === EVENTS_CHANNEL && message.payload) this.#poke(message.payload);
    });
    client.on('error', (error) => this.#reconnect(client, error));
    client.on('end', () => this.#reconnect(client, new Error('LISTEN connection ended')));
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    this.#client = client;
    for (const id of this.#listeners.keys()) this.#poke(id);
  }

  #reconnect(client: pg.Client, error: Error): void {
    if (this.#closed || this.#client !== client) return;
    this.#client = null;
    this.#log.warn({ err: error }, 'event LISTEN connection lost; reconnecting');
    client.end().catch(() => {});
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    if (this.#closed) return;
    this.#retry = setTimeout(() => this.start().catch(() => this.#scheduleRetry()), 1000);
  }

  #poke(requestId: string): void {
    for (const listener of this.#listeners.get(requestId) ?? []) listener();
  }

  subscribe(requestId: string, listener: Listener): () => void {
    const set = this.#listeners.get(requestId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(requestId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.#listeners.delete(requestId);
    };
  }

  get size(): number {
    return [...this.#listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retry) clearTimeout(this.#retry);
    await this.#client?.end().catch(() => {});
    this.#client = null;
  }
}
