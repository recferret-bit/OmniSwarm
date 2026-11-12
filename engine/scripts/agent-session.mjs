import fs from 'node:fs';
import path from 'node:path';
import { AgentRpc, SessionError } from './agent-rpc.mjs';
import { openSessionStore } from './agent-session-store.mjs';
import { buildSessionLaunch } from './agent-session-launch.mjs';
import { GRACE } from './bridge-budget.mjs';
import { families } from './reviewer-families.mjs';
import { classifyAuditFailure } from './audit-process.mjs';

import { REVIEW_TOOLS as TOOLS } from './review-workflow.mjs';

export function permissionDecision(params, expectedSession) {
  if (params?.sessionId !== expectedSession) return { outcome: { outcome: 'cancelled' } };
  const call = params.toolCall;
  const name = call?._meta?.claudeCode?.toolName;
  const qualified = typeof name === 'string' && name.startsWith('mcp__audit_docker__') && TOOLS.has(name.slice('mcp__audit_docker__'.length));
  const codexMcp = call?._meta?.is_mcp_tool_call === true && call.rawInput?.server === 'audit_docker' && TOOLS.has(call.rawInput.tool);
  const grokTool = call?._meta?.['x.ai/tool'];
  const grokName = call?.rawInput?.tool_name;
  const grokMcp = grokTool?.version === 1 && grokTool.name === 'use_tool' && grokTool.kind === 'use_tool' && call.rawInput?.variant === 'UseTool' && typeof grokName === 'string' && grokName.startsWith('audit_docker__') && TOOLS.has(grokName.slice('audit_docker__'.length));
  const kind = qualified || codexMcp || grokMcp ? 'allow_once' : 'reject_once';
  const option = params.options?.find(o => o.kind === kind);
  return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
}

// Names a refused call back to its own agent; the model chose this string, so only a short safe token is echoed.
function refusedToolName(call) {
  const name = call?.rawInput?.tool_name ?? call?._meta?.claudeCode?.toolName ?? call?.rawInput?.tool ?? call?.title;
  return String(name ?? '').replace(/[^\w.:-]/g, '').slice(0, 80) || 'unknown';
}

const MAX_REFUSAL_CORRECTIONS = 3;
const refusalCorrection = name => `The audit client refused your tool call ${name}: it is not one of the audit_docker review tools, and wrapped or nested tool calls are refused. Call each audit_docker tool directly by its own name, for example audit_docker__read_file or audit_docker__run_existing_tests. Continue the same assigned review from where you stopped, retain supported work, and submit the report.`;
// Per bridge role (bridge-tools-<role>.mjs): the one submit that ends this session's assignment, and the tools
// the bridge must offer before an agent is launched. Debate and judge roles have read tools only, no test runs.
// An orchestrator session is a judgement or the general review; its name (audit-submission ROLE_NAME) says which.
const REVIEW_READS = ['list_existing_tests', 'run_existing_tests', 'get_audit_context', 'read_file'];
const DEBATE_READS = ['get_audit_context', 'read_file'];
const ROLE_TOOLS = {
  auditor: { submit: () => 'submit_audit_report', reads: REVIEW_READS },
  crosscheck: { submit: () => 'submit_crosscheck_report', reads: REVIEW_READS },
  debater: { submit: () => 'submit_debate_turn', reads: DEBATE_READS },
  orchestrator: { submit: name => (/-general-review$/.test(String(name)) ? 'submit_general_review' : 'submit_adjudication'), reads: DEBATE_READS },
};
const toolsOf = role => ROLE_TOOLS[role] || ROLE_TOOLS.auditor;
const submitTool = (role, name) => toolsOf(role).submit(name);
// The one "hand in your report" turn a budgeted pass gets when the agent ends without submitting.
export const submitNowText = (role, name) => `This pass ended without a report. Call ${submitTool(role, name)} now with what you can support from the source you read, and disclose what you did not cover.`;
const SAME_PASS_CONTINUATION = '\n\nContinue the saved review for this exact source and assignment. Retain supported work and disclose remaining coverage. Use the current audit MCP bridge. The report for this pass is already committed. Finish without submitting a second report.';
const NEW_PASS_CONTINUATION = '\n\nContinue the saved review for this exact source and assignment. Retain supported work and disclose remaining coverage. Use the current audit MCP bridge. This pass has no committed report yet. Call its submit tool with the updated report before you finish.';

function hasCommittedOutput(options) {
  const args = options?.bridgeArgs || [];
  const dirAt = args.indexOf('--report-dir');
  const dir = dirAt >= 0 ? args[dirAt + 1] : '';
  const name = options?.identity?.name;
  if (!dir || !name) return null;
  return fs.existsSync(path.join(dir, 'submissions', `${name}.json`)) || fs.existsSync(path.join(dir, 'debate', 'inbox', `${name}.json`));
}

