// The `cli` family: local vendor subscriptions driven through ACP or native sessions
// (ORCHESTRATION section 1). The per-adapter launch branches that used to sit in
// buildSessionLaunch live here, keyed by provider. Subscription CLIs get no key or endpoint;
// the one exception is claude-zai, which maps the operator's ZAI_API_KEY to ANTHROPIC_AUTH_TOKEN
// with the Z.ai Anthropic endpoint (AGENTS.md "Key policy").
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExecutable, stageAuditSkill } from './agent-launch.mjs';
import { SessionError } from './agent-rpc.mjs';
import { writeReportFile } from './report-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const maxTurnsCache = new Map();

// One local --help probe. A missing binary or a help text without the flag means the bridge gate is the limit.
export function claudeMaxTurnsSupport(env = process.env) {
  const cli = resolveExecutable('claude', env);
  if (!cli) return false;
  if (maxTurnsCache.has(cli)) return maxTurnsCache.get(cli);
  const help = spawnSync(cli, ['--help'], { encoding: 'utf8', timeout: 4000, env: sessionEnvironment(env) });
  const supported = /--max-turns\b/.test(`${help.stdout || ''}\n${help.stderr || ''}`);
  maxTurnsCache.set(cli, supported);
  return supported;
}
const RUNTIME = path.resolve(HERE, '../runtime');
export const ADAPTER_PINS = { codex: '2.2.2', claude: '0.92.0' };

export function sessionEnvironment(source = process.env) {
  const env = {};
  // Native subscription stores stay where the official CLI expects them. No key, endpoint,
  // proxy, NODE_OPTIONS or shell-hook override passes through here; claude-zai adds its two
  // mapped variables in launch() below.
  for (const key of ['HOME', 'USER', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'GROK_HOME', 'XDG_CONFIG_HOME']) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  return env;
}

export function runtimeAdapter(agent) {
  const name = agent === 'codex' ? 'codex-acp' : 'claude-agent-acp';
  const directory = path.join(RUNTIME, 'node_modules/@agentclientprotocol', name);
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')); }
  catch { throw new SessionError('runtime_missing', 'Install the pinned runtime with ./bin/audit setup-agents (or npm --prefix engine/runtime ci --ignore-scripts).'); }
  if (metadata.version !== ADAPTER_PINS[agent]) throw new SessionError('runtime_version_rejected');
  const file = path.join(directory, 'dist/index.js');
  if (!fs.statSync(file).isFile()) throw new SessionError('runtime_missing');
  return file;
}

const BRIDGE = path.join(HERE, 'docker-mcp-bridge.mjs');

// Per-provider facts other modules read instead of naming adapters themselves.
// presence: listed by plain `check-agents` (claude-zai only when --reviewers names it);
// transport: how the session reaches the CLI; maxTurnsFlag: the CLI takes --max-turns N+3 itself;
// pinsModel: a model change reported by the agent mid-session aborts the turn.
export const CLI_PROVIDERS = Object.freeze({
  claude: Object.freeze({ installed: () => true, pinsModel: false, presence: true, transport: 'maintained_acp', maxTurnsFlag: false }),
  codex: Object.freeze({ installed: () => true, pinsModel: true, presence: true, transport: 'maintained_acp', maxTurnsFlag: false }),
  grok: Object.freeze({ installed: () => true, pinsModel: true, presence: true, transport: 'native_acp', maxTurnsFlag: true }),
  agy: Object.freeze({ installed: () => true, pinsModel: false, presence: true, transport: 'native_cli_acp_adapter', maxTurnsFlag: false }),
  'claude-zai': Object.freeze({ installed: () => true, pinsModel: false, presence: false, transport: 'maintained_acp', maxTurnsFlag: false }),
});

