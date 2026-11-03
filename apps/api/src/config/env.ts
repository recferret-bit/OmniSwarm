// Environment schema for every intake process (API, worker, migrate). Validated once at startup;
// a bad or missing value exits with one line naming the key. No secret has a default, and the test
// adapters (mock chain, recorded GitHub, mock engine) are refused when NODE_ENV=production.
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from '../shared/paths.ts';

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;
const PRESET = /^[a-z0-9-]{1,40}$/;
const YOCTO = /^(0|[1-9][0-9]{0,38})$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

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
  ADMIN_HOST: z.string().default('127.0.0.1').refine((host) => LOOPBACK.has(host), 'admin listener binds loopback only'),
  ADMIN_PORT: int(0, 65535).default(8788),
  ADMIN_TOKEN: z.string().min(32, 'must be at least 32 characters').optional(),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  COOKIE_SECURE: flag.optional(),
  LANDING_ORIGIN: z.url().optional(),

  NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  // Price on NETWORK. Testnet defaults to 1 NEAR (OD-08); mainnet has no default, so it stays off unless priced.
  PRICE_YOCTO: z.string().regex(YOCTO).optional(),
  INTAKE_RECIPIENT: z.string().regex(ACCOUNT_ID).optional(),
  CONTRACT_ID: z.string().regex(ACCOUNT_ID).optional(),
  MAX_REPO_KB: int(1, 10_000_000).default(204_800),
  MAX_QUEUE: int(1, 10_000).default(10),
  ETA_MINUTES_PER_JOB: int(1, 1440).default(15),
  REPO_ALLOWLIST: list,
  REPO_DENYLIST: list,
  HOSTED_PRESET: z.string().regex(PRESET).default('scripted'),
  ALLOWED_PRESETS: list,
  RATE_LIMIT_PER_MINUTE: int(1, 10_000).default(30),
  REQUESTS_PER_DAY: int(1, 1000).default(5),

  CHAIN_ADAPTER: z.enum(['mock', 'near']).optional(),
  RPC_URLS: list,
  // Worker only (INTAKE section 5). The account id comes from the key file's account_id unless set here.
  OPERATOR_KEY_FILE: absPath.optional(),
  OPERATOR_ACCOUNT_ID: z.string().regex(ACCOUNT_ID).optional(),
  MOCK_CHAIN_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
  MOCK_CHAIN_HANG_AFTER: z.enum(['attest', 'refund']).optional(),

  // Guard account-age signal (W13): off by default; `nearblocks` asks the NearBlocks API (API only).
  GUARD_ACCOUNT_AGE: z.enum(['off', 'nearblocks']).default('off'),
  NEARBLOCKS_API_KEY: z.string().min(1).optional(),

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
  // Disk hygiene (W09-19): finished requests whose run dirs are kept; how long an orphaned report stays.
  KEEP_RUNS: int(1, 100_000).default(20),
  ORPHAN_REPORT_RETENTION_H: int(1, 87_600).default(168),
  REPORTS_BASE_URL: z.url().refine((url) => url.startsWith('https://'), 'must be https').default('https://reports.localhost'),

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
