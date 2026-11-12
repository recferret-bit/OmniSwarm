import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { continuationText, modelMatches, passLedger, runReviewSession, permissionDecision, preflightBridge } from './agent-session.mjs';
import { openSessionStore } from './agent-session-store.mjs';
import { buildSessionLaunch, sessionEnvironment } from './agent-session-launch.mjs';

const identity = { agent: 'claude', model: 'fixture-model', sourceDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), role: 'auditor', name: 'claude-s1-auth', surface: 'S1' };
const fixtureScript = `
import fs from 'node:fs';
import readline from 'node:readline';
const mode = process.argv[2];
const counter = 'starts.json';
const attempt = fs.existsSync(counter) ? JSON.parse(fs.readFileSync(counter)) : 0;
fs.writeFileSync(counter, JSON.stringify(attempt + 1));
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const reply = (id,result) => send({id,result});
const sid = 'saved-review-1';
let prompt;
readline.createInterface({input:process.stdin}).on('line', line => {
 const msg=JSON.parse(line);
 fs.appendFileSync('methods.txt',msg.method+'\\n');
 if(msg.method==='initialize') reply(msg.id,{protocolVersion:1,agentCapabilities:{loadSession:mode!=='no-load'}});
 else if(msg.method==='session/new') reply(msg.id,{sessionId:sid,configOptions:[{id:'model',category:'model',currentValue:'fixture-model'}]});
 else if(msg.method==='session/load') { if(msg.params.sessionId!==sid)process.exit(9); reply(msg.id,{}); }
 else if(msg.method==='session/cancel') { if(prompt)reply(prompt.id,{stopReason:'cancelled'}); }
 else if(msg.method==='session/prompt') {
   prompt=msg;
   if(mode==='disconnect' && attempt===0) {process.exit(3);return;}
   if(mode==='policy') {send({id:msg.id,error:{code:-32000,message:'This content was flagged for possible cybersecurity risk. DO_NOT_ECHO_PAYLOAD'}});return;}
   if(mode==='quota') {send({id:msg.id,error:{code:-32000,message:'RESOURCE_EXHAUSTED DO_NOT_ECHO_PAYLOAD'}});return;}
   if(mode==='malformed') {process.stdout.write('not json\\n');return;}
   if(mode==='changed-model') {send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'config_option_update',configOptions:[{id:'model',category:'model',currentValue:'other-model'}]}}});return;}
   if(mode==='permission') {
     send({id:1000,method:'fs/read_text_file',params:{path:'/private/host-file'}});
     send({id:1001,method:'session/request_permission',params:{sessionId:sid,toolCall:{title:'mcp__audit_docker__read_file',kind:'execute',rawInput:{command:'host command'}},options:[{kind:'allow_once',optionId:'allow'},{kind:'reject_once',optionId:'reject'}]}});
     return;
   }
   if(mode==='refusal'||mode==='refusal-loop') {
     fs.appendFileSync('prompts.txt',JSON.stringify(msg.params.prompt[0].text)+'\\n');
     if(mode==='refusal-loop'||!fs.existsSync('refused.json')) {
       send({id:1002,method:'session/request_permission',params:{sessionId:sid,toolCall:{title:'audit_docker__use_tool',_meta:{'x.ai/tool':{version:1,name:'use_tool',kind:'use_tool'}},rawInput:{variant:'UseTool',tool_name:'audit_docker__use_tool',tool_input:{tool_name:'audit_docker__run_existing_tests',tool_input:{}}}},options:[{kind:'allow_once',optionId:'allow'},{kind:'reject_once',optionId:'reject'}]}});
       return;
     }
   }
   if(mode==='silent')return;
   send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:mode==='quoted-quota'?'Historical incident: You have hit your session limit; RESOURCE_EXHAUSTED. Remediation is documented.':'Acknowledged'}}}});
   reply(msg.id,{stopReason:'end_turn'});
   if(mode==='exit-error')process.exitCode=7;
 } else if(msg.id===1000)fs.writeFileSync('filesystem-denied.json',JSON.stringify(msg));
 else if(msg.id===1002){fs.writeFileSync('refused.json',JSON.stringify(msg));reply(prompt.id,{stopReason:'cancelled'});}
 else if(msg.id===1001){fs.writeFileSync('permission.json',JSON.stringify(msg));reply(prompt.id,{stopReason:'end_turn'});}
});
`;

