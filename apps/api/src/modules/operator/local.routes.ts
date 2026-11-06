import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, localJobBody, localJobCreated, localJobListResponse, localJobResponse, requestParams } from '../../http/schemas.ts';
import { assertLocalOperator, createLocalJob, listLocalJobs, localReportPdf, viewLocalJob } from './local-job.service.ts';

export const localRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.addHook('onRequest', async (request) => {
    assertLocalOperator(deps.config, request.ip);
  });

  app.post('/api/local/jobs', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Queue a loopback operator review of a local directory or a public GitHub repo',
      body: localJobBody, response: { 201: localJobCreated, 400: errorResponse, 403: errorResponse, 404: errorResponse },
    },
  }, async (request, reply) => reply.code(201).send(await createLocalJob(deps, request.body)));

  app.get('/api/local/jobs', {
    schema: { summary: 'Newest local operator jobs', response: { 200: localJobListResponse, 403: errorResponse } },
  }, async () => listLocalJobs(deps));

  app.get('/api/local/jobs/:id', {
    schema: { summary: 'One local operator job', params: requestParams, response: { 200: localJobResponse, 403: errorResponse, 404: errorResponse } },
  }, async (request) => viewLocalJob(deps, request.params.id));

  app.get('/api/local/jobs/:id/report.pdf', {
    schema: { summary: 'PDF for a finished local operator job', params: requestParams, response: { 403: errorResponse, 404: errorResponse } },
  }, async (request, reply) => {
    const pdf = await localReportPdf(deps, request.params.id);
    // A Buffer with a non-JSON content-type is written as-is; the 404 schema must not serialize it.
    return reply.type('application/pdf').send(pdf as never);
  });
};
