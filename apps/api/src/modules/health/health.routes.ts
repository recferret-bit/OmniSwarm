import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { healthResponse, readyResponse } from '../../http/schemas.ts';
import { HealthService } from './health.service.ts';

export const healthRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  const service = new HealthService(deps);
  app.get('/api/health', { schema: { summary: 'Liveness and public status', response: { 200: healthResponse } } }, async () => service.health());
  app.get('/api/ready', {
    schema: { summary: 'Readiness: database, migrations and queue', response: { 200: readyResponse, 503: readyResponse } },
  }, async (_request, reply) => {
    const ready = await service.ready();
    return reply.code(ready.ok ? 200 : 503).send(ready);
  });
};