function fixture(t, mode = 'success') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-session-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'fixture.mjs');
  fs.writeFileSync(executable, fixtureScript);
  const options = { directory: path.join(root, 'session'), identity, bridgeArgs: [], prompt: 'Inert session fixture' };
  const support = {
    heartbeatMs: 30,
    preflight: async () => ({ state: 'ready', tools: ['read_file', 'submit_audit_report'] }),
    launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, mode], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }),
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(options.directory, 'state.json')));
  return { root, options, support, state, workspace: path.join(options.directory, 'workspace') };
}

test('a pass that never submits gets one correction and then a budget cancel', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'fixture.mjs');
  fs.writeFileSync(executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const mode = process.argv[2];
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'budget-session';
let prompts = 0;
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid}});
  else if (msg.method === 'session/cancel') fs.appendFileSync('events.txt', 'cancel\\n');
  else if (msg.method === 'session/prompt') {
    prompts += 1;
    fs.appendFileSync('prompts.txt', msg.params.prompt[0].text + '\\n');
    if (prompts === 1) {
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'a',title:'read_file'}}});
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'b',title:'read_file'}}});
    } else if (mode === 'submit') {
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'c',title:'submit_audit_report'}}});
    }
    send({id:msg.id,result:{stopReason:'end_turn'}});
  }
});
`);
  const support = {
    heartbeatMs: 30_000,
    preflight: async () => ({ state: 'ready', tools: ['read_file', 'submit_audit_report'] }),
    launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, 'ignore'], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }),
  };
  const options = { directory: path.join(root, 'session'), identity, bridgeArgs: [], prompt: 'Review the surface.', budgets: { toolBudget: 2, passes: 1, maxCostUsd: null } };
  const ignored = await runReviewSession(options, support);
  assert.equal(ignored.stop, 'budget');
  const prompts = fs.readFileSync(path.join(root, 'session', 'workspace', 'prompts.txt'), 'utf8').trim().split('\n');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Call submit_audit_report now/);
  assert.match(fs.readFileSync(path.join(root, 'session', 'workspace', 'events.txt'), 'utf8'), /cancel/);
  const submitting = {
    ...support,
    launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, 'submit'], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }),
  };
  const handedIn = await runReviewSession({ ...options, directory: path.join(root, 'session-2') }, submitting);
  assert.equal(handedIn.code, 0);
  assert.equal(handedIn.stop, 'submitted');
});

test('debate, judge and general-review sessions are forced to their own role\'s submit, not a review submit', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-role-submit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'fixture.mjs');
  fs.writeFileSync(executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const submit = process.argv[2];
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'role-session';
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid}});
  else if (msg.method === 'session/prompt') {
    fs.appendFileSync('prompts.txt', JSON.stringify(msg.params.prompt[0].text) + '\\n');
    send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'s',title:submit}}});
    send({id:msg.id,result:{stopReason:'end_turn'}});
  }
});
`);
  const run = (role, name, submit, dir) => runReviewSession(
    { directory: path.join(root, dir), identity: { ...identity, role, name, surface: undefined }, bridgeArgs: [], prompt: 'Debate.', budgets: { toolBudget: 4, passes: 1, maxCostUsd: null } },
    { heartbeatMs: 30_000, preflight: async () => ({ state: 'ready', tools: [] }), launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, submit], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }) },
  );
  const cases = [
    ['debater', 'claude-debate-cluster-1-r1', 'submit_debate_turn'],
    ['orchestrator', 'claude-judge-cluster-1', 'submit_adjudication'],
    ['orchestrator', 'claude-general-review', 'submit_general_review'],
  ];
  for (const [role, name, own] of cases) {
    assert.equal((await run(role, name, own, `${name}-own`)).stop, 'submitted', `${name} submitting ${own}`);
    const reviewSubmit = await run(role, name, 'submit_audit_report', `${name}-review`);
    assert.equal(reviewSubmit.stop, 'budget', `${name}: a review submit does not hand in a ${role} assignment`);
    const prompts = fs.readFileSync(path.join(root, `${name}-review`, 'workspace', 'prompts.txt'), 'utf8').trim().split('\n');
    assert.match(prompts[1], new RegExp(`Call ${own} now`), name);
  }
});

