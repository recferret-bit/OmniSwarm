// Fastify factories: the public app (every /api route but admin) and the loopback-only admin app.
import crypto from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { CoreDeps } from '../container.ts';
import { adminRoutes } from '../modules/admin/admin.routes.ts';
import { authRoutes } from '../modules/auth/auth.routes.ts';
import { guardRoutes } from '../modules/guard/guard.routes.ts';
import { healthRoutes } from '../modules/health/health.routes.ts';
import { ledgerRoutes } from '../modules/ledger/ledger.routes.ts';
import { reportRoutes } from '../modules/reports/reports.routes.ts';
import { paymentRoutes } from '../modules/payments/payment.routes.ts';
import { eventRoutes } from '../modules/progress/events.routes.ts';
import { quoteRoutes } from '../modules/quote/quote.routes.ts';
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

export async function buildApp(deps: ApiDeps, options: { sseKeepAliveMs?: number } = {}): Promise<FastifyInstance> {
  const { http } = deps.config;
  const app = base(deps.log, http.trustProxy);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"] } },
  });
  if (http.landingOrigin) await app.register(cors, { origin: http.landingOrigin, credentials: true });
  await app.register(cookie, { secret: http.sessionSecret });
  await registerRateLimit(app, deps.pool);
  await registerDocs(app);
  for (const routes of [healthRoutes, authRoutes, quoteRoutes, requestRoutes, paymentRoutes, guardRoutes, ledgerRoutes, reportRoutes]) await app.register(routes, { deps });
  await app.register(eventRoutes, { deps, ...(options.sseKeepAliveMs ? { keepAliveMs: options.sseKeepAliveMs } : {}) });
  return app;
}

export async function buildAdminApp(deps: CoreDeps & { log: Logger; boss: ApiDeps['boss'] }, token: string): Promise<FastifyInstance> {
  const app = base(deps.log.child({ listener: 'admin' }), false);
  await app.register(adminRoutes, { deps, token });
  return app;
}
