// The one-shot Docker sandbox for a Docker-path review: start `sandbox.sh --hold-file`, wait for its ready
// file, watch the host-only lifecycle record (R-04), and stop/remove the container when the review ends.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubProviderEnv } from './bridge-tools-common.mjs';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';
import { LIFECYCLE_FILE } from './sandbox-host-paths.mjs';

const SANDBOX_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sandbox.sh');
const POLL_MS = 300;

// sandbox.sh and its docker client never see a provider key (ORCHESTRATION 1.1); the rest of the
// operator environment (Docker, caches, sandbox tuning) passes through.
export function sandboxEnv(source = process.env) {
  const env = { ...source };
  scrubProviderEnv(env);
  return env;
}

function readReady(readyFile) {
  if (!fs.existsSync(readyFile)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    return info.container && typeof info.hostDir === 'string' ? info : null;
  } catch { return null; }
}

function watchLifecycle(info, closePromise, isStopping) {
  let reportLoss;
  const lost = new Promise((resolve) => { reportLoss = resolve; });
  // Lifecycle is written by the host next to, not inside, the directory the container can write (R-04).
  const lifecycleFile = path.join(info.hostDir, 'lifecycle.json');
  const monitor = setInterval(() => {
    try { if (JSON.parse(fs.readFileSync(lifecycleFile, 'utf8')).state === 'lost') reportLoss(new Error(`Docker sandbox was lost; inspect ${LIFECYCLE_FILE}.`)); }
    catch { /* the lifecycle writer may not have published its first probe */ }
  }, 1000);
  closePromise.then(() => { clearInterval(monitor); if (!isStopping()) reportLoss(new Error(`One-shot Docker sandbox exited before review completion; inspect ${LIFECYCLE_FILE}.`)); });
  return { lost, monitor };
}

export async function startOneShotDocker({ target, out, preserveHarness = false, skipPrep = false }) {
  const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-hold-'));
  const holdFile = path.join(holdDir, 'hold.lock');
  const readyFile = path.join(holdDir, 'ready.json');
  fs.writeFileSync(holdFile, 'hold\n');
  const args = [
    SANDBOX_SCRIPT,
    '--review-only',
    ...(preserveHarness || skipPrep ? ['--preserve-harness'] : []),
    ...(skipPrep ? ['--skip-prep'] : []),
    '--target', target,
    '--out', out,
    '--hold-file', holdFile,
    '--ready-file', readyFile,
  ];
  const child = spawn('bash', args, { stdio: ['ignore', 'inherit', 'inherit'], env: sandboxEnv() });
  let closed = false, stopping = false, exitCode = null;
  const closePromise = new Promise((resolve) => child.on('close', (code) => { closed = true; exitCode = code ?? 1; resolve(exitCode); }));
  const deadline = Date.now() + Number(process.env.AUDIT_SANDBOX_BUDGET_MS || 45 * 60 * 1000);
  while (!closed && Date.now() < deadline) {
    const info = readReady(readyFile);
    if (info) {
      const { lost, monitor } = watchLifecycle(info, closePromise, () => stopping);
      return {
        container: info.container, hostRunDir: info.hostRunDir, hostDir: info.hostDir, lost,
        stop: async () => {
          stopping = true;
          clearInterval(monitor);
          fs.rmSync(holdFile, { force: true });
          await Promise.race([closePromise, new Promise((r) => setTimeout(r, 15_000))]);
          spawnSync(resolveDockerBin(), ['rm', '-f', info.container], { stdio: 'ignore' });
          fs.rmSync(holdDir, { recursive: true, force: true });
        },
      };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  fs.rmSync(holdFile, { force: true });
  await closePromise;
  fs.rmSync(holdDir, { recursive: true, force: true });
  throw new Error(`One-shot Docker sandbox exited before becoming ready (exit ${exitCode})`);
}