test('the bridge preflight accepts the debater and orchestrator tool sets, which have no test runs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-mcp-preflight-roles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = new URL('./docker-mcp-bridge.mjs', import.meta.url).pathname;
  const server = (role) => ({ command: process.execPath, args: [bridge, '--report-dir', root, '--role', role, '--agent', 'claude'] });
  const debater = await preflightBridge(server('debater'), { cwd: root, env: process.env, expectedRole: 'debater', expectedName: 'claude-debate-cluster-1-r1' });
  assert.ok(debater.tools.includes('submit_debate_turn') && !debater.tools.includes('run_existing_tests'));
  for (const name of ['claude-judge-cluster-1', 'claude-general-review']) {
    assert.equal((await preflightBridge(server('orchestrator'), { cwd: root, env: process.env, expectedRole: 'orchestrator', expectedName: name })).state, 'ready', name);
  }
  await assert.rejects(preflightBridge(server('debater'), { cwd: root, env: process.env, expectedRole: 'orchestrator', expectedName: 'claude-judge-cluster-1' }), /mcp_unavailable/);
});

test('W04-07: more than N+3 counted tool calls without a submit cancels the pass; the correction names the role\'s submit tool', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-flood-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'flood.mjs');
  fs.writeFileSync(executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'flood-session';
const [mode, calls] = [process.argv[2], Number(process.argv[3])];
let pending;
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid}});
  else if (msg.method === 'session/cancel') { fs.appendFileSync('events.txt', 'cancel\\n'); if (pending) send({id:pending,result:{stopReason:'cancelled'}}); pending = null; }
  else if (msg.method === 'session/prompt') {
    fs.appendFileSync('prompts.txt', JSON.stringify(msg.params.prompt[0].text) + '\\n');
    pending = msg.id;
    if (mode === 'flood') { for (let i = 0; i < calls; i++) send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'t'+i,title:'read_file'}}}); return; }
    send({id:msg.id,result:{stopReason:'end_turn'}}); pending = null;
  }
});
`);
  const run = (mode, calls, role, dir) => runReviewSession(
    { directory: path.join(root, dir), identity: { ...identity, role, name: role === 'crosscheck' ? 'crosscheck-claude' : identity.name }, bridgeArgs: [], prompt: 'Review.', budgets: { toolBudget: 2, passes: 1, maxCostUsd: null } },
    { heartbeatMs: 30_000, preflight: async () => ({ state: 'ready', tools: [] }), launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, mode, String(calls)], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }) },
  );
  const flooded = await run('flood', 6, 'auditor', 'flood');
  assert.equal(flooded.code, 0);
  assert.equal(flooded.stop, 'budget');
  assert.equal(fs.readFileSync(path.join(root, 'flood', 'workspace', 'prompts.txt'), 'utf8').trim().split('\n').length, 1, 'no correction turn after a budget cancel');
  assert.match(fs.readFileSync(path.join(root, 'flood', 'workspace', 'events.txt'), 'utf8'), /cancel/);
  const quiet = await run('quiet', 0, 'crosscheck', 'quiet');
  assert.equal(quiet.stop, 'budget');
  const prompts = fs.readFileSync(path.join(root, 'quiet', 'workspace', 'prompts.txt'), 'utf8').trim().split('\n');
  assert.match(prompts[1], /Call submit_crosscheck_report now/);
  assert.doesNotMatch(prompts[1], /Budget exhausted/);
});

test('with a bridge ledger the pass is cancelled on the bridge\'s count, not on the calls the agent announces', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'ledger.mjs');
  // Announces <calls> read calls in one batch; then "submit" hands in, "end" ends the turn, "wait" stays in the turn.
  fs.writeFileSync(executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'ledger-session';
const [mode, calls] = [process.argv[2], Number(process.argv[3])];
let pending;
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid}});
  else if (msg.method === 'session/cancel') { fs.appendFileSync('events.txt', 'cancel\\n'); if (pending) send({id:pending,result:{stopReason:'cancelled'}}); pending = null; }
  else if (msg.method === 'session/prompt') {
    fs.appendFileSync('prompts.txt', JSON.stringify(msg.params.prompt[0].text) + '\\n');
    pending = msg.id;
    for (let i = 0; i < calls; i++) send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'t'+i,title:i % 2 ? 'read_file' : 'call_mcp_tool'}}});
    if (mode === 'wait') return;
    // The turn stays open long enough for a cancel to land before it hands in.
    setTimeout(() => {
      if (!pending) return;
      if (mode === 'submit') send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'s',title:'submit_audit_report'}}});
      send({id:pending,result:{stopReason:'end_turn'}}); pending = null;
    }, 200);
  }
});
`);
  // toolBudget 2: the bridge serves 2 calls, answers 3 with "submit now", then refuses and marks the pass exhausted.
  const run = (mode, calls, record, dir) => {
    const reportDir = path.join(root, `${dir}-report`);
    fs.mkdirSync(path.join(reportDir, 'harness'), { recursive: true });
    if (record) fs.writeFileSync(path.join(reportDir, 'harness', 'budget-claude.json'), JSON.stringify({ version: 1, reviewer: 'claude', passes: { 's1:1': record }, spentUsd: 0 }));
    return runReviewSession(
      { directory: path.join(root, dir), identity, bridgeArgs: ['--report-dir', reportDir, '--role', 'auditor', '--agent', 'claude', '--surface', 'S1', '--pass', '1', '--tool-budget', '2'], prompt: 'Review.', budgets: { toolBudget: 2, passes: 1, maxCostUsd: null } },
      { heartbeatMs: 30_000, preflight: async () => ({ state: 'ready', tools: [] }), launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable, mode, String(calls)], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }) },
    );
  };
  const events = dir => { try { return fs.readFileSync(path.join(root, dir, 'workspace', 'events.txt'), 'utf8'); } catch { return ''; } };
  const prompts = dir => fs.readFileSync(path.join(root, dir, 'workspace', 'prompts.txt'), 'utf8').trim().split('\n');

  // Nine announced calls are more than N+3, but the bridge served 2 and never said "submit now": an agent's own
  // tools and a parallel batch still in flight are not the pass's count.
  const batch = await run('submit', 9, { calls: 2, graceUsed: 0, filesRead: [], finalizeOnlyAt: null }, 'batch');
  assert.equal(batch.code, 0);
  assert.equal(batch.stop, 'submitted');
  assert.equal(events('batch'), '', 'a pass the bridge has not exhausted is not cancelled');
  const noCalls = await run('submit', 9, null, 'no-record');
  assert.equal(noCalls.stop, 'submitted', 'no bridge record yet means no bridge call was refused');

  // The bridge refused a call past the grace. Up to 3 further announced calls are the rest of that batch.
  const exhausted = { calls: 2, graceUsed: 3, filesRead: [], finalizeOnlyAt: '2026-01-01T00:00:00.000Z', exhausted: true, exhaustedAt: '2026-01-01T00:00:01.000Z' };
  const tail = await run('end', 3, exhausted, 'tail');
  assert.equal(tail.stop, 'budget');
  assert.equal(prompts('tail').length, 2, 'the rest of a batch is tolerated, so the pass still gets its one correction');
  assert.match(prompts('tail')[1], /Call submit_audit_report now/);
  const ignored = await run('wait', 4, exhausted, 'ignored');
  assert.equal(ignored.code, 0);
  assert.equal(ignored.stop, 'budget');
  assert.match(events('ignored'), /cancel/);
  assert.equal(prompts('ignored').length, 1, 'no correction turn after a budget cancel');

  // Calls the bridge never counted are bounded too: twice the allowance (N+3 = 5).
  const unseen = await run('wait', 11, { calls: 0, graceUsed: 0, filesRead: [], finalizeOnlyAt: null }, 'unseen');
  assert.equal(unseen.stop, 'budget');
  assert.match(events('unseen'), /cancel/);
  const within = await run('submit', 10, { calls: 0, graceUsed: 0, filesRead: [], finalizeOnlyAt: null }, 'within');
  assert.equal(within.stop, 'submitted');
  assert.equal(events('within'), '');

  // Debate and judge sessions have no pass ledger: the announced calls stay their only count.
  for (const role of ['debater', 'orchestrator', 'verification']) assert.equal(passLedger({ bridgeArgs: ['--report-dir', root, '--role', role, '--agent', 'claude', '--pass', '1'] }), null, role);
  assert.equal(passLedger({ bridgeArgs: ['--report-dir', root, '--role', 'auditor'] }), null, 'no reviewer, no ledger');
  assert.equal(passLedger({ bridgeArgs: [] }), null);
  // A cross-check is launched without --pass; the bridge counts it as pass 1 under its own key.
  const crossDir = path.join(root, 'cross-report');
  fs.mkdirSync(path.join(crossDir, 'harness'), { recursive: true });
  fs.writeFileSync(path.join(crossDir, 'harness', 'budget-claude.json'), JSON.stringify({ version: 1, reviewer: 'claude', passes: { 'crosscheck:1': { calls: 7 }, 's4:2': { calls: 9 } }, spentUsd: 0 }));
  assert.equal(passLedger({ bridgeArgs: ['--report-dir', crossDir, '--role', 'crosscheck', '--agent', 'claude', '--tool-budget', '60', '--surface', 'ALL'] })().calls, 7);
  assert.equal(passLedger({ bridgeArgs: ['--report-dir', crossDir, '--role', 'auditor', '--agent', 'claude', '--pass', '2', '--auditor', 'claude-s4-config', '--surface', 'S4'] })().calls, 9);
});

