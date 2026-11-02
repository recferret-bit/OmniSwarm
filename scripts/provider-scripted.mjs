// The `scripted` family: fixture strategies behind the same ACP shim and the same bridge. No LLM, no network.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiAcpInvocation } from './api-acp-agent.mjs';
import { bridgeProcessEnv, reviewerProcessEnv } from './reviewer-env.mjs';
import { DEMO_FIXTURE } from './scripted-strategies.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docker-mcp-bridge.mjs');
const STRATEGIES = ['baseline', 'paranoid', 'lazy', 'wrong', 'judge'];

function launch(reviewer, ctx) {
  const env = ctx.env || process.env;
  const surface = (ctx.bridgeArgs || []).includes('--surface')
    ? ctx.bridgeArgs[ctx.bridgeArgs.indexOf('--surface') + 1]
    : 'S1';
  const config = {
    mode: 'scripted',
    strategy: reviewer.provider,
    model: reviewer.model,
    fixtureRoot: DEMO_FIXTURE,
    surface,
    cwd: ctx.workDir,
    mcp: {
      command: ctx.mcpCommand || process.execPath,
      args: [...(ctx.mcpLeadingArgs || [BRIDGE]), ...(ctx.bridgeArgs || [])],
      env: bridgeProcessEnv(env),
    },
  };
  return apiAcpInvocation(ctx.workDir, config, reviewerProcessEnv(env, []));
}

export const family = {
  name: 'scripted',
  transport: 'api-acp',
  providers: Object.fromEntries(STRATEGIES.map((name) => [name, { installed: () => true }])),
  installed: () => true,
  // scripted:judge is the demo-only last step of the recommended-orchestrator order.
  available: (reviewer, env = process.env) => reviewer.provider !== 'judge' || env.OMNI_DEMO === '1',
  launch,
  envAllowlist: () => [],
  vendorOf: () => 'scripted',
};
