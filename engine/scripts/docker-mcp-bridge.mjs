#!/usr/bin/env node
/**
 * docker-mcp-bridge.mjs
 *
 * Model Context Protocol (MCP) stdio bridge between one reviewer session (any family: cli, key,
 * openrouter, scripted) and the one-shot Docker audit container.
 *
 * Reviewers get the role's fixed tools only: read-only browsing and search of the sealed source,
 * catalogued existing tests (rebuilt by the runner, no caller commands), and the role's submit tool.
 * Reads and test runs happen inside the container (`docker exec --user 10001:10001`); there is no
 * arbitrary command execution, exploit or PoC tool. Submissions are committed to the host report dir.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { validateSubmissionIdentity } from './audit-submission.mjs';
import { REVIEW_TOOLS } from './review-workflow.mjs';
import { bridgeRole } from './bridge-tools-registry.mjs';
import { BridgeError, scrubProviderEnv } from './bridge-tools-common.mjs';
import { attachBudget } from './bridge-budget.mjs';

// Helpers that lived here before the per-role split stay importable from this module.
export { boundedCapture, execInContainer, normalizeCitation } from './bridge-tools-common.mjs';
export { renderMarkdownFromFindings, normalizeFindingsPayload } from './bridge-tools-auditor.mjs';
export { normalizeCrosscheckPayload } from './bridge-tools-crosscheck.mjs';

export function resolveDockerBin(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const c of ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/usr/bin/docker']) {
    if (fs.existsSync(c)) return c;
  }
  const r = spawnSync('which', ['docker'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : 'docker';
}

export function parseBridgeArgs(argv) {
  const opts = {
    dockerBin: '',
    container: process.env.AUDIT_CONTAINER || '',
    reportDir: process.env.AUDIT_REPORT_DIR || '',
    role: process.env.AUDIT_ROLE || 'auditor',
    auditor: process.env.SECURITY_AUDITOR || '',
    agent: process.env.AUDIT_AGENT || '',
    surface: (process.env.AUDIT_SURFACE || 'S1').toUpperCase(),
    identityFile: '',
    reviewersFile: '',
    demoHost: '',
    pass: 1,
    toolBudget: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--docker-bin') opts.dockerBin = argv[++i] || '';
    else if (a === '--container') opts.container = argv[++i] || '';
    else if (a === '--report-dir') opts.reportDir = argv[++i] || '';
    else if (a === '--role') opts.role = argv[++i] || 'auditor';
    else if (a === '--auditor') opts.auditor = argv[++i] || '';
    else if (a === '--agent') opts.agent = argv[++i] || '';
    else if (a === '--surface') opts.surface = (argv[++i] || 'S1').toUpperCase();
    else if (a === '--identity-file') opts.identityFile = argv[++i] || '';
    else if (a === '--reviewers-file') opts.reviewersFile = argv[++i] || '';
    else if (a === '--demo-host') opts.demoHost = argv[++i] || '';
    else if (a === '--pass') opts.pass = Number(argv[++i]) || 1;
    else if (a === '--tool-budget') opts.toolBudget = Number(argv[++i]) || 0;
  }
  if (opts.demoHost) {
    const bundled = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-fixture'));
    let root;
    try { root = fs.realpathSync(opts.demoHost); } catch { throw new Error('demo-host serves only the bundled fixture'); }
    if (root !== bundled) throw new Error('demo-host serves only the bundled fixture');
    opts.demoHost = root;
  }
  opts.dockerBin = resolveDockerBin(opts.dockerBin);
  // Reviewer ids come from harness/reviewers.json (written by the orchestrator), not from a list in this file.
  // A bridge that carries a submission identity always checks it: without --reviewers-file the run's own
  // harness/reviewers.json is used, and a missing or unreadable list refuses to start (fail closed).
  if (opts.identityFile && !opts.reviewersFile && opts.reportDir) opts.reviewersFile = path.join(opts.reportDir, 'harness', 'reviewers.json');
  if (opts.reviewersFile) opts.reviewerIds = loadReviewerIds(opts);
  if (opts.agent && opts.reviewerIds && !opts.reviewerIds.has(opts.agent)) throw new BridgeError('IDENTITY_UNKNOWN', `Reviewer ${String(opts.agent).slice(0, 80)} is not in this run's reviewers file`);
  if (opts.identityFile) {
    const rel = path.relative(opts.reportDir, opts.identityFile);
    opts.submissionIdentity = readReportJson(opts.reportDir, rel);
    // A cross-check is named by its reviewer; auditor, debater and orchestrator sessions by --auditor.
    const name = opts.role === 'crosscheck' ? `crosscheck-${opts.agent}` : opts.auditor;
    validateSubmissionIdentity(opts.submissionIdentity, name);
    if (opts.submissionIdentity.agent !== opts.agent || opts.submissionIdentity.role !== opts.role) throw new Error('Bridge submission identity mismatch');
    if (!opts.reviewerIds?.has(opts.submissionIdentity.agent)) throw new BridgeError('IDENTITY_UNKNOWN', `Submission identity names reviewer ${String(opts.submissionIdentity.agent).slice(0, 80)}, which is not in this run's reviewers file`);
  }
  return opts;
}

// The orchestrator role may also be one of the run's judges (the orchestrator or the alternate judge), which
// need not review a surface. Every other role must be a listed reviewer.
function loadReviewerIds({ reportDir, reviewersFile, role }) {
  let listed;
  try { listed = readReportJson(reportDir, path.relative(reportDir, reviewersFile)); }
  catch { throw new BridgeError('IDENTITY_UNKNOWN', 'This run has no readable reviewers file inside the report directory, so reviewer identity cannot be checked'); }
  if (!Array.isArray(listed?.reviewers)) throw new BridgeError('IDENTITY_UNKNOWN', 'Reviewers file has no reviewers list');
  const judges = role === 'orchestrator' && Array.isArray(listed.judges) ? listed.judges : [];
  return new Set([...listed.reviewers, ...judges].map(reviewer => reviewer?.id).filter(id => typeof id === 'string'));
}

// The tool list for a role comes from bridge-tools-<role>.mjs.
export function toolDefinitions(role = 'auditor') {
  return bridgeRole(role).toolDefinitions();
}

export async function callBridgeTool(ctx, name, args = {}) {
  const { reportDir } = ctx;
  if (!REVIEW_TOOLS.has(name)) throw new Error('Tool unavailable in source security review: ' + name);
  const handler = bridgeRole(ctx.role).handlers[name];
  if (typeof handler !== 'function') throw new Error(`Tool ${name} is unavailable in the ${ctx.role || 'auditor'} bridge role`);
  // Single hook for budget counters and per-role gates (W04, W06). It runs before any tool side effect.
  if (typeof ctx.beforeCall === 'function') {
    ctx.pendingArgs = args;
    const verdict = await ctx.beforeCall(ctx, name);
    if (verdict?.text) return verdict.text;
  }

  if (ctx.submissionIdentity) {
    const file = `harness/bridge-${ctx.submissionIdentity.name}.json`;
    let events = [];
    try { events = readReportJson(reportDir, file); } catch { /* first tool call */ }
    writeReportFile(reportDir, file, JSON.stringify([...events, { tool: name, at: new Date().toISOString() }].slice(-200)));
  }
  if (['submit_audit_report', 'submit_crosscheck_report'].includes(name) && Object.hasOwn(args, 'report_json')) {
    if (Object.keys(args).length !== 1 || typeof args.report_json !== 'string' || Buffer.byteLength(args.report_json) > 2 * 1024 * 1024) throw new Error('Supply only report_json, containing the complete JSON report (maximum 2 MiB).');
    args = JSON.parse(args.report_json);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('report_json must encode a report object');
  }
  return handler(ctx, args);
}