test('ACP session records completion and can load the exact saved conversation', async t => {
  const f = fixture(t);
  const first = await runReviewSession(f.options, f.support);
  assert.equal(first.code, 0);
  assert.equal(first.sessionId, 'saved-review-1');
  assert.equal(first.observedExitCode, 0);
  assert.equal(f.state().phase, 'completed');
  const second = await runReviewSession({ ...f.options, resume: true }, f.support);
  assert.equal(second.code, 0);
  assert.match(fs.readFileSync(path.join(f.workspace, 'methods.txt'), 'utf8'), /session\/load/);
});

test('successful turns cannot be reclassified by quoted historical quota or refusal text', async t => {
  const f = fixture(t, 'quoted-quota');
  const first = await runReviewSession(f.options, f.support);
  assert.equal(first.code, 0);
  const second = await runReviewSession({ ...f.options, resume: true }, f.support);
  assert.equal(second.code, 0);
  assert.equal(f.state().phase, 'completed');
});

test('silent reasoning survives repeated heartbeats and explicit cancellation retains the session', async t => {
  const f = fixture(t, 'silent');
  const controller = new AbortController();
  const heartbeats = [];
  const result = await runReviewSession({ ...f.options, signal: controller.signal, onProgress: event => {
    heartbeats.push(event);
    if (heartbeats.filter(e => e.phase === 'running').length >= 4) controller.abort();
  } }, f.support);
  assert.equal(result.code, 130);
  assert.equal(result.failureReason, 'cancelled');
  assert.ok(heartbeats.length >= 4);
  assert.ok(heartbeats.every(beat => beat.timeLimitMs === null));
  assert.equal(f.state().sessionId, 'saved-review-1');
  assert.equal(f.state().phase, 'cancelled');
  const controller2 = new AbortController();
  let beats = 0;
  const budgetedCancel = await runReviewSession({
    ...f.options, directory: path.join(f.root, 'session-budget-cancel'),
    budgets: { toolBudget: 5, passes: 2, maxCostUsd: null },
    signal: controller2.signal,
    onProgress: event => { if (event.phase === 'running' && ++beats >= 2) controller2.abort(); },
  }, f.support);
  assert.equal(budgetedCancel.code, 130, 'external signal abort with budgets must return 130 cancelled, not 0 budget');
  assert.equal(budgetedCancel.failureReason, 'cancelled');
});

