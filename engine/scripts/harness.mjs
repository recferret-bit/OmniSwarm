#!/usr/bin/env node
// Read-only lead scan for audit run. Does not build, install, or execute the target.
// A hit is a lead for an auditor, not a finding. Patterns are the greppable subset of:
//   the NEAR contract checklist, NEAR clients, Intents and NEAR AI recognition
//   OWASP sinks a regex can see (injection, XSS, command exec, TLS, CORS, JWT, cookies, secrets)
// Dependency advisories: cargo-audit (RustSec, cached DB, no fetch) and npm audit --package-lock-only
// against registry.npmjs.org. Lockfile parsers only. No target scanner config is loaded.

import fs from 'node:fs';
import path from 'node:path';
import { analyzeStackAndPlans, renderReviewPlansMarkdown } from './audit-plans.mjs';
import { scannerChecks, missingScanner, setScannerOutputDir, runAllScanners } from './harness-scanners.mjs';
import { writeConfig, writeNear, writePython, writeNode, writeWeb } from './harness-leads.mjs';
import { NEAR_CONTRACT_PATTERNS, NEAR_CLIENT_PATTERNS } from './harness-patterns-chain.mjs';
import { PY_PATTERNS, NODE_PATTERNS, CONFIG_PATTERNS } from './harness-patterns-app.mjs';

