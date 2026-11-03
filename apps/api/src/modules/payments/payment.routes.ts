import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, paymentRequest, paymentResponse, requestParams } from '../../http/schemas.ts';
import { requireAccount } from '../auth/session.ts';
import { confirmPayment } from './payment.service.ts';

export const paymentRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/requests/:id/payment', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Confirm the request_review payment (FINAL) and enqueue the review',
      params: requestParams, body: paymentRequest,
      response: { 200: paymentResponse, 401: errorResponse, 402: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse },
    },
  }, async (request) => {
    const account = requireAccount(request, deps.clock.now());
    return confirmPayment(deps, { requestId: request.params.id, account, txHash: request.body.txHash });
  });
};
