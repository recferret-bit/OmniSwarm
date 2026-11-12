// Builds apps/web in mock mode (MSW + MockConnector) into .next-e2e, serves it
// with `next start`, and provides the axe and browser helpers the specs share.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const WEB = path.join(ROOT, 'apps/web');
export const PORT = 4187;
export const BASE = `http://127.0.0.1:${PORT}`;
export const DIST = '.next-e2e';

const requireWeb = createRequire(path.join(WEB, 'package.json'));
const NEXT = requireWeb.resolve('next/dist/bin/next');
export const AXE = requireWeb.resolve('axe-core/axe.min.js');

const MOCK_ENV = {
  NEXT_PUBLIC_API_MOCK: '1',
  NEXT_PUBLIC_WALLET: 'mock',
  // An unroutable RPC origin: MSW answers it, and nothing can reach a real node.
  NEXT_PUBLIC_RPC_URL: 'https://rpc.mock.invalid',
  // Donations are optional and hidden when unset; the e2e build turns them on to drive them with the mock wallet.
  NEXT_PUBLIC_DONATION_ACCOUNT: 'omniswarm.testnet',
  NEXT_DIST_DIR: DIST,
  NEXT_TELEMETRY_DISABLED: '1',
};

function env(extra = {}) {
  return { ...process.env, ...MOCK_ENV, ...extra };
}

export function buildMockApp() {
  for (const args of [['scripts/msw-worker.mjs'], [NEXT, 'build']]) {
    const result = spawnSync(process.execPath, args, { cwd: WEB, env: env(), encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return path.join(WEB, DIST);
}

// Leaves public/ as a production build expects it: no MSW worker script.
export function removeMockWorker() {
  spawnSync(process.execPath, ['scripts/msw-worker.mjs'], { cwd: WEB, env: { ...process.env, NEXT_PUBLIC_API_MOCK: '0' } });
}

export async function startMockApp() {
  const child = spawn(process.execPath, [NEXT, 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: WEB, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited ${child.exitCode}\n${log}`);
    const ok = await fetch(`${BASE}/`).then((response) => response.ok, () => false);
    if (ok) return { child, log: () => log };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`next start did not answer within 30 s\n${log}`);
}

export async function axeViolations(page) {
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async () => globalThis.axe.run(document, { resultTypes: ['violations'] }));
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}
