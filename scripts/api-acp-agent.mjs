// ACP adapter around OmniSwarm's own tool loop. The parent speaks ACP; this process speaks MCP to the
// bridge it spawns and (for key/openrouter) HTTPS to the provider. Scripted reviewers use the same
// process and the same bridge, with no provider request.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReportJson, writeReportFile } from './report-contract.mjs';
import { SessionError } from './agent-rpc.mjs';
import { runToolLoop } from './provider-openai-compat.mjs';
import { toOpenAiTools, toolResultText } from './api-tool-schema.mjs';
import { passFromBrief, runStrategy } from './scripted-strategies.mjs';

// Loop failures that keep their own name in the session record instead of a generic provider_error.
const LOOP_FAILURES = { auth: 'auth_required', live_required: 'live_required' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

export function writeLaunchConfig(workDir, config) {
  const file = path.join(workDir, 'api-launch.json');
  fs.writeFileSync(file, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return file;
}

export function apiAcpInvocation(workDir, config, env) {
  const file = writeLaunchConfig(workDir, config);
  return {
    invocation: { executable: process.execPath, args: [path.join(HERE, 'api-acp-agent.mjs'), file], cwd: workDir, env },
    mcpServers: [{ name: 'audit_docker', command: config.mcp.command, args: config.mcp.args, env: [] }],
    bridgeEnv: config.mcp.env,
    transport: 'api-acp',
  };
}

const MAX_LINE = 4 * 1024 * 1024;
const SUBMIT_TOOLS = new Set(['submit_audit_report', 'submit_crosscheck_report']);

// MCP client for the bridge child. Lines are capped like agent-rpc.mjs, and every pending call is
// rejected when the bridge exits, so a dead bridge ends the turn instead of hanging it.
export class McpClient {
  constructor(command, args, env) {
    this.pending = new Map();
    this.buffer = '';
    this.seq = 0;
    this.exited = false;
    this.child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {});
    this.child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.child.stdout.on('data', (chunk) => this.receive(chunk));
    this.child.once('error', () => this.end(new SessionError('mcp_unavailable')));
    this.closed = new Promise((resolve) => this.child.once('close', () => { this.end(new SessionError('mcp_unavailable')); resolve(); }));
  }
  receive(chunk) {
    this.buffer += chunk.toString('utf8');
    for (let at; (at = this.buffer.indexOf('\n')) >= 0;) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (line.length > MAX_LINE) return this.fail();
      this.settle(line);
    }
    if (this.buffer.length > MAX_LINE) this.fail();
  }
  settle(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const pending = this.pending.get(msg?.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message || 'mcp error'));
    else pending.resolve(msg.result);
  }
  fail() {
    this.buffer = '';
    this.end(new SessionError('protocol_error'));
    try { this.child.kill('SIGTERM'); } catch { /* already exited */ }
  }
  end(error) {
    this.exited = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
  request(method, params = {}) {
    if (this.exited) return Promise.reject(new SessionError('mcp_unavailable'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async stop() {
    try { this.child.kill('SIGTERM'); } catch { /* already exited */ }
    await this.closed;
  }
}

export class ApiAcpAgent {
  constructor(config, output = send) {
    if (!config?.mcp?.command || !Array.isArray(config.mcp.args) || !path.isAbsolute(config.cwd)) throw new SessionError('setup_error');
    this.config = config;
    this.output = output;
    this.mcp = null;
  }
  update(update) { this.output({ method: 'session/update', params: { sessionId: this.state.sessionId, update } }); }
  save() { writeReportFile(this.config.cwd, 'api-session.json', JSON.stringify(this.state)); }
  async request(method, params = {}) {
    if (method === 'initialize') {
      if (params.protocolVersion !== 1) throw new SessionError('protocol_error');
      return { protocolVersion: 1, agentInfo: { name: 'audit-api-acp', version: '1.0.0' }, agentCapabilities: { loadSession: true, mcpCapabilities: { http: false, sse: false } }, authMethods: [] };
    }
    if (method === 'session/new') {
      if (this.state) throw new SessionError('protocol_error');
      if (params.cwd !== this.config.cwd) throw new SessionError('session_identity_rejected');
      this.state = { version: 1, sessionId: crypto.randomUUID(), model: this.config.model, transport: 'api-acp', turns: 0 };
      this.save();
      return { sessionId: this.state.sessionId };
    }
    if (method === 'session/load') {
      const state = readReportJson(this.config.cwd, 'api-session.json');
      if (state.sessionId !== params.sessionId || state.model !== this.config.model) throw new SessionError('session_identity_rejected');
      this.state = state;
      return {};
    }
    if (method === 'session/cancel') {
      if (this.state?.sessionId !== params.sessionId) throw new SessionError('session_identity_rejected');
      this.cancelled = true;
      await this.mcp?.stop();
      return {};
    }
    if (method === 'session/prompt') return this.prompt(params);
    throw new SessionError('unsupported_method');
  }
  async openBridge() {
    const { command, args, env } = this.config.mcp;
    this.mcp = new McpClient(command, args, env);
    await this.mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit-api-acp', version: '1.0.0' } });
    this.mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await this.mcp.request('tools/list');
    return listed.tools || [];
  }
  async callBridge(name, args) {
    const id = `${name}-${this.state.turns}-${crypto.randomBytes(3).toString('hex')}`;
    this.update({ sessionUpdate: 'tool_call', toolCallId: id, title: name, status: 'in_progress' });
    const result = await this.mcp.request('tools/call', { name, arguments: args });
    const text = toolResultText(result);
    if (SUBMIT_TOOLS.has(name)) this.submitAccepted = this.submitAccepted || !result?.isError;
    this.update({ sessionUpdate: 'tool_call_update', toolCallId: id, title: name, status: result?.isError ? 'failed' : 'completed' });
    return text;
  }
  async prompt(params) {
    if (!this.state || params.sessionId !== this.state.sessionId || !Array.isArray(params.prompt)) throw new SessionError('protocol_error');
    const brief = params.prompt.map((part) => part.text || '').join('\n');
    const tools = await this.openBridge();
    this.submitAccepted = false;
    try {
      if (this.config.mode === 'scripted') {
        await runStrategy(this.config.strategy, {
          callTool: (name, args) => this.callBridge(name, args),
          fixtureRoot: this.config.fixtureRoot,
          surface: this.config.surface || 'S1',
          pass: passFromBrief(brief),
        });
        this.state.turns += 1;
        // A submit the bridge rejected (or none at all) is not a submitted pass.
        this.state.stop = this.submitAccepted ? 'submitted' : 'error';
        this.state.failure = this.submitAccepted ? null : 'submit_rejected';
        this.save();
        return { stopReason: 'end_turn' };
      }
      const loop = await runToolLoop({
        baseUrl: this.config.baseUrl,
        apiKey: process.env[this.config.keyEnv] || '',
        model: this.config.model,
        headers: this.config.headers || {},
        extraBody: this.config.extraBody || {},
        tools: toOpenAiTools(tools),
        callTool: (name, args) => this.callBridge(name, args),
        brief,
        maxTurns: this.config.maxTurns || 40,
        maxCostUsd: this.config.maxCostUsd ?? null,
        prices: this.config.prices || null,
        provider: this.config.provider,
        transcriptPath: path.join(this.config.cwd, 'loop-transcript.jsonl'),
      });
      this.state.turns += loop.turns;
      this.state.servedModel = loop.servedModel;
      this.state.stop = loop.failure === 'model_mismatch' ? 'error' : loop.stop;
      this.state.usage = loop.usage;
      this.state.cost = (loop.usage || []).reduce((total, row) => total + (Number(row.cost) || 0), 0);
      this.state.failure = loop.failure || null;
      this.save();
      if (loop.failure === 'model_mismatch') throw new SessionError('model_mismatch');
      if (loop.stop === 'error') throw new SessionError(LOOP_FAILURES[loop.failure] || 'provider_error');
      return { stopReason: 'end_turn' };
    } finally {
      await this.mcp?.stop();
      this.mcp = null;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = path.resolve(process.argv[2]);
  const config = readReportJson(path.dirname(configPath), path.basename(configPath));
  const agent = new ApiAcpAgent(config);
  let buffer = '';
  process.stdin.on('data', (data) => {
    buffer += data.toString('utf8');
    if (buffer.length > 4 * 1024 * 1024) { process.exitCode = 2; process.stdin.destroy(); return; }
    for (let at; (at = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { process.exitCode = 2; continue; }
      Promise.resolve().then(() => agent.request(msg.method, msg.params)).then(
        (result) => { if (msg.id != null) send({ id: msg.id, result }); },
        (err) => { if (msg.id != null) send({ id: msg.id, error: { code: -32000, message: err.reason || 'provider_error' } }); },
      );
    }
  });
}
