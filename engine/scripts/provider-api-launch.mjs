// Shared launch for key: and openrouter: reviewers. The reviewer process receives its allow-listed
// variables; the bridge process receives the base session environment and nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionError } from './agent-rpc.mjs';
import { apiAcpInvocation } from './api-acp-agent.mjs';
import { budgetedRole } from './bridge-budget.mjs';
import { bridgeProcessEnv, reviewerProcessEnv } from './reviewer-env.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-mcp-bridge.mjs');

function bridgeArg(args, flag) {
  const at = (args || []).indexOf(flag);
  return at >= 0 ? args[at + 1] || null : null;
}

// A reviewer's spend is booked in the run's harness/budget-<reviewer>.json, the file its bridge counts calls in,
// so the cost ceiling holds for the whole run (all passes and surfaces), not for one tool loop.
function spendLedger(ctx) {
  const reportDir = bridgeArg(ctx.bridgeArgs, '--report-dir');
  const reviewerId = bridgeArg(ctx.bridgeArgs, '--agent');
  return reportDir && reviewerId && budgetedRole(ctx.role) ? { reportDir, reviewerId } : null;
}

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
    spendLedger: spendLedger(ctx),
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