test('a lost transport resumes once using the same identity without provider substitution', async t => {
  const f = fixture(t, 'disconnect');
  const result = await runReviewSession(f.options, f.support);
  assert.equal(result.code, 0);
  assert.equal(result.recoveryAttempts, 1);
  assert.equal(f.state().recoveryAttempts, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'starts.json'))), 2);
  assert.match(fs.readFileSync(path.join(f.workspace, 'methods.txt'), 'utf8'), /session\/load/);
});

test('provider policy and quota failures never trigger retries or expose raw error payloads', async t => {
  for (const [mode, reason] of [['policy', 'provider_policy'], ['quota', 'usage_limit']]) {
    const f = fixture(t, mode);
    const result = await runReviewSession(f.options, f.support);
    assert.equal(result.code, 1);
    assert.equal(result.failureReason, reason);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'starts.json'))), 1);
    assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO'));
    assert.ok(!JSON.stringify(f.state()).includes('DO_NOT_ECHO'));
  }
});

test('wrong source, model or assignment cannot start a saved conversation', async t => {
  const f = fixture(t);
  await runReviewSession(f.options, f.support);
  for (const patch of [{ sourceDigest: 'c'.repeat(64) }, { model: 'different-model' }, { assignmentDigest: 'd'.repeat(64) }, { agent: 'grok' }]) {
    await assert.rejects(runReviewSession({ ...f.options, identity: { ...identity, ...patch } }, f.support), /session_identity_rejected/);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'starts.json'))), 1);
});

