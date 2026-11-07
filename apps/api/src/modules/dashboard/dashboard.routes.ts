import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import {
  dashboardJobBody, dashboardJobResponse, errorResponse, loginBody, requestParams, sessionResponse,
} from '../../http/schemas.ts';
import { requireAccount, setSession } from '../auth/session.ts';
import { authenticateDashboard } from './credentials.ts';
import { readReviewSettings, settingsPath } from '../providers/settings.ts';
import { createDashboardJob, readDashboardReportPdf } from './dashboard.service.ts';
import { fail } from '../../shared/errors.ts';

export const dashboardRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/login', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Password sign-in for the operator dashboard', body: loginBody, response: { 200: sessionResponse, 401: errorResponse, 403: errorResponse } },
  }, async (request, reply) => {
    const account = authenticateDashboard(deps.config, request.body.login, request.body.password);
    setSession(reply, account, deps.clock.now(), deps.config.http.cookieSecure);
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
  }, async (request) => ({ account: requireAccount(request, deps.clock.now()) }));

  app.post('/api/free/jobs', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Queue a review with no payment while free checks are on',
      body: dashboardJobBody,
      response: { 201: dashboardJobResponse, 400: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    if (!readReviewSettings(settingsPath(deps.config.providerSecretsFile)).freeChecks) fail('FORBIDDEN', 'Free checks are off');
    let account = 'guest';
    if (request.cookies.sid) {
      try { account = requireAccount(request, deps.clock.now()); } catch { account = 'guest'; }
    }
    return reply.code(201).send(await createDashboardJob(deps, account, request.body.repo, request.body.models ?? [], request.body.scopes ?? []));
  });

  app.post('/api/dashboard/jobs', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Queue a GitHub review for the signed-in operator (mock chain only)',
      body: dashboardJobBody,
      response: { 201: dashboardJobResponse, 400: errorResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    const account = requireAccount(request, deps.clock.now());
    return reply.code(201).send(await createDashboardJob(deps, account, request.body.repo, request.body.models ?? [], request.body.scopes ?? []));
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
