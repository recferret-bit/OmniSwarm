import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import {
  createRequestBody, createRequestResponse, errorResponse, listQuery, requestListResponse, requestParams, requestStatusResponse,
} from '../../http/schemas.ts';
import { requireAccount, setSession } from '../auth/session.ts';
import { createRequest } from './create-request.service.ts';
import { listMine, viewRequest } from './request-view.ts';

export const requestRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/requests', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Create a review request signed with NEP-413; sets the sid session cookie',
      body: createRequestBody, response: { 201: createRequestResponse, 400: errorResponse, 401: errorResponse, 409: errorResponse },
    },
  }, async (request, reply) => {
    const created = await createRequest(deps, request.body);
    setSession(reply, request.body.accountId, deps.clock.now(), deps.config.http.cookieSecure);
    return reply.code(201).send(created);
  });

  app.get('/api/requests/:id', {
    schema: { summary: 'Read one request (public; the id is an unguessable UUIDv4)', params: requestParams, response: { 200: requestStatusResponse, 404: errorResponse } },
  }, async (request) => viewRequest(deps.pool, request.params.id));

  app.get('/api/requests', {
    schema: { summary: "List the signed-in account's requests", querystring: listQuery, response: { 200: requestListResponse, 401: errorResponse } },
  }, async (request) => listMine(deps.pool, requireAccount(request, deps.clock.now())));
};
