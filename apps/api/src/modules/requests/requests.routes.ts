import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { errorResponse, listQuery, requestListResponse, requestParams, requestStatusResponse } from '../../http/schemas.ts';
import { requireAccount } from '../auth/session.ts';
import { listMine, viewRequest } from './request-view.ts';

export const requestRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/requests/:id', {
    schema: { summary: 'Read one request (public; the id is an unguessable UUIDv4)', params: requestParams, response: { 200: requestStatusResponse, 404: errorResponse } },
  }, async (request) => viewRequest(deps.pool, request.params.id, deps.config.storage));

  app.get('/api/requests', {
    schema: { summary: "List the signed-in account's requests", querystring: listQuery, response: { 200: requestListResponse, 401: errorResponse } },
  }, async (request) => listMine(deps.pool, requireAccount(request, deps.clock.now())));
};
