import { ACCOUNT_PRESET_PREFIX, accountPresetProvider } from '@omniswarm/schemas/providers';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { APP_ROOT, REPO_ROOT } from '../shared/paths.ts';
import { envSchema, type RawEnv } from './env.ts';

export type Role = 'api' | 'worker' | 'migrate' | 'script';
export type Network = 'testnet' | 'mainnet' | 'sandbox';

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
    adapter: 'mock' | 'near'; rpcUrls: string[]; operatorAccountId: string | null; operatorKeyFile: string | null;
    mock: { failRate: number; hangAfter: 'attest' | 'refund' | null };
  };
  github: { adapter: 'live' | 'recorded'; apiUrl: string; token: string | null; timeoutMs: number; fixturesDir: string };
  guard: { accountAge: 'off' | 'nearblocks'; nearblocksApiKey: string | null };
  engine: {
    runner: 'cli' | 'mock'; root: string; configPath: string; timeoutS: number; killGraceS: number;
    logMaxBytes: number; envPassthrough: string[];
    mock: { fail: 'infra' | 'findings' | 'crash' | 'operator' | null; stepMs: number };
  };
  storage: { runsRoot: string; reportsRoot: string; reportsBaseUrl: string; keepRuns: number; orphanReportRetentionH: number };
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
  /** The admin page's free-checks switch file (REVIEW_SETTINGS_FILE), or null. */
  reviewSettingsFile: string | null;
  /** Seals accounts' own provider keys. Empty when neither ACCOUNT_KEYS_SECRET nor (outside production) SESSION_SECRET is set. */
  accountKeysSecret: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Issue = { key: string; message: string };

/** `hosted` exists in engine/omniswarm.config.example.json and runs only API-key reviewers (OD-04). */
export const DEFAULT_HOSTED_PRESET = 'hosted';

function hostedPreset(raw: RawEnv): string {
  return raw.HOSTED_PRESET ?? DEFAULT_HOSTED_PRESET;
}

/** Production runs the real adapters by default; a test adapter must be named and is refused there. */
function adapters(raw: RawEnv) {
  const production = raw.NODE_ENV === 'production';
  return {
    chain: raw.CHAIN_ADAPTER ?? (production ? 'near' : 'mock'),
    github: raw.GITHUB_ADAPTER ?? (production ? 'live' : 'recorded'),
    engine: raw.ENGINE_RUNNER ?? (production ? 'cli' : 'mock'),
  } as const;
}

function productionIssues(raw: RawEnv, role: Role): Issue[] {
  if (raw.NODE_ENV !== 'production') return [];
  const issues: Issue[] = [];
  const need = (key: keyof RawEnv, ok: boolean, message: string) => { if (!ok) issues.push({ key, message }); };
  const chosen = adapters(raw);
  need('NETWORK', raw.NETWORK !== 'sandbox', 'sandbox is the local near-sandbox and is refused in production');
  need('NEAR_NETWORK', raw.NEAR_NETWORK !== 'sandbox', 'sandbox is the local near-sandbox and is refused in production');
  need('CHAIN_ADAPTER', chosen.chain === 'near', 'must be "near" in production (mock is test-only)');
  need('GITHUB_ADAPTER', chosen.github === 'live', 'must be "live" in production (recorded is test-only)');
  need('COOKIE_SECURE', raw.COOKIE_SECURE !== false, 'cannot be disabled in production');
  need('REPORTS_BASE_URL', raw.REPORTS_BASE_URL.startsWith('https://'), 'must be https in production');
  // The API cannot read the engine config, so the preset it accepts must be named, not defaulted.
  if (role !== 'migrate') need('HOSTED_PRESET', raw.HOSTED_PRESET !== undefined, 'must be set in production (a preset defined in omniswarm.config.json)');
  if (role === 'api') need('ADMIN_TOKEN', Boolean(raw.ADMIN_TOKEN), 'is required in production');
  // An account- preset decrypts accounts' own keys in the worker; the worker never gets SESSION_SECRET.
  if (role !== 'migrate' && raw.ALLOWED_PRESETS.some((preset) => accountPresetProvider(preset))) {
    need('ACCOUNT_KEYS_SECRET', Boolean(raw.ACCOUNT_KEYS_SECRET), 'is required in production when ALLOWED_PRESETS has an account- preset');
  }
  if (role === 'worker') {
    need('ENGINE_RUNNER', chosen.engine === 'cli', 'must be "cli" in production (mock is test-only)');
    need('REPORTS_BASE_URL', raw.REPORTS_BASE_URL !== 'https://reports.localhost', 'must name the public reports origin');
  }
  return issues;
}

/** Keys every role except `migrate` needs; the API also signs sessions. */
function roleIssues(raw: RawEnv, role: Role): Issue[] {
  if (role === 'migrate') return [];
  const required: Array<keyof RawEnv> = role === 'api' ? ['SESSION_SECRET', 'INTAKE_RECIPIENT', 'CONTRACT_ID'] : ['CONTRACT_ID'];
  return required.filter((key) => raw[key] === undefined).map((key) => ({ key, message: 'is required' }));
}

