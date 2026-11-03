// Shared launch for key: and openrouter: reviewers. The reviewer process receives its allow-listed
// variables; the bridge process receives the base session environment and nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionError } from './agent-rpc.mjs';
import { apiAcpInvocation } from './api-acp-agent.mjs';
import { bridgeProcessEnv, reviewerProcessEnv } from './reviewer-env.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-mcp-bridge.mjs');

export function buildApiLaunch(reviewer, ctx, preset) {
  const env = ctx.env || process.env;
  if (!env[preset.keyEnv]) throw new SessionError('setup_error', `${preset.keyEnv} missing`);
  const config = {
    mode: 'openai',
    provider: preset.provider,
    model: reviewer.model,
    baseUrl: preset.baseUrl(env),
    keyEnv: preset.keyEnv,
    headers: preset.headers(env),
    extraBody: preset.extraBody,
    maxTurns: ctx.maxTurns || (ctx.toolBudget ? ctx.toolBudget + 3 : 40),
    // The last turn forces this role's submit tool (W04-09).
    submitTool: ctx.role === 'crosscheck' ? 'submit_crosscheck_report' : 'submit_audit_report',
    maxCostUsd: ctx.maxCostUsd ?? null,
    prices: ctx.prices || null,
    cwd: ctx.workDir,
    mcp: {
      command: ctx.mcpCommand || process.execPath,
      args: [...(ctx.mcpLeadingArgs || [BRIDGE]), ...(ctx.bridgeArgs || [])],
      env: bridgeProcessEnv(env),
    },
  };
  return apiAcpInvocation(ctx.workDir, config, reviewerProcessEnv(env, preset.envAllowlist));
}
