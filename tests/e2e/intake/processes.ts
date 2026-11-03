// The intake processes exactly as infra starts them: `src/bin/migrate.ts`, `src/bin/api.ts`,
// `src/bin/worker.ts` and the dev scripts, each a child process with its own env.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const API = path.join(ROOT, 'apps/api');

export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function script(file: string, args: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [path.join(API, file), ...args], { cwd: API, env, encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

export class Proc {
  readonly child: ChildProcess;
  output = '';

  constructor(file: string, env: Record<string, string>) {
    this.child = spawn(process.execPath, [path.join(API, file)], { cwd: API, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout?.on('data', (chunk) => { this.output += chunk; });
    this.child.stderr?.on('data', (chunk) => { this.output += chunk; });
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<number | null> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return this.child.exitCode;
    const exited = new Promise<number | null>((resolve) => this.child.once('exit', (code) => resolve(code)));
    this.child.kill(signal);
    return exited;
  }
}

export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export function step(n: number | string, text: string): void {
  process.stdout.write(`# step ${n}: ${text}\n`);
}
