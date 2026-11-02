import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { testCounts, missingTestArtifact } from './scanner-evidence.mjs';
import { renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { citation, readReportJson, writeReportFile } from './report-contract.mjs';
import { REVIEW_WORKFLOW, REVIEW_SCOPE, selectExistingTest, EXISTING_TEST_RUNNER } from './review-workflow.mjs';
import { withExistingTestLock } from './existing-test-lock.mjs';
import { selectTestArtifacts } from './test-artifacts.mjs';

// Tools every role has, and the helpers role files share. Role files (bridge-tools-<role>.mjs) add their submit tool.
export const CONTAINER_ROOTS = ['/work/src', '/out/harness', '/out/crosscheck', '/out/auditors'];
// A refusal with a stable code at the front of the message, so a reviewer (and a test) can tell it from a malformed argument.
export class BridgeError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'BridgeError'; this.code = code; }
}
export const SAFE_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const objSchema = (properties, required = []) => ({
  type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false,
});
export const strProp = (description) => ({ type: 'string', ...(description ? { description } : {}) });
export const intProp = (description) => ({ type: 'integer', ...(description ? { description } : {}) });
export const boolProp = (description) => ({ type: 'boolean', ...(description ? { description } : {}) });
export const strArr = (description) => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) });

export function normalizeCitation(raw) {
  if (typeof raw !== 'string') throw new Error('Expected a file:line citation');
  let s = raw.trim().replace(/^\/work\/src\//, '').replace(/^\.\//, '');
  const m = s.match(/^([^:\n]+):([1-9]\d*)(?:-\d+)?$/);
  if (m) s = `${m[1]}:${m[2]}`;
  if (!citation(s)) throw new Error('Expected a relative file:line citation');
  return s;
}

export function resolveContainerPath(inputPath, defaultRoot = '/work/src') {
  const raw = String(inputPath || '').trim();
  if (!raw || raw === '.') return defaultRoot;
  const resolved = raw.startsWith('/') ? path.posix.normalize(raw) : path.posix.normalize(path.posix.join(defaultRoot, raw));
  if (!CONTAINER_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
    throw new Error(`Path outside allowed container directories: ${raw}`);
  }
  return resolved;
}

// With keepTail, an oversized stream keeps its first quarter and last three
// quarters: test runners print their summary last, so a head-only cap loses the counts.
export function boundedCapture(maxBytes, keepTail = false) {
  const headMax = keepTail ? Math.floor(maxBytes / 4) : maxBytes, tailMax = maxBytes - headMax;
  let head = Buffer.alloc(0), tail = Buffer.alloc(0), omitted = 0;
  return {
    push(chunk) {
      if (head.length < headMax) {
        const take = Math.min(headMax - head.length, chunk.length);
        head = Buffer.concat([head, chunk.subarray(0, take)]);
        chunk = chunk.subarray(take);
      }
      if (!chunk.length) return;
      if (!tailMax) { omitted += chunk.length; return; }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > tailMax) { omitted += tail.length - tailMax; tail = tail.subarray(tail.length - tailMax); }
    },
    get omitted() { return omitted; },
    text() { return head.toString('utf8') + (omitted && tailMax ? `\n[... ${omitted} bytes omitted ...]\n` : '') + tail.toString('utf8'); },
  };
}

const TEST_OUTPUT_BYTES = 2 * 1024 * 1024;
const TEST_RESPONSE_CHARS = 48 * 1024;

function clipForModel(text) {
  if (!text || text.length <= TEST_RESPONSE_CHARS) return text || '(empty)';
  const head = Math.floor(TEST_RESPONSE_CHARS / 4);
  return `${text.slice(0, head)}\n[... ${text.length - TEST_RESPONSE_CHARS} characters omitted; full output is retained as evidence ...]\n${text.slice(text.length - (TEST_RESPONSE_CHARS - head))}`;
}

function existingTestResponse(id, code, failureDetail, output, provenance) {
  return `Existing test ${id}; exit code: ${code}${provenance ? ` (${provenance})` : ''}${failureDetail ? `\n${failureDetail}` : ''}\nSTDOUT:\n${clipForModel(output.stdout)}\nSTDERR:\n${clipForModel(output.stderr)}`;
}

