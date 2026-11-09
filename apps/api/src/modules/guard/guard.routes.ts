import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, guardQuery, guardReportRequest, guardReportResponse, guardVerdictResponse } from '../../http/schemas.ts';
import { fail } from '../../shared/errors.ts';
import { requireAccount } from '../auth/session.ts';
import { submitGuardReport } from './guard-report.service.ts';

export const guardRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/guard/verdict', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Agent guard verdict for a NEAR account', querystring: guardQuery, response: { 200: guardVerdictResponse, 400: errorResponse } },
  }, async (request) => {
    const asked = request.query.network;
    if (asked && asked !== deps.config.intake.network) fail('VALIDATION_ERROR', `This API reads ${deps.config.intake.network}`);
    return deps.guard.verdict(request.query.account);
  });

  // `sid` from a NEP-413 sign-in. The report waits for the owner's review; nothing reaches the chain yet.
  app.post('/api/guard/reports', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Report a NEAR account for the guard blocklist (owner review, then report_address on chain)',
      body: guardReportRequest, response: { 202: guardReportResponse, 400: errorResponse, 401: errorResponse },
    },
  }, async (request, reply) => {
    const reporter = requireAccount(request, deps.clock.now());
    return reply.code(202).send(await submitGuardReport(deps, reporter, request.body));
  });
};
