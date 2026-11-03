// Composition root: the only module that picks concrete adapters. Test adapters (mock chain, recorded
// GitHub, mock engine) are imported lazily and refused in production, so a production process never
// even loads them.
import path from 'node:path';
import type { ChainPort } from './chain/port.ts';
import type { Config } from './config/load.ts';
import { createPool, type Pool } from './db/pool.ts';
import type { EngineRunner } from './engine/port.ts';
import type { GitHubPort } from './github/port.ts';
import { systemClock, type Clock } from './shared/clock.ts';
import { APP_ROOT } from './shared/paths.ts';

function refuseInProduction(config: Config, what: string): void {
  if (config.env === 'production') throw new Error(`${what} is a test adapter and cannot run with NODE_ENV=production`);
}

export async function createChain(config: Config, pool: Pool): Promise<ChainPort> {
  if (config.chain.adapter === 'mock') {
    refuseInProduction(config, 'CHAIN_ADAPTER=mock');
    const { MockChainAdapter } = await import('./chain/mock/mock-chain.ts');
    return new MockChainAdapter(pool, {
      contractId: config.intake.contractId, priceYocto: config.intake.priceYocto ?? '0',
      failRate: config.chain.mock.failRate, hangAfter: config.chain.mock.hangAfter,
    });
  }
  const { NearChainAdapter } = await import('./chain/near/near-chain.ts');
  const { loadOperatorSigner } = await import('./chain/near/operator-key.ts');
  const keyPath = config.chain.operatorKeyPath;
  return new NearChainAdapter({
    rpcUrls: config.chain.rpcUrls, contractId: config.intake.contractId, operatorAccountId: config.chain.operatorAccountId,
    operatorSigner: keyPath ? () => loadOperatorSigner(keyPath) : null,
  });
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
  const { resolvePreset } = await import('./worker/preset.ts');
  const preset = resolvePreset(config.engine.configPath, config.intake.hostedPreset);
  return new CliEngineRunner({
    root: config.engine.root, env: engineEnv(env, [...preset.envNames, ...config.engine.envPassthrough]),
    timeoutS: config.engine.timeoutS, killGraceS: config.engine.killGraceS, logMaxBytes: config.engine.logMaxBytes,
  });
}

export interface CoreDeps { config: Config; pool: Pool; clock: Clock; chain: ChainPort }

export async function createCore(config: Config, clock: Clock = systemClock): Promise<CoreDeps> {
  const pool = createPool(config.db.url, config.db.poolMax);
  return { config, pool, clock, chain: await createChain(config, pool) };
}
