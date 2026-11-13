// In-process API and worker stacks wired exactly as bin/api.ts and bin/worker.ts wire them, on a
// fresh database with the test adapters (mock key verifier, recorded GitHub, mock engine).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../../src/config/load.ts';
import { createCore, createEngine, createGitHub, createKeyVerifier, type CoreDeps } from '../../src/container.ts';
import { migrateAll } from '../../src/db/deploy.ts';
import { buildApp } from '../../src/http/app.ts';
import type { ApiDeps } from '../../src/http/deps.ts';
import { EventHub } from '../../src/modules/progress/event-hub.ts';
import { createBoss, type PgBoss } from '../../src/queue/boss.ts';
import type { Clock } from '../../src/shared/clock.ts';
import { createLogger } from '../../src/shared/logger.ts';
import { startWorker } from '../../src/worker/worker.ts';
import { freshDatabase, type TestDatabase } from './db.ts';

export const RECIPIENT = 'omniswarm.near';
export const ACCOUNT_KEYS_SECRET = 'k'.repeat(40);
export const SHA = '5c7a2f1e9b3d4c6a8e0f1a2b3c4d5e6f7a8b9c0d';

export class TestClock implements Clock {
  ms = Date.now();
  now() { return new Date(this.ms); }
  advance(ms: number) { this.ms += ms; }
}

export function testEnv(databaseUrl: string, overrides: Record<string, string> = {}): Record<string, string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-api-'));
  return {
    NODE_ENV: 'test', LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent', DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef0123', INTAKE_RECIPIENT: RECIPIENT, ACCOUNT_KEYS_SECRET,
    KEY_VERIFIER: 'mock', GITHUB_ADAPTER: 'recorded', ENGINE_RUNNER: 'mock', MOCK_ENGINE_STEP_MS: '20',
    RUNS_ROOT: path.join(dir, 'runs'), REPORTS_ROOT: path.join(dir, 'published'), REPORTS_BASE_URL: 'https://reports.test',
    QUEUE_HEARTBEAT_S: '10', QUEUE_MONITOR_S: '1', QUEUE_RETRY_DELAY_S: '0', PROGRESS_POLL_MS: '50', RATE_LIMIT_PER_MINUTE: '10000', PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '', ...overrides,
  };
}

export interface TestDb { db: TestDatabase; env: Record<string, string>; config: Config }

/** A fresh, migrated database plus the env every process of the test uses. */
export async function migratedDb(label: string, overrides: Record<string, string> = {}): Promise<TestDb> {
  const db = await freshDatabase(label);
  const env = testEnv(db.url, overrides);
  const config = loadConfig('migrate', env);
  await migrateAll(config);
  return { db, env, config };
}

export interface ApiStack { base: string; app: FastifyInstance; deps: ApiDeps; close(): Promise<void> }

export async function startApi(env: Record<string, string>, clock?: Clock): Promise<ApiStack> {
  const config = loadConfig('api', env);
  const log = createLogger(config.logLevel, 'test-api');
  const core = createCore(config, clock);
  const boss = createBoss(config, 'sender');
  await boss.start();
  const events = new EventHub(config.db.url, log);
  await events.start();
  const deps: ApiDeps = { ...core, github: await createGitHub(config), keys: await createKeyVerifier(config), boss, events, log };
  const app = await buildApp(deps, { sseKeepAliveMs: 1000 });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    base, app, deps,
    async close() {
      await app.close();
      await boss.stop({ graceful: false, close: true });
      await events.close();
      await core.pool.end();
    },
  };
}

export interface WorkerStack { boss: PgBoss; core: CoreDeps; close(): Promise<void> }

export async function startWorkerInProcess(env: Record<string, string>): Promise<WorkerStack> {
  const config = loadConfig('worker', env);
  const log = createLogger(config.logLevel, 'test-worker');
  const core = createCore(config);
  const engine = await createEngine(config, env);
  const boss = createBoss(config, 'worker');
  await boss.start();
  await startWorker(boss, { ...core, engine, log });
  return {
    boss, core,
    async close() {
      await boss.stop({ graceful: true, timeout: 5000, close: true });
      await core.pool.end();
    },
  };
}

export async function until<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 20_000, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