// A resumed session is either a transport recovery of the current pass (the submission is still there)
// or the next pass (the previous submission was archived). The continuation must not tell a new pass to stop.
export function continuationText(options) {
  return hasCommittedOutput(options) ? SAME_PASS_CONTINUATION : NEW_PASS_CONTINUATION;
}

// The CLI reports a full id ("claude-opus-5-5") for a requested alias ("opus"). A different family does not match.
export function modelMatches(requested, active) {
  const live = String(active || '').split('[')[0];
  const want = String(requested || '');
  if (!live || !want) return false;
  if (live === want) return true;
  return live.startsWith(`${want}-`) || live.includes(`-${want}-`) || live.endsWith(`-${want}`);
}
const PROVIDER_REASONS = ['provider_policy', 'usage_limit', 'auth_required', 'mcp_unavailable'];

function modelValue(options) { return options?.find(option => option.category === 'model' || option.id === 'model')?.currentValue; }

export async function preflightBridge(server, { cwd, env, signal, expectedRole, expectedName }) {
  const rpc = new AgentRpc({ executable: server.command, args: server.args, cwd, env });
  const abort = () => rpc.fail(new SessionError('cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new SessionError('cancelled');
    await rpc.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit-preflight', version: '1.0.0' } });
    rpc.notify('notifications/initialized');
    const result = await rpc.request('tools/list');
    const names = new Set(result.tools?.map(tool => tool.name));
    if (['write_poc', 'run_container_check', 'get_attack_plan'].some(name => names.has(name)) || ![...toolsOf(expectedRole).reads, submitTool(expectedRole, expectedName)].every(name => names.has(name))) throw new SessionError('mcp_unavailable');
    await rpc.request('ping');
    return { state: 'ready', tools: [...names] };
  } catch (err) { throw err.reason === 'cancelled' ? err : new SessionError('mcp_unavailable'); }
  finally { signal?.removeEventListener('abort', abort); await rpc.close(); }
}

// Live state of one session across its turns and recoveries; heartbeats read it.
function sessionState(store, options) {
  const s = { store, options, started: Date.now(), phase: 'starting', sessionId: store.state.sessionId, recoveries: 0, rpc: null, activeModel: undefined, lastAgent: null, lastTransport: null, lastProcess: null };
  s.result = (fields) => ({ code: 0, elapsedMs: Date.now() - s.started, sessionId: s.sessionId, directory: options.directory, recoveryAttempts: s.recoveries, ...fields });
  return s;
}

function startHeartbeat(s, heartbeatMs) {
  const progress = () => {
    const now = Date.now();
    const status = { phase: s.phase, elapsedMs: now - s.started, agentIdleMs: s.lastAgent == null ? null : now - s.lastAgent, transportIdleMs: s.lastTransport == null ? null : now - s.lastTransport, processIdleMs: s.lastProcess == null ? null : now - s.lastProcess, pid: s.rpc?.child.pid, sessionId: s.sessionId, timeLimitMs: null };
    s.store.save(s.phase, { heartbeat: status });
    (s.options.onProgress || (() => {}))(status);
  };
  return setInterval(() => {
    try { progress(); }
    catch { s.rpc?.fail(new SessionError('session_record_failed')); }
  }, heartbeatMs);
}

function isSearchToolUpdate(update) {
  const xai = update?._meta?.['x.ai/tool'];
  return update?.rawInput?.variant === 'SearchTool'
    || update?.rawOutput?.type === 'SearchTool'
    || update?.title === 'search_tool'
    || String(update?.title || '').startsWith('Search tools:')
    || xai?.name === 'search_tool'
    || xai?.kind === 'search_tool';
}

function updateToolText(update) {
  const raw = update?.rawInput || {};
  return [update?.title, raw.tool_name, raw.tool, raw.name, update?._meta?.claudeCode?.toolName].filter(Boolean).join(' ');
}

// The bridge is the budget: it counts calls as it serves them and answers the three calls after N with "call
// <submit> now". The session's own count is only the backstop for an agent that ignores those answers, and it
// runs ahead of the bridge: it counts a call when the agent announces it, Codex and Grok announce 8 to 11 reads
// in one batch before the bridge has served any, and AGY's own workspace reads never reach the bridge. Cancelling
// at N+3 announced calls killed agents mid-batch, before they read the bridge's "submit now". The backstop
// therefore sits at least one batch above the bridge's limit.
export function sessionCallLimit(toolBudget) {
  return toolBudget + GRACE + Math.max(12, Math.ceil(toolBudget / 4));
}

// Tool calls the agent reports in this turn. More than sessionCallLimit(N) counted calls without a submit
// cancels the pass. A submit is tracked by its call id: a failed result often carries no title, so it would not
// otherwise be recognised as the submit that failed.
function onSessionUpdate(s, turn, params) {
  // During load, an adapter may replay history before returning. Its notifications must still belong to the exact saved session.
  if (s.sessionId && params?.sessionId !== s.sessionId) throw new SessionError('session_identity_rejected');
  s.lastAgent = Date.now();
  const update = params?.update;
  if (update?.sessionUpdate === 'config_option_update') {
    const value = modelValue(update.configOptions);
    if (value && s.activeModel && value !== s.activeModel && !modelMatches(s.options.identity?.model, value)) throw new SessionError('model_changed');
  }
  // session/load replays history before the prompt. Those calls are not this pass.
  if ((update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') && turn.live) {
    if (isSearchToolUpdate(update)) {
      if (update.toolCallId) turn.seenCalls.add(update.toolCallId);
    } else {
      const callId = update.toolCallId;
      const firstSeen = callId ? !turn.seenCalls.has(callId) : update.sessionUpdate === 'tool_call';
      if (callId) turn.seenCalls.add(callId);
      const { identity, budgets } = s.options;
      const isSubmit = updateToolText(update).includes(submitTool(identity?.role, identity?.name)) || Boolean(callId && turn.submitCalls.has(callId));
      if (isSubmit && callId) turn.submitCalls.add(callId);
      const failed = update.status === 'failed' || update.status === 'STEP_STATE_ERROR' || update.status === 'error';
      if (isSubmit) {
        if (failed && hasCommittedOutput(s.options) === false) turn.submitted = false;
        else if (!failed) turn.submitted = true;
      } else if (firstSeen) {
        turn.toolCalls += 1;
      }
      if (!turn.submitted && hasCommittedOutput(s.options) === true) turn.submitted = true;
      if (budgets && !turn.submitted && !turn.budgetCancel && turn.toolCalls > sessionCallLimit(budgets.toolBudget)) {
        turn.budgetCancel = true;
        try { s.rpc.notify('session/cancel', { sessionId: s.sessionId }); } catch { /* the prompt result records the stop */ }
      }
    }
  }
  if (['tool_call', 'tool_call_update', 'plan'].includes(update?.sessionUpdate)) s.store.save(s.phase, { activity: update.sessionUpdate });
}

function openRpc(s, spec, turn) {
  const { logFile } = s.options;
  const attempt = s.recoveries;
  s.rpc = new AgentRpc(spec.invocation, {
    logFile: logFile ? attempt ? `${logFile}.recovery-${attempt}` : logFile : undefined,
    onActivity: kind => { if (kind === 'transport') s.lastTransport = Date.now(); else s.lastProcess = Date.now(); },
    onRequest: async (method, params) => {
      if (method !== 'session/request_permission') throw new SessionError('permission_denied');
      s.phase = 'waiting_permission';
      const decision = permissionDecision(params, s.sessionId);
      const allowed = params?.options?.find(option => option.optionId === decision.outcome.optionId)?.kind === 'allow_once';
      if (!allowed) {
        turn.refused = refusedToolName(params?.toolCall);
        if (turn.toolCalls > 0) turn.toolCalls -= 1;
      }
      s.store.save(s.phase, { event: allowed ? 'permission_decided' : 'permission_denied' });
      s.phase = 'running';
      return decision;
    },
    onNotification: (method, params) => { if (method === 'session/update') onSessionUpdate(s, turn, params); },
  });
}

// initialize + session/new or session/load, with the model pin checked against what the agent reports.
async function openSession(s, spec, turn) {
  const { identity } = s.options;
  s.phase = 'initializing';
  const init = await s.rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'omniswarm-audit', version: '1.0.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  if (init.protocolVersion !== 1) throw new SessionError('protocol_error');
  turn.resumeCapable = init.agentCapabilities?.loadSession === true;
  const agentInfo = init.agentInfo || (typeof init._meta?.agentVersion === 'string' ? { name: identity.agent, version: init._meta.agentVersion.slice(0, 128) } : {});
  s.store.save(s.phase, { agentCapabilities: init.agentCapabilities || {}, agentInfo, resumeCapable: turn.resumeCapable });
  const params = { cwd: s.store.workspace, mcpServers: spec.mcpServers, ...(spec.sessionMeta ? { _meta: spec.sessionMeta } : {}) };
  let opened;
  if (s.sessionId) {
    if (!turn.resumeCapable) throw new SessionError('resume_unsupported');
    s.phase = 'resuming';
    opened = await s.rpc.request('session/load', { ...params, sessionId: s.sessionId }, 60_000);
  } else {
    opened = await s.rpc.request('session/new', params, 60_000);
    if (typeof opened.sessionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(opened.sessionId)) throw new SessionError('protocol_error');
    s.sessionId = opened.sessionId;
  }
  let activeModel = modelValue(opened.configOptions) || opened.models?.currentModelId;
  if (families.modelPinned({ family: identity.family || 'cli', provider: identity.provider || identity.agent }) && activeModel && !modelMatches(identity.model, activeModel)) {
    const modelOption = opened.configOptions?.find(option => option.category === 'model' || option.id === 'model');
    const match = modelOption?.options?.find(opt => modelMatches(identity.model, opt?.value));
    if (modelOption && match) {
      const updated = await s.rpc.request('session/set_config_option', { sessionId: s.sessionId, configId: modelOption.id || 'model', value: match.value }, 15_000).catch(() => null);
      activeModel = modelValue(updated?.configOptions) || match.value;
    }
    if (!modelMatches(identity.model, activeModel)) throw new SessionError('model_changed');
  }
  s.activeModel = activeModel;
  s.store.save('running', { sessionId: s.sessionId, selectedModel: s.activeModel || identity.model });
  s.phase = 'running';
  return init;
}

// Grok ends its whole turn when a tool call is refused. Answer the refusal in the same session so the review
// continues instead of being recorded as user-cancelled.
async function promptWithCorrections(s, turn, text) {
  const { signal } = s.options;
  for (let corrections = 0; ; corrections++) {
    turn.refused = null;
    const result = await s.rpc.request('session/prompt', { sessionId: s.sessionId, prompt: [{ type: 'text', text }] }, null);
    if (result.stopReason !== 'cancelled' || signal?.aborted || !turn.refused) return result;
    if (corrections === MAX_REFUSAL_CORRECTIONS) throw new SessionError('permission_denied');
    s.store.save('running', { event: 'refusal_corrected' });
    text = refusalCorrection(turn.refused);
  }
}

function providerStop(store) {
  try { return JSON.parse(fs.readFileSync(path.join(store.workspace, 'api-session.json'), 'utf8')).stop || null; }
  catch { return null; } // cli sessions have no api-session file
}

async function endTurn(s, spec, stop, stopReason) {
  const exit = await s.rpc.close();
  s.phase = 'completed';
  s.store.save(s.phase, { stop, stopReason, completedAt: new Date().toISOString() });
  return s.result({ observedExitCode: exit.code, processSignal: exit.signal, transport: spec.transport, stop, stopReason });
}

// One chance to hand in the report. A second empty ending, or more than sessionCallLimit(N) calls, cancels the pass.
// The committed file decides whether the pass handed something in, when the session can see it: a submit the
// bridge rejected (a schema error) was announced like any other call, and must still get the correction turn.
async function settleTurn(s, spec, turn, init, result) {
  const { budgets, signal, identity } = s.options;
  if (providerStop(s.store) === 'cost') return endTurn(s, spec, 'cost', result.stopReason);
  const committed = hasCommittedOutput(s.options);
  if (committed === true) turn.submitted = true;
  else if (committed === false) turn.submitted = false;
  if (signal?.aborted) throw new SessionError('cancelled');
  if (budgets && result.stopReason === 'end_turn' && !turn.submitted && !turn.budgetCancel) {
    s.store.save('running', { event: 'submit_now' });
    result = await s.rpc.request('session/prompt', { sessionId: s.sessionId, prompt: [{ type: 'text', text: submitNowText(identity.role, identity.name) }] }, null);
    const corrected = hasCommittedOutput(s.options);
    if (corrected === true) turn.submitted = true;
    else if (corrected === false) turn.submitted = false;
  }
  if (signal?.aborted) throw new SessionError('cancelled');
  if (budgets && !turn.submitted && (turn.budgetCancel || result.stopReason === 'end_turn')) {
    try { s.rpc.notify('session/cancel', { sessionId: s.sessionId }); } catch { /* already cancelled */ }
    return endTurn(s, spec, 'budget', 'cancelled');
  }
  // A loaded conversation can replay old errors, and a review can quote them.
  // Only the current RPC failure/stop status controls whether this turn succeeded.
  if (result.stopReason === 'cancelled' || signal?.aborted) throw new SessionError('cancelled');
  if (result.stopReason !== 'end_turn') throw new SessionError('turn_incomplete');
  if (init.agentCapabilities?.sessionCapabilities?.close) await s.rpc.request('session/close', { sessionId: s.sessionId });
  const exit = await s.rpc.close();
  if (exit.code != null && exit.code !== 0) throw new SessionError('process_error');
  s.phase = 'completed';
  const stop = budgets ? 'submitted' : undefined;
  s.store.save(s.phase, { stopReason: result.stopReason, ...(stop ? { stop } : {}), completedAt: new Date().toISOString() });
  return s.result({ observedExitCode: exit.code, processSignal: exit.signal, transport: spec.transport, stop, stopReason: result.stopReason });
}

function failureReason(error, signal) {
  if (signal?.aborted) return 'cancelled';
  const failure = classifyAuditFailure({ code: 1, rpcError: error.reason === 'provider_error' ? error.message : undefined });
  return error.reason === 'provider_error' && PROVIDER_REASONS.includes(failure.reason) ? failure.reason : error.reason || 'process_error';
}

// One turn of a session. Returns the session result, or null when a lost transport is recovered (load and retry).
async function runTurn(s, spec, maxRecoveries) {
  const turn = { resumeCapable: false, refused: null, toolCalls: 0, seenCalls: new Set(), submitCalls: new Set(), submitted: false, budgetCancel: false };
  const attempt = s.recoveries;
  openRpc(s, spec, turn);
  try {
    const init = await openSession(s, spec, turn);
    if (s.options.signal?.aborted) throw new SessionError('cancelled');
    turn.live = true;
    const result = await promptWithCorrections(s, turn, s.options.prompt + (attempt || s.options.resume ? continuationText(s.options) : ''));
    return await settleTurn(s, spec, turn, init, result);
  } catch (error) {
    const reason = failureReason(error, s.options.signal);
    if (reason === 'transport_lost' && turn.resumeCapable && s.sessionId && s.recoveries < maxRecoveries && !s.options.signal?.aborted) {
      s.recoveries++;
      s.store.save('interrupted', { reason, recoveryAttempts: (s.store.state.recoveryAttempts || 0) + 1 });
      return null;
    }
    throw new SessionError(reason);
  } finally { s.observedExit = await s.rpc.close(); s.rpc = null; }
}

// All four providers use this ACP client. Native CLI compatibility is isolated
// behind native-acp-agent; the coordinator never parses their terminal prose.
export async function runReviewSession(options, { launch = buildSessionLaunch, preflight = preflightBridge, heartbeatMs = 30_000, maxRecoveries = 1 } = {}) {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 2_147_483_647 || !Number.isInteger(maxRecoveries) || maxRecoveries < 0 || maxRecoveries > 2) throw new SessionError('setup_error');
  const { identity, bridgeArgs, signal, legacyConversationId, env = process.env, budgets, prices } = options;
  const s = sessionState(openSessionStore(options.directory, identity), options);
  const timer = startHeartbeat(s, heartbeatMs);
  const abort = () => {
    s.phase = 'cancelling';
    try { if (s.sessionId) s.rpc?.notify('session/cancel', { sessionId: s.sessionId }); } catch { /* transport already lost */ }
    s.rpc?.rejectPending(new SessionError('cancelled'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new SessionError('cancelled');
    const spec = launch({ agent: identity.agent, role: identity.role, family: identity.family, provider: identity.provider, model: identity.model, workDir: s.store.workspace, bridgeArgs, legacyConversationId, env, toolBudget: budgets?.toolBudget, maxTurns: budgets ? budgets.toolBudget + GRACE : undefined, maxCostUsd: budgets?.maxCostUsd, prices });
    const bridge = await preflight(spec.mcpServers[0], { cwd: s.store.workspace, env: spec.bridgeEnv || spec.invocation.env, signal, expectedRole: identity.role, expectedName: identity.name });
    s.store.save('bridge_ready', { bridge, transport: spec.transport });
    for (;;) {
      const result = await runTurn(s, spec, maxRecoveries);
      if (result) return result;
    }
  } catch (error) {
    s.phase = error.reason === 'cancelled' ? 'cancelled' : 'failed';
    s.store.save(s.phase, { failureReason: error.reason || 'process_error', observedExitCode: s.observedExit?.code ?? null, processSignal: s.observedExit?.signal ?? null });
    return { code: error.reason === 'cancelled' ? 130 : 1, observedExitCode: s.observedExit?.code, processSignal: s.observedExit?.signal, elapsedMs: Date.now() - s.started, failureReason: error.reason || 'process_error', sessionId: s.sessionId, directory: options.directory };
  } finally { clearInterval(timer); signal?.removeEventListener('abort', abort); }
}
