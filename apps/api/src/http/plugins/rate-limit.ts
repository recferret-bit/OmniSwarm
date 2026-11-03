// @fastify/rate-limit on a Postgres store, so N API replicas share one budget per client IP (the IP
// is the proxy-resolved request.ip, see TRUST_PROXY). Routes opt in with `config.rateLimit`.
import rateLimit, { type FastifyRateLimitStore, type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool.ts';
import { hit, peek } from '../../db/repositories/rate-limits.ts';
import { AppError } from '../../shared/errors.ts';

type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;

function postgresStore(db: Db): FastifyRateLimitStoreCtor {
  class PostgresStore implements FastifyRateLimitStore {
    readonly prefix: string;

    constructor(_options?: unknown, prefix = 'global') {
      this.prefix = prefix;
    }

    incr(key: string, callback: Callback, timeWindow: number): void {
      hit(db, `${this.prefix}:${key}`, timeWindow).then((result) => callback(null, result), (error: Error) => callback(error));
    }

    read(key: string, callback: Callback): void {
      peek(db, `${this.prefix}:${key}`).then((result) => callback(null, result), (error: Error) => callback(error));
    }

    // At runtime the plugin passes the merged route params (its typings say route options): one budget
    // per route, or per groupId.
    child(options: object): FastifyRateLimitStore {
      const params = options as { groupId?: string; routeInfo?: { method?: string | string[]; url?: string } };
      const route = `${[params.routeInfo?.method].flat().join(',')}:${params.routeInfo?.url ?? ''}`;
      return new PostgresStore(undefined, params.groupId ?? route);
    }
  }
  return PostgresStore;
}

export async function registerRateLimit(app: FastifyInstance, db: Db): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    store: postgresStore(db),
    // Fail closed: if the counter cannot be read, the request is refused rather than unlimited.
    skipOnError: false,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => new AppError('RATE_LIMITED', `Rate limit exceeded; retry in ${context.after}`),
  });
}

export function perMinute(max: number) {
  return { rateLimit: { max, timeWindow: 60_000 } };
}
