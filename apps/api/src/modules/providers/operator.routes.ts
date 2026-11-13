// Admin page route: every account's review jobs. HTTP basic auth, not the sample-account
// session. There are no operator provider keys: a cloud review runs only on an account's own key.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../../http/deps.ts';
import { errorResponse } from '../../http/schemas.ts';
import { passwordsMatch } from '../dashboard/credentials.ts';
import { fail } from '../../shared/errors.ts';
import { listRecent } from '../../db/repositories/requests.ts';
import { iso } from '../../shared/clock.ts';

const jobSchema = z.strictObject({
  id: z.uuid(), account: z.string(), repo: z.string(), status: z.string(), scope: z.string(),
  theme: z.string().nullable(), parentId: z.uuid().nullable(), failureCause: z.string().nullable(), createdAt: z.string(),
});
const activitySchema = z.strictObject({ jobs: z.array(jobSchema) });

function basicAuth(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const cut = decoded.indexOf(':');
  if (cut < 1) return null;
  return { user: decoded.slice(0, cut), password: decoded.slice(cut + 1) };
}

function requireAdmin(deps: ApiDeps, header: string | undefined): void {
  const { user, password } = deps.config.adminBasic;
  const given = basicAuth(header);
  if (!user || !password || !given || given.user !== user || !passwordsMatch(given.password, password)) {
    fail('UNAUTHORIZED', 'Admin sign-in required');
  }
}

export const operatorRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/operator/activity', {
    schema: { summary: 'Every account and its review jobs', response: { 200: activitySchema, 401: errorResponse } },
  }, async (request) => {
    requireAdmin(deps, request.headers.authorization);
    const rows = await listRecent(deps.pool);
    return {
      jobs: rows.map((row) => ({
        id: row.id, account: row.account, repo: row.repo, status: row.status, scope: row.scope ?? 'full',
        theme: row.theme, parentId: row.parent_id, failureCause: row.failure_cause, createdAt: iso(row.created_at),
      })),
    };
  });
};
