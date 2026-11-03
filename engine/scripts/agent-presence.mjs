// `audit check-agents` (no --live): Docker, the subscription CLIs and the pinned ACP runtime, offline.
// The CLI list comes from the cli family (providers that have a presence check), never from a list here.
// AGY is ready only when its PreToolUse hook, staged exactly as a review stages it, refuses host tools (R-08).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExecutable, stageAgyPlugin } from './agent-launch.mjs';
import { runtimeAdapter, sessionEnvironment } from './agent-session-launch.mjs';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';
import { families } from './reviewer-families.mjs';

const BRIDGE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-mcp-bridge.mjs');

export function presenceProviders() {
  return Object.entries(families.get('cli').providers).filter(([, meta]) => meta.presence !== false).map(([name]) => name);
}

// Stage the AGY plugin in a throwaway workspace and run the hook on a denied and an allowed call.
export function agyHookStatus({ preflight = stageAgyPlugin } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-check-'));
  try { return preflight({ workDir, bridgeArgs: [] }); }
  catch (error) { return { state: 'unavailable', reason: 'hook_not_enforced', detail: error.message }; }
  finally { fs.rmSync(workDir, { recursive: true, force: true }); }
}

function runtimeOf(agent, meta) {
  if (meta.transport !== 'maintained_acp') return meta.transport || 'native_cli_acp_adapter';
  try { runtimeAdapter(agent); return 'maintained_acp'; }
  catch { return 'missing_or_invalid'; }
}

function agentRow(agent, env, hookStatus) {
  const meta = families.get('cli').providers[agent];
  const exe = resolveExecutable(agent, env);
  const base = { agent, bridgeMode: 'docker_mcp_stdio' };
  if (!exe) return { ...base, state: 'unavailable', executable: null, version: null };
  const ver = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000, env: sessionEnvironment(env) });
  const version = (ver.stdout || ver.stderr || '').trim().split('\n')[0] || '';
  const agentTransport = runtimeOf(agent, meta);
  const row = { ...base, state: ver.status === 0 && agentTransport !== 'missing_or_invalid' ? 'ready' : 'error', executable: exe, version, agentTransport };
  if (agent !== 'agy') return row;
  const hook = hookStatus();
  return hook.state === 'ready' ? { ...row, hook: 'enforced' } : { ...row, state: 'unavailable', hook: hook.reason, hookDetail: hook.detail };
}

export function checkBridgeAgents(env = process.env, { hookStatus = agyHookStatus } = {}) {
  const dockerBin = resolveDockerBin();
  const dockerInfo = spawnSync(dockerBin, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 8000 });
  const dockerReady = dockerInfo.status === 0;
  const agents = presenceProviders().filter((agent) => families.check({ family: 'cli', provider: agent }).ok).map((agent) => agentRow(agent, env, hookStatus));
  return {
    state: dockerReady && agents.every((a) => a.state === 'ready') ? 'ready' : 'degraded',
    scope: 'docker_cli_and_pinned_runtime_availability_only',
    note: 'Authentication, quotas, MCP attachment and inference were not tested. Use check-agents --live for inert qualification.',
    docker: { ready: dockerReady, binary: dockerBin, version: (dockerInfo.stdout || '').trim() || null },
    bridgeScript: BRIDGE_SCRIPT,
    agents,
  };
}
