// Admin provider keys. HTTP basic auth, not the sample-account session.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../../http/deps.ts';
import { errorResponse } from '../../http/schemas.ts';
import { passwordsMatch } from '../dashboard/credentials.ts';
import { fail } from '../../shared/errors.ts';
import { providerStatus, writeProviderSecrets, type ProviderStatus } from './secrets.ts';

const view = z.strictObject({ set: z.boolean(), fingerprint: z.string().nullable() });
const statusSchema = z.strictObject({ zai: view, openrouter: view });
const bodySchema = z.strictObject({
  zai: z.string().max(400).optional(),
  openrouter: z.string().max(400).optional(),
});

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

export const providerRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/operator/providers', {
    schema: { summary: 'Whether the Z.AI and OpenRouter keys are set', response: { 200: statusSchema, 401: errorResponse } },
  }, async (request): Promise<ProviderStatus> => {
    requireAdmin(deps, request.headers.authorization);
    return providerStatus(deps.config.providerSecretsFile ?? '');
  });

  app.put('/api/operator/providers', {
    schema: {
      summary: 'Set or clear the Z.AI and OpenRouter keys. Empty string clears. The key is not returned.',
      body: bodySchema, response: { 200: statusSchema, 401: errorResponse },
    },
  }, async (request): Promise<ProviderStatus> => {
    requireAdmin(deps, request.headers.authorization);
    const file = deps.config.providerSecretsFile;
    if (!file) fail('FORBIDDEN', 'PROVIDER_SECRETS_FILE is not set');
    return writeProviderSecrets(file, deps.config.http.sessionSecret, request.body);
  });
};
