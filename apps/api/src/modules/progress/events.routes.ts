import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { findRequest } from '../../db/repositories/requests.ts';
import type { ApiDeps } from '../../http/deps.ts';
import { errorResponse, requestParams } from '../../http/schemas.ts';
import { fail } from '../../shared/errors.ts';
import { EventStream } from './event-stream.ts';

export const eventRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps; keepAliveMs?: number }> = async (app, { deps, keepAliveMs = 15_000 }) => {
  const open = new Set<EventStream>();
  // Close streams before the server waits for connections, so a SIGTERM drain is not held open.
  app.addHook('preClose', async () => { for (const stream of open) stream.close(); });

  app.get('/api/requests/:id/events', {
    schema: { summary: 'Server-Sent Events: progress and status of one request', params: requestParams, response: { 404: errorResponse } },
  }, async (request, reply) => {
    if (!(await findRequest(deps.pool, request.params.id))) fail('REQUEST_NOT_FOUND', 'Request not found');
    reply.hijack();
    const lastEventId = request.headers['last-event-id'];
    const stream = new EventStream(deps.pool, reply.raw, request.params.id, Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
    open.add(stream);
    reply.raw.on('close', () => open.delete(stream));
    stream.open(deps.events, { keepAliveMs, maxDurationMs: 30 * 60 * 1000 });
  });
};
