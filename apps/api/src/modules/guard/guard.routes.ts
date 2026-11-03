import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, guardQuery, guardVerdictResponse } from '../../http/schemas.ts';

export const guardRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/guard/verdict', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Agent guard verdict for a NEAR account', querystring: guardQuery, response: { 200: guardVerdictResponse, 400: errorResponse } },
  }, async (request) => deps.guard.verdict(request.query.account, request.query.network ?? deps.config.intake.network));
};