function parseArgs(argv) {
  const out = { target: '', outDir: '', noDeps: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i] || '';
    else if (a === '--out') out.outDir = argv[++i] || '';
    else if (a === '--no-deps') out.noDeps = true;
    else if (a === '--self-test') out.selfTest = true;
    else throw new Error(`harness: unknown option ${a}`);
  }
  return out;
}
async function scan(target, outDir, noDeps) {
  const root = path.resolve(target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`harness: not a directory: ${target}`);
  fs.mkdirSync(outDir, { recursive: true });
  setScannerOutputDir(outDir);
  const web = writeWeb(root);
  const config = writeConfig(root);
  const stackProfile = analyzeStackAndPlans(root);
  const nearEco = stackProfile.ecosystems?.near;
  const near = writeNear(root, nearEco);
  const python = writePython(root, stackProfile.ecosystems);
  const node = writeNode(root, stackProfile.ecosystems);
  const reviewPlansMd = renderReviewPlansMarkdown(stackProfile);
  let deps;
  let tools;
  if (noDeps) {
    deps = '# Dependency leads\n\nSkipped (--no-deps).\n';
    for (const tool of ['gitleaks', 'semgrep', 'osv-scanner', 'cargo-audit', 'npm-audit', 'python-deps', 'node-deps']) missingScanner(tool, 'Skipped (--no-deps)');
    tools = '# Scanner leads\n\nSkipped (--no-deps).\n';
  } else {
    ({ deps, tools } = await runAllScanners(root, outDir));
  }
  fs.writeFileSync(path.join(outDir, 'scanner-results.json'), JSON.stringify({ version: 1, rustsecRevision: fs.existsSync('/opt/audit-scanners/rustsec-revision.txt') ? fs.readFileSync('/opt/audit-scanners/rustsec-revision.txt', 'utf8').trim() : null, databases: fs.existsSync('/opt/audit-scanners/databases.sha256') ? fs.readFileSync('/opt/audit-scanners/databases.sha256', 'utf8') : null, preparedAt: fs.existsSync('/opt/audit-scanners/prepared-at.txt') ? fs.readFileSync('/opt/audit-scanners/prepared-at.txt', 'utf8').trim() : null, rules: fs.existsSync('/opt/audit-scanners/rules.sha256') ? fs.readFileSync('/opt/audit-scanners/rules.sha256', 'utf8') : null, checks: scannerChecks }, null, 2));
  fs.writeFileSync(path.join(outDir, 'near.md'), near.body);
  fs.writeFileSync(path.join(outDir, 'web.md'), web.body);
  fs.writeFileSync(path.join(outDir, 'python.md'), python.body);
  fs.writeFileSync(path.join(outDir, 'node.md'), node.body);
  fs.writeFileSync(path.join(outDir, 'config.md'), config.body);
  fs.writeFileSync(path.join(outDir, 'deps.md'), deps);
  fs.writeFileSync(path.join(outDir, 'tools.md'), tools);
  fs.writeFileSync(path.join(outDir, 'review-plans.md'), reviewPlansMd);
  fs.writeFileSync(path.join(outDir, 'stack-profile.json'), `${JSON.stringify(stackProfile, null, 2)}\n`);
  const summary = [
    '# Harness',
    '',
    `target: ${root}`,
    `detected stacks: ${stackProfile.detectedStacks.join(', ') || 'none'}`,
    `near stack: ${nearEco?.detected ? 'yes' : 'no'} (${near.leads} leads, ${near.files} files; kinds: ${(nearEco?.kinds || []).join(', ') || 'none'}; contracts: ${nearEco?.contracts ? 'yes' : 'no'})`,
    `python: ${stackProfile.ecosystems.python.detected ? 'yes' : 'no'} (${python.leads} leads, ${python.files} production files; frameworks: ${stackProfile.ecosystems.python.frameworks.join(', ') || 'none'}; test runner: ${stackProfile.ecosystems.python.hasPytestSignal ? 'pytest' : 'none found'})`,
    `stacks by production source: ${stackProfile.ecosystems.primary.join(', ') || 'none'}`,
    `node: ${stackProfile.ecosystems.node.detected ? 'yes' : 'no'} (${node.leads} leads, ${node.files} production files; frameworks: ${stackProfile.ecosystems.node.frameworks.join(', ') || 'none'})`,
    `web: ${web.files} source files, ${web.leads} leads`,
    `infra: ${config.files} files, ${config.leads} leads (config.md)`,
    `layers: ${['web2', 'web3', 'infra'].map((layer) => `${layer} ${stackProfile.layers.counts[layer]} files`).join(', ')}`,
    `review plans: review-plans.md (${stackProfile.domains.map((d) => d.id).join(', ')})`,
    `deps: ${noDeps ? 'skipped' : 'deps.md'}`,
    `scanners: ${noDeps ? 'skipped' : 'tools.md'}`,
    '',
    'Leads are not findings. Map entry points, then triage the file and review-plans.md for your surface.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
  return { near: near.leads, web: web.leads, python: python.leads, node: node.leads, stacks: stackProfile.detectedStacks };
}

function selfTest() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const fx = path.join(here, 'harness-fixtures');
  const near = writeNear(path.join(fx, 'near'), { detected: true, contracts: true, kinds: ['contract', 'client', 'intents', 'ai'], marks: ['Cargo.toml'] });
  const web = writeWeb(path.join(fx, 'web'));
  const config = writeConfig(path.join(fx, 'config'));
  const python = writePython(path.join(fx, 'python'));
  const nodeLeads = writeNode(path.join(fx, 'web'));
  const profile = analyzeStackAndPlans(fx);
  const plansMd = renderReviewPlansMarkdown(profile);
  const must = [
    ...NEAR_CONTRACT_PATTERNS.map((p) => [p.id, near.body]),
    ...NEAR_CLIENT_PATTERNS.map((p) => [p.id, near.body]),
    ['xss-html', web.body], ['command-exec', web.body], ['sql-template', web.body], ['yaml-load', web.body],
    ['pickle-loads', web.body], ['tls-verify-off', web.body], ['cors-star', web.body], ['jwt-none', web.body],
    ['cookie-no-httponly', web.body], ['message-listener', web.body], ['postmessage', web.body], ['private-key', web.body],
    ['ssrf-fetch', web.body], ['path-from-request', web.body], ['open-redirect', web.body],
    ['wallet-sign', web.body],
    ...PY_PATTERNS.map((p) => [p.id, python.body]),
    ...NODE_PATTERNS.map((p) => [p.id, nodeLeads.body]),
    ...CONFIG_PATTERNS.map((p) => [p.id, config.body]),
  ];
  const bad = [];
  for (const [id, body] of must) {
    const block = body.split(`## ${id} `)[1] || '';
    const until = block.split('\n## ')[0];
    if (!['bad.rs', 'bad.js', 'bad.py', 'bad.yml'].some((name) => until.includes(name))) bad.push(`${id}: no bad-file hit`);
    if (['good.rs', 'good.js', 'good.py', 'good.yml'].some((name) => until.includes(name))) bad.push(`${id}: good file matched`);
  }
  if (!plansMd.includes('[SCOPES_ROLES]') || !plansMd.includes('[ABUSE_ECONOMY]') || !plansMd.includes('[API_DTO_ABUSE]')) {
    bad.push('review-plans.md: missing cross-cutting plans');
  }
  if (bad.length) {
    console.error(bad.join('\n'));
    process.exit(1);
  }
  console.log(`harness self-test ok (${must.length} patterns)`);
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) selfTest();
else if (!args.target || !args.outDir) {
  console.error('usage: harness.mjs --target <dir> --out <dir> [--no-deps] | --self-test');
  process.exit(2);
} else {
  scan(args.target, args.outDir, args.noDeps).then(
    (r) => console.log(`harness: near leads ${r.near}, web leads ${r.web}, python leads ${r.python}, node leads ${r.node}, stacks [${(r.stacks || []).join(',')}] -> ${args.outDir}`),
    (err) => { console.error(err.message || err); process.exit(1); },
  );
}
