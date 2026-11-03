// Admin routes (W09-17 refunds, W13 guard report review). Served only by the separate admin listener on
// ADMIN_HOST (loopback); the public app has no /api/admin route at all. Token in `x-admin-token`,
// compared in constant time. The API never signs: refunds and approved reports are queued for a
// worker (202), or reported if already done (200).
import crypto from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  adminGuardDecisionResponse, adminGuardReportListResponse, adminGuardReportQuery, adminRefundResponse, errorResponse, requestParams,
} from '../../http/schemas.ts';
import { fail } from '../../shared/errors.ts';
import { decideReport, listReports } from '../guard/guard-report.service.ts';
import { requestRefund, type AdminRefundDeps } from './admin-refund.service.ts';

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export const adminRoutes: FastifyPluginAsyncZod<{ deps: AdminRefundDeps; token: string }> = async (app, { deps, token }) => {
  const expected = digest(token);
  app.addHook('onRequest', async (request) => {
    const given = request.headers['x-admin-token'];
    if (typeof given !== 'string' || !crypto.timingSafeEqual(digest(given), expected)) fail('UNAUTHORIZED', 'Admin token required');
  });

  app.post('/api/admin/requests/:id/refund', {
    schema: { params: requestParams, response: { 200: adminRefundResponse, 202: adminRefundResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse } },
  }, async (request, reply) => {
    request.log.warn({ requestId: request.params.id }, 'admin refund requested');
    const result = await requestRefund(deps, request.params.id);
    return reply.code(result.status === 'refund_queued' ? 202 : 200).send(result);
  });

  app.get('/api/admin/guard/reports', {
    schema: { querystring: adminGuardReportQuery, response: { 200: adminGuardReportListResponse, 401: errorResponse } },
  }, async (request) => listReports(deps, request.query.status ?? null));

  for (const [action, decision] of [['approve', 'approved'], ['reject', 'rejected']] as const) {
    app.post(`/api/admin/guard/reports/:id/${action}`, {
      schema: { params: requestParams, response: { 200: adminGuardDecisionResponse, 202: adminGuardDecisionResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse } },
    }, async (request, reply) => {
      request.log.warn({ reportId: request.params.id, decision }, 'admin guard report decision');
      const result = await decideReport(deps, request.params.id, decision);
      return reply.code(result.status === 'approved' ? 202 : 200).send(result);
    });
  }
};
