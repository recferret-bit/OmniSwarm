// The `cli` family: local vendor subscriptions driven through ACP or native sessions
// (ORCHESTRATION section 1). The per-adapter launch branches that used to sit in
// buildSessionLaunch live here, keyed by provider. No key or endpoint enters these processes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExecutable, stageAuditSkill } from './agent-launch.mjs';
import { SessionError } from './agent-rpc.mjs';
import { writeReportFile } from './report-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.resolve(HERE, '../runtime');
export const ADAPTER_PINS = { codex: '2.2.2', claude: '0.92.0' };

export function sessionEnvironment(source = process.env) {
  const env = {};
  // Native subscription stores stay where the official CLI expects them. No key,
  // endpoint, proxy, NODE_OPTIONS or shell-hook override enters this runtime.
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
  catch { throw new SessionError('runtime_missing', 'Install the pinned runtime with ./bin/audit setup-agents (or npm --prefix runtime ci --ignore-scripts).'); }
  if (metadata.version !== ADAPTER_PINS[agent]) throw new SessionError('runtime_version_rejected');
  const file = path.join(directory, 'dist/index.js');
  if (!fs.statSync(file).isFile()) throw new SessionError('runtime_missing');
  return file;
}

const BRIDGE = path.join(HERE, 'docker-mcp-bridge.mjs');
const MAINTAINED = { codex: true, claude: true };

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
  grok({ model, cli, workDir, environment, invocation }) {
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
    invocation.args = ['agent', '--no-leader', '--model', model, '--agent-profile', profile, 'stdio'];
  },
  agy({ model, cli, workDir, invocation, mcpServers, legacyConversationId, provider }) {
    const configFile = 'native-launch.json';
    writeReportFile(workDir, configFile, JSON.stringify({ agent: provider, model, cli, cwd: workDir, mcpServers, legacyConversationId }));
    invocation.args = [path.join(HERE, 'native-acp-agent.mjs'), path.join(workDir, configFile)];
  },
};

// reviewer: {provider, model}; ctx: {workDir, bridgeArgs, legacyConversationId, env, runtimeAdapter}
function launch(reviewer, { workDir, bridgeArgs, legacyConversationId, env = process.env, runtimeAdapter: adapterFor = runtimeAdapter }) {
  const provider = reviewer.provider;
  const cli = resolveExecutable(provider, env);
  if (!cli) throw new SessionError('setup_error', `CLI unavailable: ${provider}`);
  if (!Object.hasOwn(launchers, provider)) throw new SessionError('setup_error');
  stageAuditSkill(workDir);
  const environment = sessionEnvironment(env);
  const mcpServers = [{ name: 'audit_docker', command: process.execPath, args: [BRIDGE, ...bridgeArgs], env: [] }];
  const invocation = { executable: process.execPath, args: [], cwd: workDir, env: environment };
  const sessionMeta = launchers[provider]({ model: reviewer.model, provider, cli, workDir, environment, invocation, mcpServers, legacyConversationId, adapterFor });
  return { invocation, mcpServers, sessionMeta, transport: MAINTAINED[provider] ? 'maintained_acp' : provider === 'grok' ? 'native_acp' : 'native_cli_acp_adapter' };
}

export const family = {
  name: 'cli',
  // pinsModel: a model change reported by the agent mid-session aborts the turn.
  providers: {
    claude: { installed: () => true, pinsModel: false },
    codex: { installed: () => true, pinsModel: true },
    grok: { installed: () => true, pinsModel: true },
    agy: { installed: () => true, pinsModel: false },
    // Registered so specs parse and plan; runs once W03 maps the Z.ai Coding Plan variables.
    'claude-zai': { installed: () => false, wave: 'W03', pinsModel: false },
  },
  installed: () => true,
  // Is this reviewer usable on this machine right now (CLI on PATH)? Used to pick a recommended orchestrator.
  available: (reviewer, env = process.env) => Boolean(resolveExecutable(reviewer.provider, env)),
  launch,
  envAllowlist: () => [],
};
