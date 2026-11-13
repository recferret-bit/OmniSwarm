import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { challengeRequest, challengeResponse, errorResponse, nearLoginBody, sessionResponse, socialLoginBody } from '../../http/schemas.ts';
import { issueChallenge } from './challenge.service.ts';
import { loginNear } from './near-login.ts';
import { setSession } from './session.ts';
import { loginSocial } from './social-login.ts';

export const authRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.post('/api/challenge', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Issue a single-use NEP-413 nonce (5 minutes)', body: challengeRequest, response: { 200: challengeResponse, 429: errorResponse } },
  }, async (request) => issueChallenge({ db: deps.pool, clock: deps.clock }, request.ip));

  app.post('/api/login/social', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Sign in with Google or X (FastAuth PKCE)', body: socialLoginBody, response: { 200: sessionResponse, 401: errorResponse } },
  }, async (request, reply) => {
    const session = await loginSocial(request.body);
    setSession(reply, session.account, deps.clock.now(), deps.config.http.cookieSecure, { label: session.label, provider: session.provider });
    return session;
  });

  app.post('/api/login/near', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: {
      summary: 'Sign in with a NEAR wallet (NEP-413 login message)',
      body: nearLoginBody,
      response: { 200: sessionResponse, 401: errorResponse, 409: errorResponse },
    },
  }, async (request, reply) => {
    const session = await loginNear(
      { config: deps.config, keys: deps.keys, db: deps.pool, now: deps.clock.now() },
      request.body,
    );
    setSession(reply, session.account, deps.clock.now(), deps.config.http.cookieSecure, { label: session.label, provider: session.provider });
    return session;
  });
};
