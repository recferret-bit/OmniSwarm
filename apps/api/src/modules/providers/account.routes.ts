// A signed-in account's own provider keys and models. Session auth (password dashboard or NEAR sign-in), not
// admin basic auth. Only providers whose catalog entry allows account keys are reachable.
import { accountPresetName, accountProviders } from '@omniswarm/schemas/providers';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse } from '../../http/schemas.ts';
import { fail } from '../../shared/errors.ts';
import { requireAccount } from '../auth/session.ts';
import { accountKeyStatus, listProviderModels, MAX_ACCOUNT_MODELS, readAccountKey, writeAccountKey, type AccountKeyView } from './account-keys.ts';

const ids = accountProviders().map((provider) => provider.id) as [string, ...string[]];
const params = z.strictObject({ provider: z.enum(ids) });
const viewSchema = z.strictObject({
  provider: z.string(), label: z.string(), set: z.boolean(), fingerprint: z.string().nullable(), models: z.array(z.string()), dataPolicy: z.string(),
  /** The operator allows signed (NEP-413) requests on this key: ALLOWED_PRESETS lists account-<provider>. */
  signedRequests: z.boolean(),
});
const bodySchema = z.strictObject({
  key: z.string().max(400).regex(/^[^\s\x00-\x1f]*$/, 'No spaces or control characters').optional(),
  models: z.array(z.string().max(128)).max(MAX_ACCOUNT_MODELS).optional(),
});
const listSchema = z.strictObject({ source: z.enum(['live', 'unavailable']), models: z.array(z.string()) });

export const accountProviderRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  const withFlags = (view: AccountKeyView) => ({ ...view, signedRequests: deps.config.intake.allowedPresets.includes(accountPresetName(view.provider)) });

  app.get('/api/account/providers', {
    schema: { summary: "This account's own keys for every provider that takes one (fingerprints only) and its chosen models", response: { 200: z.strictObject({ providers: z.array(viewSchema) }), 401: errorResponse } },
  }, async (request) => {
    const account = requireAccount(request, deps.clock.now());
    return { providers: (await Promise.all(ids.map((id) => accountKeyStatus(deps.pool, account, id)))).map(withFlags) };
  });

  app.get('/api/account/providers/:provider', {
    schema: { summary: "This account's key status and models for one provider", params, response: { 200: viewSchema, 401: errorResponse } },
  }, async (request) => withFlags(await accountKeyStatus(deps.pool, requireAccount(request, deps.clock.now()), request.params.provider)));

  app.put('/api/account/providers/:provider', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: "Set or clear this account's key for one provider (empty string clears) and choose its models. The key is not returned.",
      params, body: bodySchema, response: { 200: viewSchema, 400: errorResponse, 401: errorResponse, 403: errorResponse },
    },
  }, async (request) => withFlags(await writeAccountKey(
    deps.pool, deps.config.accountKeysSecret, requireAccount(request, deps.clock.now()), request.params.provider, request.body, deps.clock.now(),
  )));

  app.get('/api/account/providers/:provider/models', {
    config: perMinute(Math.min(deps.config.http.rateLimitPerMinute, 20)),
    schema: { summary: "Models the provider serves this account's saved key", params, response: { 200: listSchema, 401: errorResponse, 404: errorResponse } },
  }, async (request) => {
    const account = requireAccount(request, deps.clock.now());
    const key = await readAccountKey(deps.pool, deps.config.accountKeysSecret, account, request.params.provider);
    if (!key) fail('NOT_FOUND', 'Save your key first');
    return listProviderModels(request.params.provider, key);
  });
};
