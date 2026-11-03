import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { challengeRequest, challengeResponse, errorResponse } from '../../http/schemas.ts';
import { issueChallenge } from './challenge.service.ts';

export const authRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/challenge', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Issue a single-use NEP-413 nonce (5 minutes)', body: challengeRequest, response: { 200: challengeResponse, 429: errorResponse } },
  }, async (request) => issueChallenge({ db: deps.pool, clock: deps.clock }, request.ip));
};