function adapterIssues(raw: RawEnv, role: Role): Issue[] {
  const issues: Issue[] = [];
  if (role !== 'migrate' && adapters(raw).chain === 'near') {
    if (!raw.RPC_URLS.length) issues.push({ key: 'RPC_URLS', message: 'is required for the near chain adapter' });
    if (role === 'worker' && !raw.OPERATOR_KEY_FILE) issues.push({ key: 'OPERATOR_KEY_FILE', message: 'is required for the near chain adapter' });
  }
  const hosted = hostedPreset(raw);
  const presets = raw.ALLOWED_PRESETS.length ? raw.ALLOWED_PRESETS : [hosted];
  if (!presets.includes(hosted)) issues.push({ key: 'HOSTED_PRESET', message: 'must be one of ALLOWED_PRESETS' });
  if (presets.some((preset) => !/^[a-z0-9-]{1,40}$/.test(preset))) issues.push({ key: 'ALLOWED_PRESETS', message: 'has an invalid preset name' });
  if (presets.some((preset) => preset.startsWith(ACCOUNT_PRESET_PREFIX) && !accountPresetProvider(preset))) {
    issues.push({ key: 'ALLOWED_PRESETS', message: 'names an account- preset for a provider that does not take account keys' });
  }
  if (hosted.startsWith(ACCOUNT_PRESET_PREFIX)) issues.push({ key: 'HOSTED_PRESET', message: 'cannot be an account- preset (an account- preset runs on one account\'s own key, never as the default)' });
  if (raw.ENGINE_TIMEOUT_S >= raw.QUEUE_EXPIRE_S) issues.push({ key: 'ENGINE_TIMEOUT_S', message: 'must be below QUEUE_EXPIRE_S' });
  return issues;
}

function fail(issues: Issue[]): never {
  throw new ConfigError(`invalid environment: ${issues.map((issue) => `${issue.key} ${issue.message}`).join('; ')}`);
}

/** Host tools use loopback. A container (`/.dockerenv`) uses the host gateway name. */
export function sandboxRpcUrl(inDocker: boolean): string {
  return inDocker ? 'http://host.docker.internal:3030' : 'http://127.0.0.1:3030';
}

const SANDBOX_PRICE_YOCTO = '1000000000000000000000000';

/** Local near-sandbox profile. Not applied in production; productionIssues refuses the key. */
function withSandboxDefaults(raw: RawEnv): RawEnv {
  if (raw.NEAR_NETWORK !== 'sandbox' || raw.NODE_ENV === 'production') return raw;
  return {
    ...raw,
    NETWORK: 'sandbox',
    // Force near. An explicit mock must not take a sandbox job.
    CHAIN_ADAPTER: 'near',
    PRICE_YOCTO: raw.PRICE_YOCTO ?? SANDBOX_PRICE_YOCTO,
    CONTRACT_ID: raw.CONTRACT_ID ?? 'registry.test.near',
    RPC_URLS: raw.RPC_URLS.length > 0 ? raw.RPC_URLS : [sandboxRpcUrl(fs.existsSync('/.dockerenv'))],
    // Path only. The key file is not read or created here.
    OPERATOR_KEY_FILE: raw.OPERATOR_KEY_FILE ?? path.resolve(REPO_ROOT, 'infra/compose/.local/near/keys/operator.json'),
  };
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
      priceYocto: raw.PRICE_YOCTO ?? (raw.NETWORK === 'testnet' ? '1000000000000000000000000' : null),
      recipient: raw.INTAKE_RECIPIENT ?? '', contractId: raw.CONTRACT_ID ?? '', maxRepoKb: raw.MAX_REPO_KB, maxQueue: raw.MAX_QUEUE,
      etaMinutesPerJob: raw.ETA_MINUTES_PER_JOB, allowlist: raw.REPO_ALLOWLIST, denylist: raw.REPO_DENYLIST,
      hostedPreset: hostedPreset(raw), allowedPresets: raw.ALLOWED_PRESETS.length ? raw.ALLOWED_PRESETS : [hostedPreset(raw)],
      requestsPerDay: raw.REQUESTS_PER_DAY,
    },
    chain: {
      adapter: adapters(raw).chain, rpcUrls: raw.RPC_URLS,
      operatorAccountId: raw.OPERATOR_ACCOUNT_ID ?? null, operatorKeyFile: raw.OPERATOR_KEY_FILE ?? null,
      mock: { failRate: raw.MOCK_CHAIN_FAIL_RATE, hangAfter: raw.MOCK_CHAIN_HANG_AFTER ?? null },
    },
    github: {
      adapter: adapters(raw).github, apiUrl: raw.GITHUB_API_URL, token: raw.GITHUB_TOKEN ?? null,
      timeoutMs: raw.GITHUB_TIMEOUT_MS, fixturesDir: raw.GITHUB_FIXTURES_DIR ?? path.join(APP_ROOT, 'test/fixtures/github'),
    },
    guard: { accountAge: raw.GUARD_ACCOUNT_AGE, nearblocksApiKey: raw.NEARBLOCKS_API_KEY ?? null },
    engine: {
      runner: adapters(raw).engine, root: raw.ENGINE_ROOT,
      configPath: raw.ENGINE_CONFIG ?? path.join(raw.ENGINE_ROOT, 'omniswarm.config.json'),
      timeoutS: raw.ENGINE_TIMEOUT_S, killGraceS: raw.ENGINE_KILL_GRACE_S, logMaxBytes: raw.ENGINE_LOG_MAX_BYTES,
      envPassthrough: raw.ENGINE_ENV_PASSTHROUGH,
      mock: { fail: raw.MOCK_ENGINE_FAIL ?? null, stepMs: raw.MOCK_ENGINE_STEP_MS },
    },
    storage: {
      runsRoot: raw.RUNS_ROOT, reportsRoot: raw.REPORTS_ROOT, reportsBaseUrl: raw.REPORTS_BASE_URL.replace(/\/+$/, ''),
      keepRuns: raw.KEEP_RUNS, orphanReportRetentionH: raw.ORPHAN_REPORT_RETENTION_H,
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
    reviewSettingsFile: raw.REVIEW_SETTINGS_FILE ?? null,
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
  const raw = withSandboxDefaults(parsed.data);
  const issues = [...roleIssues(raw, role), ...productionIssues(raw, role), ...adapterIssues(raw, role)];
  if (issues.length) fail(issues);
  return build(raw);
}
