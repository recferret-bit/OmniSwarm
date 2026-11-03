import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, quoteRequest, quoteResponse } from '../../http/schemas.ts';
import { quote } from './quote.service.ts';

export const quoteRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/quote', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Quote a public GitHub repository at a commit',
      body: quoteRequest, response: { 200: quoteResponse, 400: errorResponse, 404: errorResponse, 503: errorResponse },
    },
  }, async (request) => quote({ config: deps.config, db: deps.pool, github: deps.github }, request.body));
};
