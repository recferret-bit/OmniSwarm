import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, reportIndexResponse, requestParams } from '../../http/schemas.ts';
import { reportIndex } from './report-index.ts';

export const reportRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/reports/:id', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Index of a published report: links, reviewers, repository, highest severity and cross-check counts (public)',
      params: requestParams, response: { 200: reportIndexResponse, 404: errorResponse, 429: errorResponse },
    },
  }, async (request) => reportIndex(deps, request.params.id));
};
