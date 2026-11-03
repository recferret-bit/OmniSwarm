// Process plumbing shared by the entry points: fail fast on bad config, drain on SIGTERM/SIGINT.
import { ConfigError, loadConfig, type Config, type Role } from '../config/load.ts';
import type { Logger } from './logger.ts';

export function configOrExit(role: Role): Config {
  try {
    return loadConfig(role);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

/** Run `drain` once on the first SIGTERM/SIGINT, then exit. A second signal exits immediately. */
export function onShutdown(log: Logger, drain: () => Promise<void>, timeoutMs: number): void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      log.warn({ signal }, 'second signal: exiting now');
      process.exit(1);
    }
    stopping = true;
    log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => { log.error('shutdown timed out'); process.exit(1); }, timeoutMs);
    timer.unref();
    drain().then(() => process.exit(0), (error: unknown) => { log.error({ err: error }, 'shutdown failed'); process.exit(1); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
