// Fastify factory for the public app (every /api route).
import crypto from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authRoutes } from '../modules/auth/auth.routes.ts';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes.ts';
import { localRoutes } from '../modules/operator/local.routes.ts';
import { operatorRoutes } from '../modules/providers/operator.routes.ts';
import { accountProviderRoutes } from '../modules/providers/account.routes.ts';
import { healthRoutes } from '../modules/health/health.routes.ts';
import { reportRoutes } from '../modules/report-index/reports.routes.ts';
import { eventRoutes } from '../modules/progress/events.routes.ts';
import { requestRoutes } from '../modules/requests/requests.routes.ts';
import type { Logger } from '../shared/logger.ts';
import type { ApiDeps } from './deps.ts';
import { installErrorHandling } from './error-handler.ts';
import { registerRateLimit } from './plugins/rate-limit.ts';

const BODY_LIMIT = 16 * 1024;

/** TRUST_PROXY as Fastify takes it; a hop count trusts that many proxies nearest to the server. */
function trust(value: boolean | number | string[]): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === 'number' ? (_address, hop) => hop < value : value;
}

function base(log: Logger, trustProxy: boolean | number | string[]): FastifyInstance {
  const loggerInstance: FastifyBaseLogger = log;
  const app = Fastify({
    loggerInstance, trustProxy: trust(trustProxy), bodyLimit: BODY_LIMIT, requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(), return503OnClosing: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandling(app);
  return app;
}

async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: { info: { title: 'OmniSwarm intake API', version: '1.0.0', description: 'docs/spec/INTAKE.md section 4' } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
}

// Production (secure cookies) keeps Helmet's HSTS and upgrade-insecure-requests.
// The local HTTP stack sets COOKIE_SECURE=0. Those two directives would pin the
// browser to https, so they stay off whenever the cookie is not Secure.
export function helmetOptions(cookieSecure: boolean): FastifyHelmetOptions {
  const directives: Record<string, null | string[]> = {
    defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"],
  };
  if (!cookieSecure) directives.upgradeInsecureRequests = null;
  return {
    ...(cookieSecure ? {} : { hsts: false }),
    contentSecurityPolicy: { directives },
  };
}

export async function buildApp(deps: ApiDeps, options: { sseKeepAliveMs?: number } = {}): Promise<FastifyInstance> {
  const { http } = deps.config;
  const app = base(deps.log, http.trustProxy);
  await app.register(helmet, helmetOptions(http.cookieSecure));
  if (http.landingOrigin) await app.register(cors, { origin: http.landingOrigin, credentials: true });
  await app.register(cookie, { secret: http.sessionSecret });
  await registerRateLimit(app, deps.pool);
  await registerDocs(app);
  for (const routes of [healthRoutes, authRoutes, requestRoutes, reportRoutes, dashboardRoutes, localRoutes, operatorRoutes, accountProviderRoutes]) {
    await app.register(routes, { deps });
  }
  await app.register(eventRoutes, { deps, ...(options.sseKeepAliveMs ? { keepAliveMs: options.sseKeepAliveMs } : {}) });
  return app;
}