const launchers = {
  codex({ model, cli, environment, invocation, mcpServers, adapterFor }) {
    environment.CODEX_PATH = cli;
    environment.INITIAL_AGENT_MODE = 'read-only';
    environment.NO_BROWSER = '1';
    environment.CODEX_CONFIG = JSON.stringify({
      model, model_provider: 'openai', model_reasoning_effort: 'high', forced_login_method: 'chatgpt',
      hooks: {}, sandbox_mode: 'read-only', approval_policy: 'on-request', web_search: 'disabled',
      project_doc_max_bytes: 0, mcp_servers: { audit_docker: { command: process.execPath, args: mcpServers[0].args, required: true } },
      features: { shell_tool: false, shell_snapshot: false, apply_patch_freeform: false, js_repl: false, code_mode: false, multi_agent: false, apps: false, image_generation: false, skill_mcp_dependency_install: false },
    });
    invocation.args = [adapterFor('codex')];
  },
  claude({ model, cli, environment, invocation, adapterFor }) {
    environment.CLAUDE_CODE_EXECUTABLE = cli;
    environment.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'false';
    invocation.args = [adapterFor('claude')];
    return { claudeCode: { options: {
      model, tools: [], allowedTools: ['mcp__audit_docker__*'], settingSources: [],
      allowDangerouslySkipPermissions: false, persistSession: true, promptSuggestions: false,
      settings: { disableAllHooks: true, autoMemoryEnabled: false, forceLoginMethod: 'claudeai' },
      extraArgs: { 'strict-mcp-config': '', 'disable-slash-commands': '' },
    } } };
  },
  grok({ model, cli, workDir, environment, invocation, toolBudget }) {
    const profile = path.join(workDir, 'audit-agent.md');
    writeReportFile(workDir, path.basename(profile), '---\nname: audit\ndescription: Review only through the supplied audit MCP bridge\ntools: ["mcp__audit_docker__*"]\ndiscoverSkills: false\nagentsMd: false\n---\nUse only the assigned audit_docker MCP server.\n');
    // Keep the existing official login in place; isolate config, plugins, hooks,
    // memory and persisted conversations without copying credentials.
    environment.GROK_AUTH_PATH = path.join(environment.GROK_HOME || path.join(environment.HOME, '.grok'), 'auth.json');
    environment.HOME = path.join(workDir, 'home');
    environment.GROK_HOME = path.join(environment.HOME, '.grok');
    environment.XDG_CONFIG_HOME = path.join(environment.HOME, '.config');
    fs.mkdirSync(environment.GROK_HOME, { recursive: true, mode: 0o700 });
    environment.GROK_SUBAGENTS = '0';
    invocation.executable = cli;
    invocation.args = ['agent', '--no-leader', '--model', model, ...(toolBudget ? ['--max-turns', String(toolBudget + 3)] : []), '--agent-profile', profile, 'stdio'];
  },
  agy({ model, cli, workDir, invocation, mcpServers, legacyConversationId, provider }) {
    const configFile = 'native-launch.json';
    writeReportFile(workDir, configFile, JSON.stringify({ agent: provider, model, cli, cwd: workDir, mcpServers, legacyConversationId }));
    invocation.args = [path.join(HERE, 'native-acp-agent.mjs'), path.join(workDir, configFile)];
  },
};

// reviewer: {provider, model}; ctx: {workDir, bridgeArgs, legacyConversationId, env, runtimeAdapter}
function launch(reviewer, { workDir, bridgeArgs, legacyConversationId, env = process.env, runtimeAdapter: adapterFor = runtimeAdapter, toolBudget }) {
  const requested = reviewer.provider;
  const provider = requested === 'claude-zai' ? 'claude' : requested;
  const cli = resolveExecutable(provider, env);
  if (!cli) throw new SessionError('setup_error', `CLI unavailable: ${provider}`);
  if (!Object.hasOwn(launchers, provider)) throw new SessionError('setup_error');
  stageAuditSkill(workDir);
  const environment = sessionEnvironment(env);
  const mcpServers = [{ name: 'audit_docker', command: process.execPath, args: [BRIDGE, ...bridgeArgs], env: [] }];
  const invocation = { executable: process.execPath, args: [], cwd: workDir, env: environment };
  const sessionMeta = launchers[provider]({ model: reviewer.model, provider, cli, workDir, environment, invocation, mcpServers, legacyConversationId, adapterFor, toolBudget }) || {};
  if (requested === 'claude-zai') {
    if (typeof env.ZAI_API_KEY !== 'string' || !env.ZAI_API_KEY) throw new SessionError('setup_error', 'ZAI_API_KEY missing');
    delete sessionMeta.claudeCode?.options?.settings?.forceLoginMethod;
    environment.ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
    environment.ANTHROPIC_AUTH_TOKEN = env.ZAI_API_KEY;
    environment.ANTHROPIC_DEFAULT_OPUS_MODEL = reviewer.model;
    environment.ANTHROPIC_DEFAULT_SONNET_MODEL = reviewer.model;
    environment.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'glm-5.3-flash';
    environment.API_TIMEOUT_MS = '3000000';
  }
  if ((requested === 'claude' || requested === 'claude-zai') && toolBudget && sessionMeta.claudeCode && claudeMaxTurnsSupport(env)) {
    sessionMeta.claudeCode.options.extraArgs['max-turns'] = String(toolBudget + 3);
  }
  return { invocation, mcpServers, sessionMeta, transport: CLI_PROVIDERS[provider].transport };
}

export const family = {
  name: 'cli',
  providers: CLI_PROVIDERS,
  installed: () => true,
  // Is this reviewer usable on this machine right now (CLI on PATH)? Used to pick a recommended orchestrator.
  available: (reviewer, env = process.env) => {
    const binary = reviewer.provider === 'claude-zai' ? 'claude' : reviewer.provider;
    return Boolean(resolveExecutable(binary, env)) && (reviewer.provider !== 'claude-zai' || Boolean(env.ZAI_API_KEY));
  },
  launch,
  envAllowlist: (reviewer) => (reviewer?.provider === 'claude-zai' ? ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'] : []),
  // claude-zai maps the operator's ZAI_API_KEY into ANTHROPIC_AUTH_TOKEN; the fingerprint is of that key.
  fingerprintEnv: (reviewer) => (reviewer?.provider === 'claude-zai' ? 'ZAI_API_KEY' : null),
};
