// Admin refund (W09-17). Served only by the separate admin listener on ADMIN_HOST (loopback); the
// public app has no /api/admin route at all. Token in `x-admin-token`, compared in constant time.
import crypto from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { CoreDeps } from '../../container.ts';
import { adminRefundResponse, errorResponse, requestParams } from '../../http/schemas.ts';
import { fail } from '../../shared/errors.ts';
import { refundRequest } from '../payments/settlement.service.ts';

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

export const adminRoutes: FastifyPluginAsyncZod<{ deps: CoreDeps; token: string }> = async (app, { deps, token }) => {
  const expected = digest(token);
  app.addHook('onRequest', async (request) => {
    const given = request.headers['x-admin-token'];
    if (typeof given !== 'string' || !crypto.timingSafeEqual(digest(given), expected)) fail('UNAUTHORIZED', 'Admin token required');
  });

  app.post('/api/admin/requests/:id/refund', {
    schema: { params: requestParams, response: { 200: adminRefundResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse } },
  }, async (request) => {
    request.log.warn({ requestId: request.params.id }, 'admin refund requested');
    return refundRequest(deps, request.params.id, { actor: 'admin', cause: 'admin' });
  });
};