// Only a hash-matched coordinator run for the same suite and source is reused.
function recordedVerificationRun(reportDir, testId, sourceDigest) {
  try {
    const row = readReportJson(reportDir, 'harness/existing-test-results-verification.json').findLast(item => item?.testId === testId && item.sourceDigest === sourceDigest);
    if (!row || !Number.isSafeInteger(row.exitCode) || !/^harness\/existing-test-output-verification-\d+\.json$/.test(row.evidenceFile)) return null;
    const evidence = readReportJson(reportDir, row.evidenceFile, 40 * 1024 * 1024);
    if (crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex') !== row.evidenceHash || typeof evidence.stdout !== 'string' || typeof evidence.stderr !== 'string') return null;
    return { row, evidence };
  } catch { return null; }
}

export function execInContainer(dockerBin, container, args, { cwd = '/work/src', timeoutMs = 30_000, input = '', maxBytes = 64 * 1024, keepTail = false } = {}) {
  return new Promise((resolve) => {
    const dockerArgs = [
      'exec', '-i', '--user', '10001:10001', '-w', cwd,
      '-e', 'HOME=/home/sandbox', '-e', 'CARGO_HOME=/work/cargo', '-e', 'CARGO_TARGET_DIR=/work/target',
      '-e', 'PATH=/work/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
      container, ...args,
    ];
    const child = spawn(dockerBin, dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = boundedCapture(maxBytes, keepTail);
    const stderr = boundedCapture(maxBytes, keepTail);
    const done = (code, stderrText = stderr.text()) => resolve({ code, stdout: stdout.text(), stderr: stderrText, omittedBytes: stdout.omitted + stderr.omitted });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, Math.min(Math.max(1000, timeoutMs), 1_810_000));
    child.stdout.on('data', (c) => stdout.push(c));
    child.stderr.on('data', (c) => stderr.push(c));
    child.on('error', (err) => { clearTimeout(timer); done(127, err.message); });
    child.on('close', (code, sig) => { clearTimeout(timer); done(sig === 'SIGKILL' ? 124 : (code ?? 1)); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function commonToolDefinitions() {
  return [
    {
      name: 'get_audit_context',
      description: 'Read the audit scope, detected stacks (http, grpc, websockets, databases, crypto), skill guidance, harness lead summary, and (for crosscheck) assigned peer claims from the one-shot Docker container.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({}),
    },
    {
      name: 'get_review_plan',
      description: 'Read the source security review plan and codebase entry-point leads for a protocol or risk domain (http, grpc, websockets, databases, crypto, scopes_roles, bots_economy, api_dto_abuse, or all).',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        domain: strProp('Domain filter: http | grpc | websockets | databases | crypto | scopes_roles | bots_economy | api_dto_abuse | all (default: surface-relevant plans)'),
      }),
    },
    {
      name: 'list_files',
      description: 'List files inside the one-shot Docker container (/work/src, /out/harness, /out/crosscheck).',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({ path: strProp('Directory path (default: /work/src)'), max_depth: intProp('Max recursion depth (1..6, default 3)') }),
    },
    {
      name: 'read_file',
      description: 'Read a file with 1-based line numbers inside the one-shot Docker container (/work/src or /out/harness). Relative paths resolve under /work/src.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        path: strProp('Relative path under /work/src or absolute path under /out/harness'),
        start_line: intProp('1-based start line (default 1)'),
        end_line: intProp('1-based inclusive end line (default start_line + 200)'),
      }, ['path']),
    },
    {
      name: 'search_code',
      description: 'Search source files inside the one-shot Docker container (/work/src or /out/harness) by regex or literal string. Returns relative file:line citations.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        pattern: strProp('Regex or literal pattern to search for'),
        path: strProp('Directory or file inside container (default: /work/src)'),
        case_insensitive: boolProp('Case-insensitive search (default: false)'),
        max_results: intProp('Max matches (default 80, max 200)'),
      }, ['pattern']),
    },
    {
      name: 'list_existing_tests',
      description: 'List fixed test IDs discovered in the captured source before review. No commands or test code can be supplied.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({}),
    },
    {
      name: 'run_existing_tests',
      description: 'Run one catalogued existing test suite inside the verified network-disconnected Docker container. Dependencies must already be available; failures remain coverage gaps.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: objSchema({ test_id: strProp('An ID returned by list_existing_tests; no additional arguments are accepted') }, ['test_id']),
    },
  ];
}

