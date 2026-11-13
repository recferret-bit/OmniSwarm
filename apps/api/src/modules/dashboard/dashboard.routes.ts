import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import {
  dashboardJobBody, dashboardJobResponse, debateStepBody, errorResponse, loginBody, requestParams, sessionResponse,
} from '../../http/schemas.ts';
import { readSession, requireAccount, setSession } from '../auth/session.ts';
import { authenticateDashboard } from './credentials.ts';
import { adviseDashboardRequest, continueDashboardDebate, createDashboardJob, readDashboardReportPdf, type DashboardJobInput } from './dashboard.service.ts';
import { fail } from '../../shared/errors.ts';

function jobInput(body: { repo: string; scopes?: string[] | undefined; source?: string | undefined; pipelineMode?: DashboardJobInput['pipelineMode'] | undefined }): DashboardJobInput {
  return { repo: body.repo, scopes: body.scopes ?? [], ...(body.source ? { source: body.source } : {}), pipelineMode: body.pipelineMode ?? 'full' };
}

export const dashboardRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/login', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Password sign-in for the operator dashboard', body: loginBody, response: { 200: sessionResponse, 401: errorResponse, 403: errorResponse } },
  }, async (request, reply) => {
    const account = authenticateDashboard(deps.config, request.body.login, request.body.password);
    setSession(reply, account, deps.clock.now(), deps.config.http.cookieSecure, { provider: 'password' });
    return { account };
  });

  app.post('/api/logout', {
    schema: { summary: 'Clear the sid session cookie' },
  }, async (_request, reply) => {
    reply.clearCookie('sid', { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/session', {
    schema: { summary: 'The signed-in account', response: { 200: sessionResponse, 401: errorResponse } },
  }, async (request) => {
    const session = readSession(request, deps.clock.now());
    if (!session) fail('UNAUTHORIZED', 'Sign in required');
    return session;
  });

  app.post('/api/dashboard/jobs', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: "Queue a GitHub review on the signed-in account's own provider key and models",
      body: dashboardJobBody,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await createDashboardJob(deps, account, jobInput(request.body)));
  });

  app.post('/api/dashboard/jobs/:id/advise', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Queue Step 2 Frontier Orchestrator quality and debate advice on a Stage 1 review',
      params: requestParams,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await adviseDashboardRequest(deps, account, request.params.id));
  });

  app.post('/api/dashboard/jobs/:id/debate', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Queue additional iterative debate round(s) on a finished review',
      params: requestParams,
      body: debateStepBody,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await continueDashboardDebate(deps, account, request.params.id, request.body?.rounds ?? 1));
  });

  app.post('/api/requests/:id/advise', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: "Queue Step 2 Frontier Orchestrator quality and debate advice on the signed-in account's Stage 1 review",
      params: requestParams,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await adviseDashboardRequest(deps, account, request.params.id));
  });

  app.post('/api/requests/:id/debate', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: "Queue additional iterative debate round(s) on the signed-in account's finished review",
      params: requestParams,
      body: debateStepBody,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await continueDashboardDebate(deps, account, request.params.id, request.body?.rounds ?? 1));
  });

  app.get('/api/requests/:id/report.pdf', {
    schema: { summary: "PDF of the signed-in account's finished review", params: requestParams, response: { 401: errorResponse, 404: errorResponse } },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    const pdf = await readDashboardReportPdf(deps, account, request.params.id);
    // A Buffer with a non-JSON content-type is written as-is; the 404 schema must not serialize it.
    return reply.type('application/pdf').send(pdf as never);
  });
};
