import path from 'node:path';
import { z } from 'zod';
import { APP_ROOT } from '../shared/paths.ts';
import { envSchema, type RawEnv } from './env.ts';

export type Role = 'api' | 'worker' | 'migrate' | 'script';

export interface Config {
  env: RawEnv['NODE_ENV'];
  logLevel: RawEnv['LOG_LEVEL'];
  db: { url: string; poolMax: number };
  http: {
    host: string; port: number; trustProxy: boolean | number | string[]; cookieSecure: boolean;
    landingOrigin: string | null; sessionSecret: string; rateLimitPerMinute: number;
  };
  intake: {
    maxQueue: number; allowlist: string[]; denylist: string[]; requestsPerDay: number;
    /** NEP-413 recipient for NEAR wallet sign-in. */
    loginRecipient: string;
  };
  /** NEAR wallet sign-in: how a signing key is checked as a full-access key of its account. */
  keys: { verifier: 'rpc' | 'mock'; rpcUrls: string[] };
  github: { adapter: 'live' | 'recorded'; apiUrl: string; token: string | null; timeoutMs: number; fixturesDir: string };
  engine: {
    runner: 'cli' | 'mock'; root: string; configPath: string; timeoutS: number; killGraceS: number;
    logMaxBytes: number; envPassthrough: string[];
    mock: { fail: 'infra' | 'findings' | 'crash' | 'operator' | null; stepMs: number };
  };
  storage: { runsRoot: string; reportsRoot: string; reportsBaseUrl: string; keepRuns: number };
  queue: {
    workerId: string | null; concurrency: number; stopTimeoutS: number; expireS: number; heartbeatS: number;
    retryLimit: number; retryDelayS: number; monitorS: number;
  };
  progressPollMs: number;
  /** Loopback operator routes. Unset follows NODE_ENV (on outside production). */
  localMode: boolean;
  /** Both null unless the operator set them. The login module owns any non-production fallback. */
  dashboard: { login: string | null; password: string | null };
  adminBasic: { user: string | null; password: string | null };
  /** Seals accounts' own provider keys (every review runs on one). Empty when neither ACCOUNT_KEYS_SECRET nor (outside production) SESSION_SECRET is set. */
  accountKeysSecret: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Issue = { key: string; message: string };

/** Production runs the real adapters by default; a test adapter must be named and is refused there. */
function adapters(raw: RawEnv) {
  const production = raw.NODE_ENV === 'production';
  return {
    keys: raw.KEY_VERIFIER ?? (production ? 'rpc' : 'mock'),
    github: raw.GITHUB_ADAPTER ?? (production ? 'live' : 'recorded'),
    engine: raw.ENGINE_RUNNER ?? (production ? 'cli' : 'mock'),
  } as const;
}

function productionIssues(raw: RawEnv, role: Role): Issue[] {
  if (raw.NODE_ENV !== 'production') return [];
  const issues: Issue[] = [];
  const need = (key: keyof RawEnv, ok: boolean, message: string) => { if (!ok) issues.push({ key, message }); };
  const chosen = adapters(raw);
  need('KEY_VERIFIER', chosen.keys === 'rpc', 'must be "rpc" in production (mock is test-only)');
  need('GITHUB_ADAPTER', chosen.github === 'live', 'must be "live" in production (recorded is test-only)');
  need('COOKIE_SECURE', raw.COOKIE_SECURE !== false, 'cannot be disabled in production');
  need('REPORTS_BASE_URL', raw.REPORTS_BASE_URL.startsWith('https://'), 'must be https in production');
  // Every review runs on an account's own key, sealed under this secret; the worker never gets SESSION_SECRET.
  if (role !== 'migrate') need('ACCOUNT_KEYS_SECRET', Boolean(raw.ACCOUNT_KEYS_SECRET), 'is required in production');
  if (role === 'worker') {
    need('ENGINE_RUNNER', chosen.engine === 'cli', 'must be "cli" in production (mock is test-only)');
    need('REPORTS_BASE_URL', raw.REPORTS_BASE_URL !== 'https://reports.localhost', 'must name the public reports origin');
  }
  return issues;
}

/** The API signs sessions. */
function roleIssues(raw: RawEnv, role: Role): Issue[] {
  if (role !== 'api') return [];
  const required: Array<keyof RawEnv> = ['SESSION_SECRET'];
  return required.filter((key) => raw[key] === undefined).map((key) => ({ key, message: 'is required' }));
}

function adapterIssues(raw: RawEnv, role: Role): Issue[] {
  const issues: Issue[] = [];
  // The worker never signs anyone in; only the API reads access keys.
  if (role === 'api' && adapters(raw).keys === 'rpc' && !raw.RPC_URLS.length) issues.push({ key: 'RPC_URLS', message: 'is required for the rpc key verifier' });
  if (raw.ENGINE_TIMEOUT_S >= raw.QUEUE_EXPIRE_S) issues.push({ key: 'ENGINE_TIMEOUT_S', message: 'must be below QUEUE_EXPIRE_S' });
  return issues;
}

function fail(issues: Issue[]): never {
  throw new ConfigError(`invalid environment: ${issues.map((issue) => `${issue.key} ${issue.message}`).join('; ')}`);
}

function build(raw: RawEnv): Config {
  const production = raw.NODE_ENV === 'production';
  return {
    env: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    db: { url: raw.DATABASE_URL, poolMax: raw.DATABASE_POOL_MAX },
    http: {
      host: raw.HOST, port: raw.PORT, trustProxy: raw.TRUST_PROXY, cookieSecure: raw.COOKIE_SECURE ?? production,
      landingOrigin: raw.LANDING_ORIGIN ?? null, sessionSecret: raw.SESSION_SECRET ?? '', rateLimitPerMinute: raw.RATE_LIMIT_PER_MINUTE,
    },
    intake: {
      maxQueue: raw.MAX_QUEUE, allowlist: raw.REPO_ALLOWLIST, denylist: raw.REPO_DENYLIST, requestsPerDay: raw.REQUESTS_PER_DAY,
      loginRecipient: raw.INTAKE_RECIPIENT,
    },
    keys: { verifier: adapters(raw).keys, rpcUrls: raw.RPC_URLS },
    github: {
      adapter: adapters(raw).github, apiUrl: raw.GITHUB_API_URL, token: raw.GITHUB_TOKEN ?? null,
      timeoutMs: raw.GITHUB_TIMEOUT_MS, fixturesDir: raw.GITHUB_FIXTURES_DIR ?? path.join(APP_ROOT, 'test/fixtures/github'),
    },
    engine: {
      runner: adapters(raw).engine, root: raw.ENGINE_ROOT,
      configPath: raw.ENGINE_CONFIG ?? path.join(raw.ENGINE_ROOT, 'omniswarm.config.json'),
      timeoutS: raw.ENGINE_TIMEOUT_S, killGraceS: raw.ENGINE_KILL_GRACE_S, logMaxBytes: raw.ENGINE_LOG_MAX_BYTES,
      envPassthrough: raw.ENGINE_ENV_PASSTHROUGH,
      mock: { fail: raw.MOCK_ENGINE_FAIL ?? null, stepMs: raw.MOCK_ENGINE_STEP_MS },
    },
    storage: {
      runsRoot: raw.RUNS_ROOT, reportsRoot: raw.REPORTS_ROOT, reportsBaseUrl: raw.REPORTS_BASE_URL.replace(/\/+$/, ''),
      keepRuns: raw.KEEP_RUNS,
    },
    queue: {
      workerId: raw.WORKER_ID ?? null, concurrency: raw.WORKER_CONCURRENCY, stopTimeoutS: raw.WORKER_STOP_TIMEOUT_S, expireS: raw.QUEUE_EXPIRE_S,
      heartbeatS: raw.QUEUE_HEARTBEAT_S, retryLimit: raw.QUEUE_RETRY_LIMIT, retryDelayS: raw.QUEUE_RETRY_DELAY_S,
      monitorS: raw.QUEUE_MONITOR_S,
    },
    progressPollMs: raw.PROGRESS_POLL_MS,
    localMode: raw.LOCAL_MODE ?? (raw.NODE_ENV !== 'production'),
    dashboard: { login: raw.DASHBOARD_LOGIN ?? null, password: raw.DASHBOARD_PASSWORD ?? null },
    adminBasic: { user: raw.ADMIN_BASIC_USER ?? null, password: raw.ADMIN_BASIC_PASSWORD ?? null },
    accountKeysSecret: raw.ACCOUNT_KEYS_SECRET ?? (raw.NODE_ENV === 'production' ? '' : raw.SESSION_SECRET ?? ''),
  };
}

/** Parse and validate the environment. Throws ConfigError with one line naming every bad key. */
export function loadConfig(role: Role, env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` (as in .env.example) means unset.
  const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  if (!parsed.success) {
    fail(parsed.error.issues.map((issue: z.core.$ZodIssue) => ({ key: String(issue.path[0] ?? '?'), message: issue.message })));
  }
  const raw = parsed.data;
  const issues = [...roleIssues(raw, role), ...productionIssues(raw, role), ...adapterIssues(raw, role)];
  if (issues.length) fail(issues);
  return build(raw);
}