export async function handleRpcMessage(ctx, msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null;

  try {
    if (method === 'initialize') {
      const clientVer = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: clientVer,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'audit-docker-bridge', version: '1.0.0' },
        },
      };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
    if (method === 'resources/templates/list') return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
    if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: toolDefinitions(ctx.role) } };
    if (method === 'tools/call') {
      try {
        const text = await callBridgeTool(ctx, params?.name, params?.arguments || {});
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text) }], isError: false } };
      } catch (toolErr) {
        const hint = ['submit_audit_report', 'submit_crosscheck_report'].includes(params?.name) ? ' If the CLI corrupts nested object arrays, send only report_json: a JSON-encoded string containing the complete report object with all required fields.' : '';
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Tool error: ${toolErr.message || String(toolErr)}${hint}` }], isError: true } };
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: err.message || 'Internal error' } };
  }
}

function startStdioServer(ctx) {
  let buffer = Buffer.alloc(0);
  let useContentLength = false;
  const send = (obj) => {
    if (!obj) return;
    const payload = JSON.stringify(obj);
    if (useContentLength) process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    else process.stdout.write(`${payload}\n`);
  };

  const processBuffer = async () => {
    while (buffer.length > 0) {
      const headerMatch = buffer.toString('utf8', 0, Math.min(buffer.length, 64)).match(/^Content-Length:\s*(\d+)\r?\n/i);
      if (headerMatch) {
        useContentLength = true;
        const sepIdx = buffer.indexOf('\r\n\r\n');
        const altSepIdx = buffer.indexOf('\n\n');
        const headerEnd = sepIdx !== -1 ? sepIdx + 4 : (altSepIdx !== -1 ? altSepIdx + 2 : -1);
        if (headerEnd === -1) break;
        const len = Number(headerMatch[1]);
        if (buffer.length < headerEnd + len) break;
        const body = buffer.subarray(headerEnd, headerEnd + len).toString('utf8');
        buffer = buffer.subarray(headerEnd + len);
        try { send(await handleRpcMessage(ctx, JSON.parse(body))); } catch {}
        continue;
      }
      const nlIdx = buffer.indexOf(0x0a);
      if (nlIdx === -1) break;
      const line = buffer.subarray(0, nlIdx).toString('utf8').trim();
      buffer = buffer.subarray(nlIdx + 1);
      if (!line) continue;
      try { send(await handleRpcMessage(ctx, JSON.parse(line))); } catch {}
    }
  };

  let chain = Promise.resolve();
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    chain = chain.then(processBuffer).catch(() => {});
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scrubProviderEnv();
  startStdioServer(attachBudget(parseBridgeArgs(process.argv.slice(2))));
}