export async function runCommonTool(ctx, name, args) {
  const { dockerBin, container, reportDir, role, auditor, agent, surface } = ctx;
  const readProfile = () => {
    try { return reportDir ? JSON.parse(fs.readFileSync(path.join(reportDir, 'harness', 'stack-profile.json'), 'utf8')) : undefined; } catch { return undefined; }
  };
  if (name === 'get_audit_context') {
    const parts = [
      '# Docker Security Review Context', REVIEW_SCOPE, `- Container: ${container}`, `- Role: ${role}`, `- Agent: ${agent || 'unknown'}`,
      `- Auditor ID: ${auditor || 'n/a'}`, `- Assigned Surface: ${surface}`, `- Target Source Root (in container): /work/src`,
      `- Harness Leads Root (in container): /out/harness`, '',
      renderSurfaceSkillGuidance(surface, readProfile()), '',
    ];
    if (reportDir && fs.existsSync(path.join(reportDir, 'harness', 'summary.md'))) {
      parts.push('## Harness Summary', fs.readFileSync(path.join(reportDir, 'harness', 'summary.md'), 'utf8'));
    }
    if (reportDir && fs.existsSync(path.join(reportDir, 'harness', 'stack-profile.json'))) {
      try {
        const profile = JSON.parse(fs.readFileSync(path.join(reportDir, 'harness', 'stack-profile.json'), 'utf8'));
        parts.push('## Surface Source Security Review Plans', renderReviewPlansMarkdown(profile, surface).slice(0, 12_000));
      } catch { /* ignore malformed profile */ }
    } else if (reportDir && fs.existsSync(path.join(reportDir, 'harness', 'review-plans.md'))) {
      parts.push('## Source Security Review Plans', fs.readFileSync(path.join(reportDir, 'harness', 'review-plans.md'), 'utf8').slice(0, 12_000));
    }
    for (const [file, title, absent, limit] of [['solana.md', 'Solana Leads', 'Solana surface absent', 6000], ['near.md', 'NEAR Leads', 'NEAR surface absent', 6000], ['python.md', 'Python Leads', 'Python surface absent', 6000], ['node.md', 'Node Leads', 'Node surface absent', 6000]]) {
      if (!reportDir || !fs.existsSync(path.join(reportDir, 'harness', file))) continue;
      const text = fs.readFileSync(path.join(reportDir, 'harness', file), 'utf8');
      if (!text.includes(absent)) parts.push(`## ${title}`, text.slice(0, limit));
    }
    if (role === 'crosscheck' && reportDir) {
      const inboxFile = path.join(reportDir, 'crosscheck', `${agent}.json`);
      if (fs.existsSync(inboxFile)) parts.push('## Assigned Peer Claims to Cross-Check', fs.readFileSync(inboxFile, 'utf8'));
    }
    return parts.join('\n');
  }

  if (name === 'get_review_plan') {
    const reqDomain = String(args.domain || '').trim().toLowerCase();
    if (reportDir && fs.existsSync(path.join(reportDir, 'harness', 'stack-profile.json'))) {
      const profile = JSON.parse(fs.readFileSync(path.join(reportDir, 'harness', 'stack-profile.json'), 'utf8'));
      if (reqDomain && reqDomain !== 'all') {
        const match = (profile.domains || []).find((d) => d.id === reqDomain);
        if (match) {
          return renderReviewPlansMarkdown({ ...profile, domains: [match] }, '');
        }
      }
      return renderReviewPlansMarkdown(profile, reqDomain === 'all' ? '' : surface);
    }
    if (reportDir && fs.existsSync(path.join(reportDir, 'harness', 'review-plans.md'))) {
      return fs.readFileSync(path.join(reportDir, 'harness', 'review-plans.md'), 'utf8');
    }
    return renderSurfaceSkillGuidance(surface, readProfile());
  }

  if (name === 'list_files') {
    const targetPath = resolveContainerPath(args.path || '/work/src');
    const maxDepth = Math.min(Math.max(Number(args.max_depth) || 3, 1), 6);
    const script = `
      const fs = require('node:fs'), path = require('node:path');
      const root = process.argv[1], maxDepth = Number(process.argv[2]);
      const skip = new Set(['node_modules', '.git', 'target', 'dist', '.cargo', 'coverage']);
      const out = [];
      (function walk(dir, depth) {
        if (depth > maxDepth || out.length >= 400) return;
        let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
          if (e.isSymbolicLink()) continue;
          const full = path.join(dir, e.name), rel = path.relative(root, full) || e.name;
          if (e.isDirectory()) { if (!skip.has(e.name)) { out.push(rel + '/'); walk(full, depth + 1); } }
          else if (e.isFile()) { let sz = 0; try { sz = fs.statSync(full).size; } catch {} out.push(rel + ' (' + sz + 'B)'); }
          if (out.length >= 400) break;
        }
      })(root, 1);
      process.stdout.write(out.join('\\n') || '(empty)');
    `;
    const res = await execInContainer(dockerBin, container, ['node', '-e', script, targetPath, String(maxDepth)]);
    if (res.code !== 0) throw new Error(res.stderr || `list_files exited with ${res.code}`);
    return `Files under ${targetPath}:\n${res.stdout}`;
  }

  if (name === 'read_file') {
    const targetPath = resolveContainerPath(args.path);
    const startLine = Math.max(1, Number(args.start_line) || 1);
    const endLine = Math.min(startLine + 399, Math.max(startLine, Number(args.end_line) || (startLine + 200)));
    const script = `
      const fs = require('node:fs');
      const file = process.argv[1], s = Number(process.argv[2]), e = Number(process.argv[3]);
      if (!fs.lstatSync(file).isFile()) throw new Error('Not a regular file: ' + file);
      const lines = fs.readFileSync(file, 'utf8').split('\\n');
      const rel = file.startsWith('/work/src/') ? file.slice('/work/src/'.length) : file;
      const slice = lines.slice(s - 1, e).map((l, idx) => (s + idx) + ': ' + l);
      process.stdout.write('File: ' + rel + ' (lines ' + s + '..' + Math.min(e, lines.length) + ' of ' + lines.length + ')\\n' + slice.join('\\n'));
    `;
    const res = await execInContainer(dockerBin, container, ['node', '-e', script, targetPath, String(startLine), String(endLine)]);
    if (res.code !== 0) throw new Error(res.stderr || `read_file failed for ${targetPath}`);
    return res.stdout;
  }

  if (name === 'search_code') {
    const targetPath = resolveContainerPath(args.path || '/work/src');
    const pattern = String(args.pattern || '');
    if (!pattern) throw new Error('pattern is required');
    const maxResults = Math.min(Math.max(Number(args.max_results) || 80, 1), 200);
    const flags = args.case_insensitive ? 'i' : '';
    const script = `
      const fs = require('node:fs'), path = require('node:path');
      const [root, pat, flags, limStr] = process.argv.slice(1);
      const limit = Number(limStr);
      let re; try { re = new RegExp(pat, flags); } catch { re = new RegExp(pat.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), flags); }
      const skip = new Set(['node_modules', '.git', 'target', 'dist', '.cargo', 'coverage']);
      const hits = [];
      function scanFile(file) {
        if (hits.length >= limit) return;
        let st; try { st = fs.lstatSync(file); } catch { return; }
        if (!st.isFile() || st.size > 1048576) return;
        let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
        if (text.includes('\\0')) return;
        const rel = file.startsWith('/work/src/') ? file.slice('/work/src/'.length) : file;
        const lines = text.split('\\n');
        for (let i = 0; i < lines.length && hits.length < limit; i++) {
          if (re.test(lines[i])) hits.push(rel + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 220));
        }
      }
      (function walk(p) {
        if (hits.length >= limit) return;
        let st; try { st = fs.lstatSync(p); } catch { return; }
        if (st.isFile()) return scanFile(p);
        if (!st.isDirectory()) return;
        let ents = []; try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
        for (const e of ents) if (!e.isSymbolicLink() && !skip.has(e.name)) walk(path.join(p, e.name));
      })(root);
      process.stdout.write(hits.length ? hits.join('\\n') : 'No matches found.');
    `;
    const res = await execInContainer(dockerBin, container, ['node', '-e', script, targetPath, pattern, flags, String(maxResults)]);
    if (res.code !== 0) throw new Error(res.stderr || 'search_code failed');
    return res.stdout;
  }

  if (name === 'list_existing_tests' || name === 'run_existing_tests') {
    if (Object.keys(args).some(key => name === 'list_existing_tests' || key !== 'test_id')) throw new Error('Existing test tools accept only a catalogued test_id');
    const catalog = readReportJson(reportDir, 'harness/existing-tests.json');
    const sourceDigest = ctx.submissionIdentity?.sourceDigest;
    // Validate every catalog row before advertising it; commands are reconstructed.
    const entries = catalog.tests?.map(entry => selectExistingTest(catalog, entry.id, sourceDigest));
    if (!entries || catalog.workflow !== REVIEW_WORKFLOW) throw new Error('Existing test catalog unavailable');
    if (name === 'list_existing_tests') return JSON.stringify({ scope: 'existing_offline_tests_only', tests: entries.map(({ id, kind, cwd, description }) => ({ id, kind, cwd, description })) });
    const entry = selectExistingTest(catalog, args.test_id, sourceDigest);
    if (fs.existsSync(path.join(reportDir, 'harness/test-artifacts.json'))) entry.artifacts = selectTestArtifacts(readReportJson(reportDir, 'harness/test-artifacts.json'), catalog.sourceDigest);
    const key = ctx.submissionIdentity?.name || auditor || agent;
    // The coordinator runs every catalogued suite before reviewers start. Reviewers get
    // that recorded run instead of a rerun of the same source: a long suite outlives
    // some CLIs' MCP call deadlines and holds the shared test lock against other reviewers.
    if (key !== 'verification') {
      const recorded = recordedVerificationRun(reportDir, entry.id, catalog.sourceDigest);
      if (recorded) return existingTestResponse(entry.id, recorded.row.exitCode, recorded.row.failureDetail, recorded.evidence, `recorded by the coordinator at ${recorded.row.at} before review; not re-executed`);
    }
    return withExistingTestLock(reportDir, async () => {
      const inspected = spawnSync(dockerBin, ['inspect', '--format', '{"running":{{json .State.Running}},"mode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}}}', container], { encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024 });
      let network;
      try { network = JSON.parse(inspected.stdout); } catch { throw new Error('Cannot verify offline test containment'); }
      if (inspected.status !== 0 || network.running !== true || typeof network.mode !== 'string' || network.mode === 'host' || network.mode.startsWith('container:') || !network.networks || Object.keys(network.networks).some(key => key !== 'none')) throw new Error('Tests require a network-disconnected container');
      const result = await execInContainer(dockerBin, container, ['node', '-e', EXISTING_TEST_RUNNER], { input: JSON.stringify(entry), timeoutMs: entry.timeoutMs + 10_000, maxBytes: TEST_OUTPUT_BYTES, keepTail: true });
      const failureDetail = result.code !== 0 ? missingTestArtifact(result.stderr) : null;
      if (key) {
        const file = `harness/existing-test-results-${key}.json`;
        let prior = []; try { prior = readReportJson(reportDir, file); } catch { /* first test */ }
        const counts = testCounts(result.stdout);
        const sequence = Math.max(-1, ...prior.map(row => Number(row.evidenceFile?.match(/-(\d+)\.json$/)?.[1] ?? -1))) + 1;
        if (!Number.isSafeInteger(sequence)) throw new Error('Invalid existing test evidence sequence');
        const evidenceFile = `harness/existing-test-output-${key}-${sequence}.json`;
        const evidence = JSON.stringify({ stdout: result.stdout, stderr: result.stderr, ...(result.omittedBytes ? { omittedBytes: result.omittedBytes } : {}) });
        writeReportFile(reportDir, evidenceFile, evidence);
        writeReportFile(reportDir, file, JSON.stringify([...prior, { testId: entry.id, sourceDigest: catalog.sourceDigest, kind: entry.kind, cwd: entry.cwd, exitCode: result.code, counts, ...(failureDetail ? { failureDetail } : {}), evidenceFile, evidenceHash: crypto.createHash('sha256').update(evidence).digest('hex'), at: new Date().toISOString(), scope: 'existing_offline_test_only' }].slice(-200)));
      }
      return existingTestResponse(entry.id, result.code, failureDetail, result);
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

export const COMMON_TOOL_NAMES = ['get_audit_context', 'get_review_plan', 'list_files', 'read_file', 'search_code', 'list_existing_tests', 'run_existing_tests'];
export const commonHandlers = Object.fromEntries(COMMON_TOOL_NAMES.map(name => [name, (ctx, args) => runCommonTool(ctx, name, args)]));