test('missing resume capability, malformed frames, changed models and nonzero exits remain failures', async t => {
  for (const [mode, reason] of [['malformed', 'protocol_error'], ['changed-model', 'model_changed'], ['exit-error', 'process_error']]) {
    const f = fixture(t, mode);
    const result = await runReviewSession(f.options, f.support);
    assert.equal(result.code, 1, mode);
    assert.equal(result.failureReason, reason, mode);
  }
  const f = fixture(t, 'no-load');
  const store = openSessionStore(f.options.directory, identity);
  store.save('interrupted', { sessionId: 'saved-review-1' });
  const result = await runReviewSession(f.options, f.support);
  assert.equal(result.failureReason, 'resume_unsupported');
  assert.ok(!fs.readFileSync(path.join(f.workspace, 'methods.txt'), 'utf8').includes('session/prompt'));
});

test('ACP client denies host filesystem requests and permission-title spoofing', async t => {
  const f = fixture(t, 'permission');
  const result = await runReviewSession(f.options, f.support);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'filesystem-denied.json'))).error.code, -32601);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'permission.json'))).result.outcome.optionId, 'reject');
  const options = [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }];
  assert.equal(permissionDecision({ sessionId: 'own', options, toolCall: { _meta: { is_mcp_tool_call: true }, rawInput: { server: 'audit_docker', tool: 'read_file' } } }, 'own').outcome.optionId, 'allow');
  const grokCall = { _meta: { 'x.ai/tool': { version: 1, name: 'use_tool', kind: 'use_tool' } }, rawInput: { variant: 'UseTool', tool_name: 'audit_docker__read_file' } };
  assert.equal(permissionDecision({ sessionId: 'own', options, toolCall: grokCall }, 'own').outcome.optionId, 'allow');
  assert.equal(permissionDecision({ sessionId: 'own', options, toolCall: { ...grokCall, rawInput: { variant: 'UseTool', tool_name: 'other__read_file' } } }, 'own').outcome.optionId, 'reject');
  assert.equal(permissionDecision({ sessionId: 'other', options, toolCall: { _meta: { claudeCode: { toolName: 'mcp__audit_docker__read_file' } } } }, 'own').outcome.outcome, 'cancelled');
});

