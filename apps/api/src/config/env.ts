// Environment schema for every intake process (API, worker, migrate). Validated once at startup;
// a bad or missing value exits with one line naming the key. No secret has a default, and the test
// adapters (mock key verifier, recorded GitHub, mock engine) are refused when NODE_ENV=production.
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from '../shared/paths.ts';

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

const flag = z.enum(['0', '1', 'true', 'false']).transform((value) => value === '1' || value === 'true');
const list = z.string().default('').transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const absPath = z.string().min(1).transform((value) => path.resolve(value));

// TRUST_PROXY: false | true | hop count | comma-separated addresses/CIDRs of the trusted proxies.
const trustProxy = z.string().default('false').transform((value): boolean | number | string[] => {
  if (value === 'false' || value === '0' || value === '') return false;
  if (value === 'true') return true;
  if (/^[1-9][0-9]?$/.test(value)) return Number(value);
  return value.split(',').map((item) => item.trim()).filter(Boolean);
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/, 'must be a postgres:// URL'),
  DATABASE_POOL_MAX: int(2, 100).default(10),

  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: int(0, 65535).default(8787),
  TRUST_PROXY: trustProxy,
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  COOKIE_SECURE: flag.optional(),
  LANDING_ORIGIN: z.url().optional(),
  // No default: a non-production operator/operator fallback lives only in the login function.
  LOCAL_MODE: flag.optional(),
  DASHBOARD_LOGIN: z.string().min(1).optional(),
  DASHBOARD_PASSWORD: z.string().min(1).optional(),
  // Admin page (HTTP basic). Separate from the sample-account session.
  ADMIN_BASIC_USER: z.string().min(1).optional(),
  ADMIN_BASIC_PASSWORD: z.string().min(8).optional(),
  // Seals accounts' own provider keys (account_provider_key). The API and the workers both need it; unset
  // outside production falls back to SESSION_SECRET. Production requires it: every review runs on an account's key.
  ACCOUNT_KEYS_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

  // The NEP-413 recipient the wallet signs the sign-in message for (NEAR wallet sign-in only). Must equal the
  // web app's NEXT_PUBLIC_INTAKE_RECIPIENT.
  INTAKE_RECIPIENT: z.string().regex(ACCOUNT_ID).default('omniswarm.near'),
  MAX_QUEUE: int(1, 10_000).default(10),
  REPO_ALLOWLIST: list,
  REPO_DENYLIST: list,
  RATE_LIMIT_PER_MINUTE: int(1, 10_000).default(30),
  REQUESTS_PER_DAY: int(1, 1000).default(5),

  // NEAR wallet sign-in checks that the signing key is a full-access key of the account. `rpc` reads the
  // account's access keys from RPC_URLS (mainnet); `mock` knows only keys registered in-process and is test-only.
  KEY_VERIFIER: z.enum(['rpc', 'mock']).optional(),
  RPC_URLS: list,

  GITHUB_ADAPTER: z.enum(['live', 'recorded']).optional(),
  GITHUB_API_URL: z.url().default('https://api.github.com'),
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_TIMEOUT_MS: int(100, 60_000).default(5000),
  GITHUB_FIXTURES_DIR: absPath.optional(),

  ENGINE_RUNNER: z.enum(['cli', 'mock']).optional(),
  ENGINE_ROOT: absPath.default(REPO_ROOT),
  ENGINE_CONFIG: absPath.optional(),
  ENGINE_TIMEOUT_S: int(10, 86_400).default(5400),
  ENGINE_KILL_GRACE_S: int(1, 600).default(30),
  ENGINE_LOG_MAX_BYTES: int(1024, 1_073_741_824).default(5 * 1024 * 1024),
  ENGINE_ENV_PASSTHROUGH: list,
  MOCK_ENGINE_FAIL: z.enum(['infra', 'findings', 'crash', 'operator']).optional(),
  MOCK_ENGINE_STEP_MS: int(0, 600_000).default(50),
  RUNS_ROOT: absPath.default(path.join(REPO_ROOT, 'reports/intake/runs')),
  REPORTS_ROOT: absPath.default(path.join(REPO_ROOT, 'reports/intake/published')),
  // Disk hygiene (W09-19): finished (done or failed) requests whose run dirs are kept.
  KEEP_RUNS: int(1, 100_000).default(20),
  // http is the local stack only. productionIssues refuses it when NODE_ENV=production.
  REPORTS_BASE_URL: z.url().refine((url) => url.startsWith('https://') || url.startsWith('http://'), 'must be http or https').default('https://reports.localhost'),

  WORKER_ID: z.string().regex(/^[A-Za-z0-9._@-]{1,64}$/).optional(),
  WORKER_CONCURRENCY: int(1, 8).default(1),
  WORKER_STOP_TIMEOUT_S: int(1, 3600).default(120),
  QUEUE_EXPIRE_S: int(60, 86_400).default(7200),
  QUEUE_HEARTBEAT_S: int(10, 3600).default(30),
  QUEUE_RETRY_LIMIT: int(0, 5).default(1),
  QUEUE_RETRY_DELAY_S: int(0, 3600).default(60),
  QUEUE_MONITOR_S: int(1, 600).default(30),
  PROGRESS_POLL_MS: int(50, 60_000).default(5000),
});

export type RawEnv = z.infer<typeof envSchema>;
