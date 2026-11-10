// GET /api/requests/:id/events (W09-09): Server-Sent Events. Subscribe first, then replay stored
// progress rows after Last-Event-ID, then send whatever each NOTIFY reveals. Every event is a
// `progress-event` {status, progress?, at}; the stream ends after a terminal status.
import type { ServerResponse } from 'node:http';
import type { Db } from '../../db/pool.ts';
import { latestProgress, progressSince } from '../../db/repositories/progress.ts';
import { findRequest } from '../../db/repositories/requests.ts';
import { iso } from '../../shared/clock.ts';
import { progressDto } from '../requests/request-view.ts';
import { TERMINAL, type Status } from '../requests/state.ts';
import type { EventHub } from './event-hub.ts';

export interface StreamOptions { keepAliveMs: number; maxDurationMs: number }

export class EventStream {
  readonly #db: Db;
  readonly #res: ServerResponse;
  readonly #requestId: string;
  #lastId: string;
  #lastStatus: Status | null = null;
  #chain: Promise<void> = Promise.resolve();
  #closed = false;
  #started = false;
  readonly #cleanup: Array<() => void> = [];

  constructor(db: Db, res: ServerResponse, requestId: string, lastEventId: string | undefined) {
    this.#db = db;
    this.#res = res;
    this.#requestId = requestId;
    this.#lastId = lastEventId && /^[0-9]{1,18}$/.test(lastEventId) ? lastEventId : '0';
  }

  open(hub: EventHub, options: StreamOptions): void {
    this.#res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    this.#res.write('retry: 3000\n\n');
    this.#cleanup.push(hub.subscribe(this.#requestId, () => this.pump()));
    const ping = setInterval(() => this.#res.write(': keep-alive\n\n'), options.keepAliveMs);
    const limit = setTimeout(() => this.close(), options.maxDurationMs);
    this.#cleanup.push(() => clearInterval(ping), () => clearTimeout(limit));
    this.#res.on('close', () => this.close());
    this.pump();
  }

  /** Serialised: one read at a time, so events stay in order. */
  pump(): void {
    this.#chain = this.#chain.then(() => this.#flush()).catch(() => this.close());
  }

  async #flush(): Promise<void> {
    if (this.#closed) return;
    const row = await findRequest(this.#db, this.#requestId);
    if (!row) return this.close();
    // A fresh connection (no Last-Event-ID) to a run whose rows carry the engine's full snapshot needs only the
    // latest row: the older ones are superseded, and a long run has hundreds. Rows without a snapshot (an older
    // engine) are replayed from the start, as the page builds its phase list from them.
    if (this.#lastId === '0' && !this.#started) {
      this.#started = true;
      const latest = await latestProgress(this.#db, this.#requestId);
      if (latest?.detail) this.#lastId = String(BigInt(latest.id) - 1n);
    }
    for (const progress of await progressSince(this.#db, this.#requestId, this.#lastId)) {
      this.#send({ status: row.status, progress: progressDto(progress), at: iso(progress.ts) }, progress.id);
      this.#lastId = progress.id;
    }
    if (row.status !== this.#lastStatus) {
      this.#send({ status: row.status, at: iso(row.updated_at) });
      this.#lastStatus = row.status;
    }
    if (TERMINAL.includes(row.status)) this.close();
  }

  #send(event: object, id?: string): void {
    if (this.#closed) return;
    this.#res.write(`${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const fn of this.#cleanup.splice(0)) fn();
    this.#res.end();
  }
}