test('a turn the agent cancels after a refused tool call continues in the same session', async t => {
  const f = fixture(t, 'refusal');
  const result = await runReviewSession(f.options, f.support);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'refused.json'))).result.outcome.optionId, 'reject');
  const prompts = fs.readFileSync(path.join(f.workspace, 'prompts.txt'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /refused your tool call audit_docker__use_tool/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace, 'starts.json'))), 1);
  assert.ok(f.state().events.some(event => event.event === 'refusal_corrected'));
});

test('repeated refusal-induced cancellation fails as a permission error, not a user cancel', async t => {
  const f = fixture(t, 'refusal-loop');
  const result = await runReviewSession(f.options, f.support);
  assert.equal(result.code, 1);
  assert.equal(result.failureReason, 'permission_denied');
  assert.equal(fs.readFileSync(path.join(f.workspace, 'prompts.txt'), 'utf8').trim().split('\n').length, 4);
});

test('subscription environments omit credential and routing overrides', () => {
  const env = sessionEnvironment({ HOME: '/home/inert', PATH: '/bin', OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', NODE_OPTIONS: '--require bad.js', HTTPS_PROXY: 'https://untrusted', MODEL_PROVIDER: 'unapproved' });
  assert.deepEqual(env, { HOME: '/home/inert', PATH: '/bin' });
});

test('a model alias matches its full id, and a new pass is told to submit', () => {
  assert.equal(modelMatches('opus', 'claude-opus-5-5'), true);
  assert.equal(modelMatches('opus', 'claude-sonnet-5-5'), false);
  assert.equal(modelMatches('gpt-6.1-sol', 'gpt-6.1-sol'), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-continuation-'));
  const options = { bridgeArgs: ['--report-dir', root], identity: { name: 'claude-s1-auth' } };
  assert.match(continuationText(options), /no committed report yet/);
  fs.mkdirSync(path.join(root, 'submissions'));
  fs.writeFileSync(path.join(root, 'submissions', 'claude-s1-auth.json'), '{}\n');
  assert.match(continuationText(options), /already committed/);
});

test('bridge preflight verifies real MCP inventory without inference or target execution', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-mcp-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = { command: process.execPath, args: [new URL('./docker-mcp-bridge.mjs', import.meta.url).pathname, '--report-dir', root, '--role', 'auditor', '--auditor', 'claude-s1-auth', '--agent', 'claude'] };
  const result = await preflightBridge(server, { cwd: root, env: process.env, expectedRole: 'auditor' });
  assert.equal(result.state, 'ready');
  assert.ok(result.tools.includes('submit_audit_report'));
  await assert.rejects(preflightBridge(server, { cwd: root, env: process.env, expectedRole: 'crosscheck' }), /mcp_unavailable/);
  assert.equal(fs.existsSync(path.join(root, 'auditors')), false);
});

test('session directories reject symlinks and unsafe permissions before launching an agent', t => {
  const f = fixture(t);
  const real = path.join(f.root, 'real'); fs.mkdirSync(real, { mode: 0o700 });
  fs.symlinkSync(real, f.options.directory);
  assert.throws(() => openSessionStore(f.options.directory, identity), /session_directory_rejected/);
});

test('SearchTool is not counted against toolBudget, tool_call_update detects submits, and session/load re-pins a drifted default model', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-session-quirks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'quirks.mjs');
  fs.writeFileSync(executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'quirk-session';
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  fs.appendFileSync('methods.txt', msg.method + '\\n');
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid,configOptions:[{id:'model',category:'model',currentValue:'opus'}]}});\n  else if (msg.method === 'session/load') send({id:msg.id,result:{configOptions:[{id:'model',category:'model',currentValue:'sonnet',options:[{value:'sonnet'},{value:'opus'}]}]}});
  else if (msg.method === 'session/set_config_option') send({id:msg.id,result:{configOptions:[{id:'model',category:'model',currentValue:msg.params.value}]}});
  else if (msg.method === 'session/prompt') {
    for (let i = 0; i < 6; i++) {
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'s'+i,title:'search_tool',rawInput:{query:'submit_audit_report',limit:8},_meta:{'x.ai/tool':{version:1,name:'search_tool',kind:'search_tool'}}}}});
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call_update',toolCallId:'s'+i,title:'Search tools: select:audit_docker__submit_audit_report',rawInput:{variant:'SearchTool'}}}});
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call_update',toolCallId:'s'+i,status:'completed',content:[]}}});
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'sr'+i,status:'completed',rawOutput:{type:'SearchTool',result_count:8}}}});
    }
    send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call',toolCallId:'u1',title:'use_tool'}}});
    send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call_update',toolCallId:'u1',title:'use_tool',rawInput:{tool_name:'audit_docker__submit_audit_report'}}}});
    send({id:msg.id,result:{stopReason:'end_turn'}});
  }
});
`);
  const opusIdentity = { ...identity, model: 'opus', provider: 'claude' };
  const support = {
    heartbeatMs: 30_000,
    preflight: async () => ({ state: 'ready', tools: ['read_file', 'submit_audit_report'] }),
    launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [executable], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }),
  };
  const baseOpts = { directory: path.join(root, 'session'), identity: opusIdentity, bridgeArgs: [], prompt: 'Review.', budgets: { toolBudget: 2, passes: 2, maxCostUsd: null } };
  const pass1 = await runReviewSession(baseOpts, support);
  assert.equal(pass1.code, 0);
  assert.equal(pass1.stop, 'submitted');
  const pass2 = await runReviewSession({ ...baseOpts, resume: true }, support);
  assert.equal(pass2.code, 0);
  assert.equal(pass2.stop, 'submitted');
  const methods = fs.readFileSync(path.join(root, 'session', 'workspace', 'methods.txt'), 'utf8');
  assert.match(methods, /session\/set_config_option/);
  assert.doesNotMatch(methods, /session\/cancel/);

  // AGY emits tool_call_update with title: "call_mcp_tool" and no tool_name; once submissions/<name>.json is on disk,
  // extra calls past toolBudget + GRACE must not budget-cancel the turn.
  const agyExec = path.join(root, 'agy-fixture.mjs');
  fs.writeFileSync(agyExec, `
