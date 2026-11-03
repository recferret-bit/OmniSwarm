// W04-16: every family x passes x tool budget runs through the real pass loop (reviewer-pass-loop) and the
// real bridge (docker-mcp-bridge in-process on the demo host, with its budget gate). Pass counts, call counts
// and stops are read back from what the loop and the bridge recorded, not from the test's own counters.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest } from './agent-session-store.mjs';
import { toOpenAiTools } from './api-tool-schema.mjs';
import { attachBudget } from './bridge-budget.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import { handleRpcMessage, parseBridgeArgs, toolDefinitions } from './docker-mcp-bridge.mjs';
import { PRESETS, runToolLoop } from './provider-openai-compat.mjs';
import { passCalls } from './review-passes.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { runReviewerPasses } from './reviewer-pass-loop.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';
import { selectSurfaces } from './reviewer-plan-assign.mjs';
import { DEMO_FIXTURE, runStrategy } from './scripted-strategies.mjs';

const SPECS = { cli: 'cli:claude:opus', key: 'key:zai:glm-5.3', openrouter: 'openrouter:auto', scripted: 'scripted:lazy' };
const EMPTY_REPORT = { findings: [], verified_safe: [], markdown_summary: 'Read until the budget, then submitted; coverage is partial.' };
const S1 = selectSurfaces('s1')[0];

function setupRun(reviewer) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-matrix-'));
  const seen = digestTree(DEMO_FIXTURE);
  const name = `${reviewer.id}-s1-auth`;
  const identity = { name, agent: reviewer.id, role: 'auditor', workflow: REVIEW_WORKFLOW, model: reviewer.model, family: reviewer.family, provider: reviewer.provider, sourceDigest: seen.digest, assignmentDigest: digest(S1), surface: 'S1' };
  fs.mkdirSync(path.join(out, 'harness', 'identities'), { recursive: true });
  fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify({ version: 1, digest: seen.digest, files: seen.files }));
  fs.writeFileSync(path.join(out, 'harness', 'reviewers.json'), JSON.stringify({ version: 1, reviewers: [reviewer] }));
  fs.writeFileSync(path.join(out, 'harness', 'identities', `${name}.json`), JSON.stringify(identity));
  return { out, name };
}

// A fresh bridge per pass, as a real session gets: parsed arguments, the budget gate, MCP tools/call framing.
function bridgeFor({ out, name, reviewer, pass, toolBudget }) {
  const ctx = attachBudget(parseBridgeArgs(['--demo-host', DEMO_FIXTURE, '--report-dir', out, '--role', 'auditor', '--auditor', name, '--agent', reviewer.id, '--surface', 'S1', '--pass', String(pass), '--tool-budget', String(toolBudget), '--identity-file', path.join(out, 'harness', 'identities', `${name}.json`), '--reviewers-file', path.join(out, 'harness', 'reviewers.json')]));
  let id = 0;
  return async (tool, args) => {
    const reply = await handleRpcMessage(ctx, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: tool, arguments: args } });
    return reply.result.content[0].text;
  };
}

// A subscription CLI obeys the bridge: it inspects until the bridge says the budget is spent, then submits.
async function cliAgent(callTool) {
  for (let i = 0; i < 50; i++) if (/budget exhausted/.test(await callTool('read_file', { path: 'src/lib.rs' }))) break;
  await callTool('submit_audit_report', EMPTY_REPORT);
}

// A greedy model that always inspects; only the loop's forced tool_choice on its last turn makes it submit.
function greedyProvider(provider, seen) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    const forced = body.tool_choice?.function?.name;
    const call = forced ? { name: forced, arguments: JSON.stringify(EMPTY_REPORT) } : { name: 'read_file', arguments: JSON.stringify({ path: 'src/lib.rs' }) };
    const payload = { model: body.model, choices: [{ message: { content: null, tool_calls: [{ id: `c${seen.length}`, type: 'function', function: call }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => payload, provider };
  };
}

async function runFamilyPass(family, reviewer, callTool, { pass, toolBudget, requests }) {
  if (family === 'scripted') return runStrategy('lazy', { callTool, fixtureRoot: DEMO_FIXTURE, surface: 'S1', pass });
  if (family === 'cli') return cliAgent(callTool);
  const preset = PRESETS[family === 'key' ? reviewer.provider : 'openrouter'];
  return runToolLoop({ baseUrl: 'https://example.invalid/v1', apiKey: 'fixture', model: reviewer.model, extraBody: preset.extraBody, tools: toOpenAiTools(toolDefinitions('auditor')), callTool, brief: `Pass ${pass}`, maxTurns: toolBudget + 3, provider: preset.provider, fetchImpl: greedyProvider(family, requests), sleep: async () => {} });
}

test('every family x passes x tool budget completes exactly P passes and never exceeds N calls plus 3 grace', async (t) => {
  let cases = 0;
  for (const [family, spec] of Object.entries(SPECS)) {
    const reviewer = parseReviewerSpec(spec);
    for (const passes of [1, 2, 3]) {
      for (const toolBudget of [2, 5]) {
        const { out, name } = setupRun(reviewer);
        t.after(() => fs.rmSync(out, { recursive: true, force: true }));
        const requests = [];
        const loop = await runReviewerPasses({
          out, name, reviewerId: reviewer.id, surface: 'S1', budgets: { passes, toolBudget }, files: ['src/lib.rs'],
          runPass: async ({ pass }) => {
            await runFamilyPass(family, reviewer, bridgeFor({ out, name, reviewer, pass, toolBudget }), { pass, toolBudget, requests });
            return { code: 0 };
          },
        });
        const label = `${family} passes=${passes} budget=${toolBudget}`;
        assert.equal(loop.passesCompleted, passes, label);
        assert.equal(loop.health.length, passes, label);
        for (let k = 1; k <= passes; k++) {
          const record = passCalls(out, reviewer.id, 'S1', k);
          assert.ok(record.calls <= toolBudget, `${label} pass ${k}: ${record.calls} inspection calls`);
          assert.ok((record.graceUsed || 0) <= 3, `${label} pass ${k}: grace ${record.graceUsed}`);
          const usage = JSON.parse(fs.readFileSync(path.join(out, 'harness', 'usage', reviewer.id, `s1-pass-${k}.json`), 'utf8'));
          assert.ok(['submitted', 'budget'].includes(usage.stop), `${label} pass ${k}: stop ${usage.stop}`);
          if (k < passes) assert.ok(fs.existsSync(path.join(out, 'submissions', `${name}-pass-${k}.json`)), `${label}: pass ${k} archived`);
        }
        assert.ok(fs.existsSync(path.join(out, 'submissions', `${name}.json`)), `${label}: last pass committed`);
        if (family === 'key' || family === 'openrouter') {
          assert.ok(requests.every((body, i) => i % (toolBudget + 3) !== toolBudget + 2 || body.tool_choice?.function?.name === 'submit_audit_report'), `${label}: last turn forces the submit`);
          if (family === 'openrouter') assert.ok(requests.every((body) => body.provider?.data_collection === 'deny'), 'OpenRouter requests deny data collection');
        }
        cases += 1;
      }
    }
  }
  assert.equal(cases, 24);
});
