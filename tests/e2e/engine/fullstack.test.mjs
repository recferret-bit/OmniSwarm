// End-to-end on engine/eval/golden/fullstack-dapp: a deliberately vulnerable frontend, backend, wallet
// integration, NEAR contract, Solana program and infra tree with a line-accurate answer key. It drives every
// offline mode of the engine over the same target: stack routing, the layer map (web2 / web3 / infra), the lead
// scan, the reviewer guidance, the plan for each preset, the intake's theme split, and a scripted review with
// the debate at 1, 2 and 3 rounds through to the HTML report. Nothing here calls a provider, a chain or Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPanel } from '../../../engine/eval/panel.mjs';
import { buildExpected } from '../../../engine/eval/build-expected.mjs';
import { renderSurfaceSkillGuidance } from '../../../engine/scripts/audit-plans.mjs';
import { readHarnessContext } from '../../../engine/scripts/orchestrator-prompts.mjs';
import { LAYERS, layerOfPath } from '../../../engine/scripts/harness-layers.mjs';
import { loadPhases, runPhases } from '../../../engine/scripts/orchestrator-phases.mjs';
import { SCRIPTS, builtinWithReport, phaseContext, runFromPanel, tempDir } from '../../../engine/scripts/debate-test-run.mjs';
import { detectEcosystems } from '../../../engine/scripts/stack-detect.mjs';
import { writeText } from '../../../engine/scripts/report-util-files.mjs';
import { partitionTree } from '../../../apps/api/src/worker/themes.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = path.join(ROOT, 'engine', 'eval', 'golden', 'fullstack-dapp');
const CONFIG = path.join(ROOT, 'engine', 'omniswarm.config.example.json');
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
const json = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const node = (script, args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { cwd: ROOT, encoding: 'utf8' });
const audit = (args, env = {}) => spawnSync(path.join(ROOT, 'bin', 'audit'), args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
const where = (row) => `${row.file}:${row.startLine}`;

// One lead scan shared by the tests below (no dependency scanners: they need the sandbox image).
let scanned = null;
function harness() {
  if (scanned) return scanned;
  const report = tempDir('fullstack-harness-');
  const result = node('harness.mjs', ['--target', FIXTURE, '--out', path.join(report, 'harness'), '--no-deps']);
  assert.equal(result.status, 0, result.stderr);
  scanned = { report, dir: path.join(report, 'harness'), profile: json(report, 'harness/stack-profile.json') };
  return scanned;
}

// A finalized scripted run on the fixture, then the orchestrator's debate, adjudication and general review.
// maxClusters: the debate cap. The default leaves part of this fixture's 65 clusters undebated on purpose.
async function orchestrated(rounds, maxClusters = 100) {
  const panel = await runPanel(FIXTURE, expected, tempDir('fullstack-panel-'));
  const { out, reviewers } = runFromPanel(panel);
  fs.cpSync(harness().dir, path.join(out, 'harness'), { recursive: true });
  writeText(out, 'harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  const ctx = phaseContext({ out, reviewers, target: FIXTURE, orchestrator: 'scripted:judge', rounds });
  ctx.budgets.debate.maxClusters = maxClusters;
  await runPhases(await loadPhases({ builtin: builtinWithReport(out), dir: SCRIPTS }), ctx);
  return { out, ctx };
}

test('the answer key follows the source and seeds every layer', () => {
  assert.deepEqual(buildExpected(), expected, 'expected.json is stale: run node engine/eval/build-expected.mjs');
  for (const layer of LAYERS) {
    assert.ok(expected.bugs.filter((row) => row.layer === layer).length >= 8, `${layer} bugs`);
    assert.ok(expected.decoys.filter((row) => row.layer === layer).length >= 2, `${layer} decoys`);
  }
  // No hint for a live reviewer: the tree never labels its own defects.
  const source = fs.readdirSync(FIXTURE, { recursive: true }).filter((rel) => rel !== 'expected.json' && fs.statSync(path.join(FIXTURE, rel)).isFile());
  for (const rel of source) assert.doesNotMatch(fs.readFileSync(path.join(FIXTURE, rel), 'utf8'), /\b(?:BUG|VULN|FIXME|decoy|insecure|vulnerab)/i, rel);
});

test('stack routing finds the Node apps, the Solana program, the NEAR and EVM contracts and clients, and nothing else', () => {
  const eco = detectEcosystems(FIXTURE);
  assert.deepEqual(eco.primary, ['node', 'rust']);
  assert.equal(eco.python.detected, false);
  assert.deepEqual(eco.solana.marks, ['Anchor.toml', 'programs/tip_vault/Cargo.toml']);
  assert.deepEqual(eco.near.kinds, ['client', 'contract']);
  assert.deepEqual([eco.evm.contracts, eco.evm.kinds, eco.evm.tooling], [true, ['client', 'contract'], ['foundry']]);
  assert.equal(eco.near.contracts, true);
  for (const framework of ['express', 'near-api-js', 'solana-web3']) assert.ok(eco.node.frameworks.includes(framework), framework);
});

test('every seeded row lands in the layer the answer key names', () => {
  const { layers } = harness().profile;
  assert.deepEqual(layers.present, LAYERS);
  for (const row of [...expected.bugs, ...expected.decoys]) assert.equal(layerOfPath(where(row), layers), row.layer, where(row));
  assert.deepEqual(layers.roots.web3, ['contracts/evm', 'contracts/tipjar', 'programs/tip_vault']);
  // A backend file that signs chain transactions is web3; the rest of the backend is not.
  assert.equal(layerOfPath('backend/src/payout.js', layers), 'web3');
  assert.equal(layerOfPath('backend/src/auth.js', layers), 'web2');
});

test('the lead scan reaches each layer with its own lead file', () => {
  const { dir } = harness();
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const leadFiles = { web2: ['web.md', 'node.md', 'review-plans.md'], web3: ['solana.md', 'near.md', 'evm.md', 'web.md', 'review-plans.md'], infra: ['config.md'] };
  // A lead within two lines of the seeded line points a reviewer at the same statement.
  const near = (row) => [-2, -1, 0, 1, 2].map((delta) => `${row.file}:${row.startLine + delta}`);
  const hit = (row) => leadFiles[row.layer].some((name) => near(row).some((cite) => new RegExp(`${cite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(read(name))));
  // Leads are greppable sinks only. What they cannot reach is the reviewer's work: a handler with no caller
  // check, an IDOR, a race, a missing SRI attribute. The floors below fail when a lead family stops working.
  const floor = { web2: 0.6, web3: 0.75, infra: 0.75 };
  for (const layer of LAYERS) {
    const bugs = expected.bugs.filter((row) => row.layer === layer);
    const found = bugs.filter(hit);
    assert.ok(found.length / bugs.length >= floor[layer], `${layer}: leads reach ${found.length} of ${bugs.length} seeded bugs; missed ${bugs.filter((row) => !hit(row)).map(where).join(', ')}`);
  }
  assert.match(read('python.md'), /Python surface absent/);
  assert.match(read('summary.md'), /layers: web2 \d+ files, web3 \d+ files, infra \d+ files/);
  assert.doesNotMatch(read('summary.md'), /attack/i);
  // Infra leads are not application leads and the other way round.
  assert.doesNotMatch(read('config.md'), /backend\/src|frontend\/src|contracts\/|programs\//);
  assert.doesNotMatch(read('node.md'), /infra\/|\.github\//);
});

test('reviewer guidance is one block per layer and routes infra leads to S4 and S5 only', () => {
  const { report, profile } = harness();
  for (const code of ['S1', 'S3', 'S4', 'S5', 'S6']) {
    const text = renderSurfaceSkillGuidance(code, profile);
    assert.match(text, /#### Web3: on-chain code and wallet flows/, code);
    assert.doesNotMatch(text, /Python|FastAPI|Django/, code);
  }
  const s4 = renderSurfaceSkillGuidance('S4', profile);
  const order = ['#### Web2:', '#### Web3:', '#### Infra:'].map((heading) => s4.indexOf(heading));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'web2, web3, infra in that order');
  assert.doesNotMatch(renderSurfaceSkillGuidance('S2', profile), /#### Infra:/);
  assert.match(readHarnessContext(report, 'S4'), /### Infra Leads/);
  assert.match(readHarnessContext(report, 'S5'), /### Infra Leads/);
  assert.doesNotMatch(readHarnessContext(report, 'S2'), /### Infra Leads/);
  assert.match(readHarnessContext(report, 'S3'), /## Review Layers/);
});

test('the plan prints for the local, hosted and demo presets without starting a review', () => {
  const plan = (preset, extra = [], env = {}) => {
    const result = audit(['run', '--repo', FIXTURE, '--config', CONFIG, '--preset', preset, ...extra, '--plan'], env);
    assert.equal(result.status, 0, `${preset}: ${result.stderr}`);
    assert.match(result.stdout, /Plan only\. No harness, no agents\./);
    return result.stdout;
  };
  const local = plan('local-subscriptions');
  assert.match(local, /Assignment: matrix \(24 jobs\)/);
  assert.match(local, /cli-claude-opus\s+cli\s+anthropic/);
  const hosted = plan('hosted', ['--surface', 's3'], { ZAI_API_KEY: 'zk-not-a-key', OPENROUTER_API_KEY: 'or-not-a-key' });
  assert.match(hosted, /Assignment: round-robin \(6 jobs\)/);
  assert.match(hosted, /max cost \$25 per reviewer/);
  assert.equal(/zk-not-a-key|or-not-a-key/.test(hosted), false);
  const demo = plan('demo', [], { OMNI_DEMO: '1' });
  assert.match(demo, /Orchestrator: scripted:judge/);
  const refused = audit(['run', '--repo', FIXTURE, '--rpc', 'https://rpc.mainnet.near.org', '--plan']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /does not contact deployed RPCs/);
});

test('the intake splits the tree into web3, apps and infra themes for the full, web2 and web3 scopes', () => {
  const files = fs.readdirSync(FIXTURE, { recursive: true }).filter((rel) => fs.statSync(path.join(FIXTURE, rel)).isFile()).map((rel) => rel.split(path.sep).join('/'));
  const dirs = (scope) => Object.fromEntries(partitionTree(files, scope).map((slice) => [slice.theme, [...slice.dirs].sort()]));
  assert.deepEqual(dirs('full'), { web3: ['contracts', 'programs'], apps: ['backend', 'frontend'], infra: ['.github', 'infra'] });
  assert.deepEqual(dirs('web3'), { web3: ['contracts', 'programs'] });
  assert.deepEqual(dirs('web2'), { apps: ['backend', 'frontend'], infra: ['.github', 'infra'] });
});

test('a scripted review with a two-round debate keeps the seeded bugs, refutes the decoys and tags every finding with its layer', async () => {
  const { out, ctx } = await orchestrated(2);
  assert.deepEqual(ctx.stageFailures, []);
  const rendered = node('generate-html-report.mjs', [out]);
  assert.ok(rendered.status === 0 || rendered.status === 2, rendered.stderr);
  const scored = json(out, 'findings-and-scores.json');
  const rowAt = (row) => scored.find((item) => item.locations.includes(where(row)));
  for (const bug of expected.bugs) {
    const row = rowAt(bug);
    assert.ok(row, `no cluster for ${where(bug)}`);
    assert.equal(row.layer, bug.layer, where(bug));
    assert.ok(['LIKELY', 'CONFIRMED', 'AGREED'].includes(row.finalStatus), `${where(bug)} is ${row.finalStatus}`);
  }
  for (const decoy of expected.decoys) assert.equal(rowAt(decoy).finalStatus, 'REFUTED', where(decoy));
  // Debate files never name a reviewer.
  const turns = fs.readdirSync(path.join(out, 'debate'), { recursive: true }).filter((rel) => /^round-\d\/.+\.json$/.test(rel)).map((rel) => fs.readFileSync(path.join(out, 'debate', rel), 'utf8')).join('\n');
  assert.equal(/scripted-|baseline|paranoid|claude|opus/i.test(turns), false);
  const html = fs.readFileSync(path.join(out, 'report.html'), 'utf8');
  for (const layer of LAYERS) {
    assert.match(html, new RegExp(`data-layer="${layer}"`), layer);
    assert.match(html, new RegExp(`data-layer-filter="${layer}"`), layer);
  }
  assert.match(html, /Model agreement and passing checks do not certify security\./);
  assert.equal(json(out, 'general-review.json').riskPosture, 'critical-exposure');
});

test('past the debate cap a cluster is a recorded gap that still has a status, and criticals are debated first', async () => {
  const { out, ctx } = await orchestrated(2, 25);
  assert.deepEqual(ctx.stageFailures, []);
  const { clusters, coverageGaps } = json(out, 'debate/clusters.json');
  const capped = clusters.filter((row) => row.status === 'CAPPED');
  assert.ok(capped.length > 0);
  assert.equal(coverageGaps.filter((gap) => gap.reason === 'debate_cap').length, capped.length);
  const adjudicated = new Set(json(out, 'debate/adjudication.json').map((row) => row.clusterId));
  for (const row of clusters) assert.ok(adjudicated.has(row.id), `${row.id} has no adjudication`);
  // Critical findings are debated before anything capped.
  const order = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  const lowestDebated = Math.min(...clusters.filter((row) => row.status === 'QUEUED').map((row) => order[row.severity]));
  for (const row of capped) assert.ok(order[row.severity] <= lowestDebated, `${row.id} (${row.severity}) was capped ahead of a lower severity`);
  node('generate-html-report.mjs', [out]);
  const row = json(out, 'findings-and-scores.json').find((item) => item.debateGap === 'debate_cap');
  assert.ok(row && row.finalStatus, 'a capped row keeps its gap and carries the citation-rules status');
});

test('one round never defends, and a third round is spent only on a defence that held', async () => {
  const one = await orchestrated(1);
  assert.deepEqual(one.ctx.stageFailures, []);
  assert.equal(fs.existsSync(path.join(one.out, 'debate', 'round-2')), false);
  const three = await orchestrated(3);
  assert.deepEqual(three.ctx.stageFailures, []);
  const round = (n) => (fs.existsSync(path.join(three.out, 'debate', `round-${n}`)) ? fs.readdirSync(path.join(three.out, 'debate', `round-${n}`)).map((name) => json(three.out, `debate/round-${n}/${name}`)) : []);
  const defended = new Set(round(2).filter((turn) => turn.verdict !== 'refuted' && !turn.conformitySuspect).map((turn) => turn.clusterId));
  assert.ok(round(2).length > 0);
  assert.ok(round(3).every((turn) => defended.has(turn.clusterId)));
  // The same seeded bugs survive whatever the number of rounds.
  const kept = (out) => json(out, 'debate/adjudication.json').filter((row) => row.finalStatus !== 'REFUTED').map((row) => row.clusterId).sort();
  assert.deepEqual(kept(one.out), kept(three.out));
});

test('a debate fault leaves the run INCOMPLETE with every per-model finding still reported', async (t) => {
  process.env.OMNI_FAULT = 'debate-round-2';
  t.after(() => { delete process.env.OMNI_FAULT; });
  const { out, ctx } = await orchestrated(2);
  assert.ok(ctx.stageFailures.some((failure) => failure.startsWith('phase_failed:debate:')), ctx.stageFailures.join());
  assert.equal(node('report-contract.mjs', [out]).status, 2);
  node('generate-html-report.mjs', [out]);
  assert.equal(json(out, 'report-health.json').state, 'incomplete');
  assert.ok(json(out, 'findings-and-scores.json').length >= expected.bugs.length);
});