import readline from 'node:readline';
const send = msg => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\\n');
const sid = 'agy-session';
readline.createInterface({input:process.stdin}).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({id:msg.id,result:{protocolVersion:1,agentCapabilities:{loadSession:false}}});
  else if (msg.method === 'session/new') send({id:msg.id,result:{sessionId:sid}});
  else if (msg.method === 'session/cancel') send({id:1,result:{stopReason:'cancelled'}});
  else if (msg.method === 'session/prompt') {
    for (let i = 0; i < 8; i++) {
      send({method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'tool_call_update',toolCallId:'c'+i,title:'call_mcp_tool',status:'completed'}}});
    }
    send({id:msg.id,result:{stopReason:'end_turn'}});
  }
});
`);
  fs.mkdirSync(path.join(root, 'submissions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'submissions', `${identity.name}.json`), '{"ok":true}\n');
  const agyResult = await runReviewSession(
    { directory: path.join(root, 'session-agy'), identity, bridgeArgs: ['--report-dir', root], prompt: 'Review.', budgets: { toolBudget: 2, passes: 1, maxCostUsd: null } },
    { ...support, launch: ({ workDir }) => ({ invocation: { executable: process.execPath, args: [agyExec], cwd: workDir, env: process.env }, mcpServers: [{}], transport: 'inert_acp_fixture' }) },
  );
  assert.equal(agyResult.code, 0);
  assert.equal(agyResult.stop, 'submitted');
});
