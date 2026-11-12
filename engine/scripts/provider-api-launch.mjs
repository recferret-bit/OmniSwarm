// Shared launch for every API-provider reviewer (today: nearai; a future installed `key:` provider uses it too). The reviewer process receives its allow-listed
// variables; the bridge process receives the base session environment and nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionError } from './agent-rpc.mjs';
import { apiAcpInvocation } from './api-acp-agent.mjs';
import { budgetedRole } from './bridge-budget.mjs';
import { bridgeProcessEnv, reviewerProcessEnv } from './reviewer-env.mjs';
import { presetFor } from './provider-openai-compat.mjs';

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

function roleSubmitTool(ctx) {
  if (ctx.role === 'crosscheck') return 'submit_crosscheck_report';
  if (ctx.role === 'debater') return 'submit_debate_turn';
  if (ctx.role === 'orchestrator') {
    const auditor = bridgeArg(ctx.bridgeArgs, '--auditor') || '';
    if (/-general-review$/.test(auditor)) return 'submit_general_review';
    if (/-stage-advice$/.test(auditor)) return 'submit_stage_advice';
    return 'submit_adjudication';
  }
  return 'submit_audit_report';
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
    submitTool: roleSubmitTool(ctx),
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

// A family that is exactly one catalog API provider (nearai). The family file is then one line;
// everything provider-specific (base URL, key variable, body, headers) lives in the provider catalog.
export function singleProviderFamily(providerId) {
  const preset = presetFor(providerId);
  return {
    name: providerId,
    transport: 'api-acp',
    providers: { [providerId]: { installed: () => true } },
    installed: () => true,
    available: (_reviewer, env = process.env) => Boolean(env[preset.keyEnv]),
    launch: (reviewer, ctx) => buildApiLaunch(reviewer, ctx, preset),
    envAllowlist: () => [...preset.envAllowlist],
    fingerprintEnv: () => preset.keyEnv,
  };
}
