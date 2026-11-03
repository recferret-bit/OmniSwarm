import path from 'node:path';
import { z } from 'zod';
import { APP_ROOT } from '../shared/paths.ts';
import { envSchema, type RawEnv } from './env.ts';

export type Role = 'api' | 'worker' | 'migrate' | 'script';
export type Network = 'testnet' | 'mainnet';

export interface Config {
  env: RawEnv['NODE_ENV'];
  logLevel: RawEnv['LOG_LEVEL'];
  db: { url: string; poolMax: number };
  http: {
    host: string; port: number; trustProxy: boolean | number | string[]; cookieSecure: boolean;
    landingOrigin: string | null; sessionSecret: string; rateLimitPerMinute: number;
  };
  admin: { host: string; port: number; token: string | null };
  intake: {
    network: Network; priceYocto: string | null; recipient: string; contractId: string; maxRepoKb: number;
    maxQueue: number; etaMinutesPerJob: number; allowlist: string[]; denylist: string[];
    hostedPreset: string; allowedPresets: string[]; requestsPerDay: number;
  };
  chain: {
    adapter: 'mock' | 'near'; rpcUrls: string[]; operatorAccountId: string | null; operatorKeyPath: string | null;
    mock: { failRate: number; hangAfter: 'attest' | 'refund' | null };
  };
  github: { adapter: 'live' | 'recorded'; apiUrl: string; token: string | null; timeoutMs: number; fixturesDir: string };
  engine: {
    runner: 'cli' | 'mock'; root: string; configPath: string; timeoutS: number; killGraceS: number;
    logMaxBytes: number; envPassthrough: string[];
    mock: { fail: 'infra' | 'findings' | 'crash' | 'operator' | null; stepMs: number };
  };
  storage: { runsRoot: string; reportsRoot: string; reportsBaseUrl: string };
  queue: {
    concurrency: number; stopTimeoutS: number; expireS: number; heartbeatS: number;
    retryLimit: number; retryDelayS: number; monitorS: number;
  };
  progressPollMs: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Issue = { key: string; message: string };

function productionIssues(raw: RawEnv, role: Role): Issue[] {
  if (raw.NODE_ENV !== 'production') return [];
  const issues: Issue[] = [];
  const need = (key: keyof RawEnv, ok: boolean, message: string) => { if (!ok) issues.push({ key, message }); };
  need('CHAIN_ADAPTER', raw.CHAIN_ADAPTER === 'near', 'must be "near" in production (mock is test-only)');
  need('GITHUB_ADAPTER', raw.GITHUB_ADAPTER === 'live', 'must be "live" in production (recorded is test-only)');
  need('COOKIE_SECURE', raw.COOKIE_SECURE !== false, 'cannot be disabled in production');
  if (role === 'api') need('ADMIN_TOKEN', Boolean(raw.ADMIN_TOKEN), 'is required in production');
  if (role === 'worker') {
    need('ENGINE_RUNNER', raw.ENGINE_RUNNER === 'cli', 'must be "cli" in production (mock is test-only)');
    need('REPORTS_BASE_URL', raw.REPORTS_BASE_URL !== 'https://reports.localhost', 'must name the public reports origin');
  }
  return issues;
}

/** Keys every role except `migrate` needs; the API also signs sessions. */
function roleIssues(raw: RawEnv, role: Role): Issue[] {
  if (role === 'migrate') return [];
  const required: Array<keyof RawEnv> = role === 'api' ? ['SESSION_SECRET', 'INTAKE_RECIPIENT', 'CONTRACT_ID'] : ['INTAKE_RECIPIENT', 'CONTRACT_ID'];
  return required.filter((key) => raw[key] === undefined).map((key) => ({ key, message: 'is required' }));
}

function adapterIssues(raw: RawEnv, role: Role): Issue[] {
  const issues: Issue[] = [];
  if (raw.CHAIN_ADAPTER === 'near') {
    if (!raw.NEAR_RPC_URLS.length) issues.push({ key: 'NEAR_RPC_URLS', message: 'is required for CHAIN_ADAPTER=near' });
    if (role === 'worker' || role === 'script') {
      if (!raw.NEAR_OPERATOR_ACCOUNT_ID) issues.push({ key: 'NEAR_OPERATOR_ACCOUNT_ID', message: 'is required for CHAIN_ADAPTER=near' });
      if (!raw.NEAR_OPERATOR_KEY_PATH) issues.push({ key: 'NEAR_OPERATOR_KEY_PATH', message: 'is required for CHAIN_ADAPTER=near' });
    }
  }
  const presets = raw.ALLOWED_PRESETS.length ? raw.ALLOWED_PRESETS : [raw.HOSTED_PRESET];
  if (!presets.includes(raw.HOSTED_PRESET)) issues.push({ key: 'HOSTED_PRESET', message: 'must be one of ALLOWED_PRESETS' });
  if (presets.some((preset) => !/^[a-z0-9-]{1,40}$/.test(preset))) issues.push({ key: 'ALLOWED_PRESETS', message: 'has an invalid preset name' });
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
    admin: { host: raw.ADMIN_HOST, port: raw.ADMIN_PORT, token: raw.ADMIN_TOKEN ?? null },
    intake: {
      network: raw.NETWORK,
      priceYocto: raw.NETWORK === 'testnet' ? raw.PRICE_YOCTO_TESTNET : raw.PRICE_YOCTO_MAINNET ?? null,
      recipient: raw.INTAKE_RECIPIENT ?? '', contractId: raw.CONTRACT_ID ?? '', maxRepoKb: raw.MAX_REPO_KB, maxQueue: raw.MAX_QUEUE,
      etaMinutesPerJob: raw.ETA_MINUTES_PER_JOB, allowlist: raw.REPO_ALLOWLIST, denylist: raw.REPO_DENYLIST,
      hostedPreset: raw.HOSTED_PRESET, allowedPresets: raw.ALLOWED_PRESETS.length ? raw.ALLOWED_PRESETS : [raw.HOSTED_PRESET],
      requestsPerDay: raw.REQUESTS_PER_DAY,
    },
    chain: {
      adapter: raw.CHAIN_ADAPTER ?? 'mock', rpcUrls: raw.NEAR_RPC_URLS,
      operatorAccountId: raw.NEAR_OPERATOR_ACCOUNT_ID ?? null, operatorKeyPath: raw.NEAR_OPERATOR_KEY_PATH ?? null,
      mock: { failRate: raw.MOCK_CHAIN_FAIL_RATE, hangAfter: raw.MOCK_CHAIN_HANG_AFTER ?? null },
    },
    github: {
      adapter: raw.GITHUB_ADAPTER ?? 'recorded', apiUrl: raw.GITHUB_API_URL, token: raw.GITHUB_TOKEN ?? null,
      timeoutMs: raw.GITHUB_TIMEOUT_MS, fixturesDir: raw.GITHUB_FIXTURES_DIR ?? path.join(APP_ROOT, 'test/fixtures/github'),
    },
    engine: {
      runner: raw.ENGINE_RUNNER ?? 'mock', root: raw.ENGINE_ROOT,
      configPath: raw.ENGINE_CONFIG ?? path.join(raw.ENGINE_ROOT, 'omniswarm.config.json'),
      timeoutS: raw.ENGINE_TIMEOUT_S, killGraceS: raw.ENGINE_KILL_GRACE_S, logMaxBytes: raw.ENGINE_LOG_MAX_BYTES,
      envPassthrough: raw.ENGINE_ENV_PASSTHROUGH,
      mock: { fail: raw.MOCK_ENGINE_FAIL ?? null, stepMs: raw.MOCK_ENGINE_STEP_MS },
    },
    storage: { runsRoot: raw.RUNS_ROOT, reportsRoot: raw.REPORTS_ROOT, reportsBaseUrl: raw.REPORTS_BASE_URL.replace(/\/+$/, '') },
    queue: {
      concurrency: raw.WORKER_CONCURRENCY, stopTimeoutS: raw.WORKER_STOP_TIMEOUT_S, expireS: raw.QUEUE_EXPIRE_S,
      heartbeatS: raw.QUEUE_HEARTBEAT_S, retryLimit: raw.QUEUE_RETRY_LIMIT, retryDelayS: raw.QUEUE_RETRY_DELAY_S,
      monitorS: raw.QUEUE_MONITOR_S,
    },
    progressPollMs: raw.PROGRESS_POLL_MS,
  };
}

/** Parse and validate the environment. Throws ConfigError with one line naming every bad key. */
export function loadConfig(role: Role, env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` (as in .env.example) means unset.
  const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  if (!parsed.success) {
    fail(parsed.error.issues.map((issue: z.core.$ZodIssue) => ({ key: String(issue.path[0] ?? '?'), message: issue.message })));
  }
  const issues = [...roleIssues(parsed.data, role), ...productionIssues(parsed.data, role), ...adapterIssues(parsed.data, role)];
  if (issues.length) fail(issues);
  return build(parsed.data);
}
