// The engine's environment is built from nothing: a few host variables, the provider keys the
// preset's reviewers need (AGENTS.md "Key policy"), and an explicit operator pass-through list.
// Intake secrets (database, session, admin, GitHub, NEAR operator key) can never be passed.

// OMNI_LIVE=1 is the operator's explicit opt-in to real provider calls (engine http-replay.mjs refuses a live request
// without it). The worker passes it on only when the operator set it in the worker's own environment.
const BASE = ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'OMNI_LIVE'];
const FORBIDDEN = /^(DATABASE_URL|SESSION_SECRET|ADMIN_TOKEN|GITHUB_TOKEN|NEARBLOCKS_API_KEY|OPERATOR_[A-Z0-9_]*|RPC_URLS|NEAR_[A-Z0-9_]*|PG[A-Z0-9_]*|NODE_OPTIONS|npm_[A-Za-z0-9_]*)$/;
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function assertPassable(names: string[]): void {
  for (const name of names) {
    if (!NAME.test(name) || FORBIDDEN.test(name)) throw new Error(`environment variable ${name} may not be passed to the engine`);
  }
}

export function engineEnv(source: NodeJS.ProcessEnv, extra: string[]): Record<string, string> {
  assertPassable(extra);
  const env: Record<string, string> = {};
  for (const name of [...BASE, ...extra]) {
    const value = source[name];
    if (typeof value === 'string' && value !== '') env[name] = value;
  }
  return env;
}
