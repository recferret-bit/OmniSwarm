// Horizontal scaling: two API instances on one database share the rate-limit budget and serve each
// other's SSE events (LISTEN/NOTIFY).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { appendProgress } from '../../src/db/repositories/progress.ts';
import { transition } from '../../src/db/repositories/requests.ts';
import { call, conforms, queuedJob } from '../helpers/flow.ts';
import { NEEDS_DB } from '../helpers/db.ts';
import { migratedDb, startApi, until, type ApiStack, type TestDb } from '../helpers/stack.ts';

function sse(url: string): { events: any[]; ended: Promise<void>; close(): void } {
  const events: any[] = [];
  let request: http.ClientRequest;
  const ended = new Promise<void>((resolve, reject) => {
    request = http.get(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      });
      res.on('end', () => resolve());
    });
    request.on('error', reject);
  });
  return { events, ended, close: () => request.destroy() };
}

describe('two API replicas on one database', NEEDS_DB, () => {
  let t: TestDb;
  let a: ApiStack;
  let b: ApiStack;
  before(async () => {
    t = await migratedDb('replicas', { RATE_LIMIT_PER_MINUTE: '30' });
    a = await startApi(t.env);
    b = await startApi(t.env);
  });
  after(async () => {
    await a?.close();
    await b?.close();
    await t?.db.drop();
  });

  test('the per-IP challenge budget (30/min) is shared across replicas', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await call(i % 2 ? b.base : a.base, '/api/challenge', { method: 'POST', body: {} })).status);
    assert.equal(statuses.filter((s) => s === 200).length, 30);
    assert.deepEqual(statuses.slice(30), Array(10).fill(429));
    const limited = await call(a.base, '/api/challenge', { method: 'POST', body: {} });
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    conforms('error-response', limited.body);
    const health = await call(b.base, '/api/health');
    assert.equal(health.status, 200, 'routes have separate budgets');
    await a.deps.pool.query('DELETE FROM rate_limit');
  });

  test('an SSE stream on replica A gets events written through replica B and ends on done', async () => {
    const created = await queuedJob(b.base);
    await appendProgress(b.deps.pool, created.requestId, { phase: 'starting', percent: 5 }, new Date());
    const stream = sse(`${a.base}/api/requests/${created.requestId}/events`);
    await until(async () => stream.events.length >= 2);
    const now = new Date();
    await transition(b.deps.pool, created.requestId, { to: 'running', actor: 'test', event: 'review_started', now });
    await appendProgress(b.deps.pool, created.requestId, { phase: 'review', reviewer: 'scripted-baseline', pass: 1, percent: 40 }, now);
    await transition(b.deps.pool, created.requestId, { to: 'publishing', actor: 'test', event: 'report_published', now });
    await transition(b.deps.pool, created.requestId, { to: 'done', actor: 'test', event: 'review_done', now });
    await stream.ended;
    for (const event of stream.events) conforms('progress-event', event);
    assert.deepEqual(stream.events[0].progress, { phase: 'starting', percent: 5 });
    assert.ok(stream.events.some((event) => event.progress?.reviewer === 'scripted-baseline' && event.progress.percent === 40));
    assert.equal(stream.events.at(-1).status, 'done');
    const replay = sse(`${b.base}/api/requests/${created.requestId}/events`);
    await replay.ended;
    assert.equal(replay.events.at(-1).status, 'done', 'a stream for a finished request replays and closes');
    assert.equal((await call(a.base, '/api/requests/3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10/events')).status, 404);
  });
});
