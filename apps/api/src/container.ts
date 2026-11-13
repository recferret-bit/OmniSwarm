// Composition root: the only module that picks concrete adapters. Test adapters (mock key verifier, recorded
// GitHub, mock engine) are imported lazily and refused in production, so a production process never
// even loads them.
import path from 'node:path';
import type { AccountKeyVerifier } from './near/key-verifier.ts';
import type { Config } from './config/load.ts';
import { createPool, type Pool } from './db/pool.ts';
import type { EngineRunner } from './engine/port.ts';
import type { GitHubPort } from './github/port.ts';
import { systemClock, type Clock } from './shared/clock.ts';
import { APP_ROOT } from './shared/paths.ts';

function refuseInProduction(config: Config, what: string): void {
  if (config.env === 'production') throw new Error(`${what} is a test adapter and cannot run with NODE_ENV=production`);
}

/** Sign-in only (NEAR wallet): the worker and scripts never read access keys, so they get no verifier. */
export async function createKeyVerifier(config: Config): Promise<AccountKeyVerifier> {
  if (config.keys.verifier === 'mock') {
    refuseInProduction(config, 'KEY_VERIFIER=mock');
    const { MockAccountKeyVerifier } = await import('./near/mock-key-verifier.ts');
    return new MockAccountKeyVerifier();
  }
  const { RpcAccountKeyVerifier } = await import('./near/key-verifier.ts');
  return new RpcAccountKeyVerifier(config.keys.rpcUrls);
}

export async function createGitHub(config: Config): Promise<GitHubPort> {
  if (config.github.adapter === 'recorded') {
    refuseInProduction(config, 'GITHUB_ADAPTER=recorded');
    const { RecordedGitHubAdapter } = await import('./github/recorded/recorded-github.ts');
    return new RecordedGitHubAdapter(config.github.fixturesDir);
  }
  const { LiveGitHubAdapter } = await import('./github/live/live-github.ts');
  return new LiveGitHubAdapter({ apiUrl: config.github.apiUrl, token: config.github.token, timeoutMs: config.github.timeoutMs });
}

export async function createEngine(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<EngineRunner> {
  if (config.engine.runner === 'mock') {
    refuseInProduction(config, 'ENGINE_RUNNER=mock');
    const { MockEngineRunner } = await import('./engine/mock/mock-runner.ts');
    return new MockEngineRunner({ fixtureDir: path.join(APP_ROOT, 'test/fixtures/engine-report'), ...config.engine.mock });
  }
  const { CliEngineRunner } = await import('./engine/cli/cli-runner.ts');
  const { engineEnv } = await import('./engine/cli/env.ts');
  return new CliEngineRunner({
    root: config.engine.root, env: engineEnv(env, config.engine.envPassthrough),
    timeoutS: config.engine.timeoutS, killGraceS: config.engine.killGraceS, logMaxBytes: config.engine.logMaxBytes,
  });
}

export interface CoreDeps { config: Config; pool: Pool; clock: Clock }

export function createCore(config: Config, clock: Clock = systemClock): CoreDeps {
  return { config, pool: createPool(config.db.url, config.db.poolMax), clock };
}
