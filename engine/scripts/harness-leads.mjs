// The per-stack lead files (solana.md, near.md, evm.md, web.md, python.md, node.md, config.md). Regex leads only, not findings.
import path from 'node:path';
import { cargoInfo, isNearCargo, nearReleaseEvidence } from './cargo-manifest.mjs';
import { isProductionPath } from './stack-detect.mjs';
import { PER_PATTERN, walk, rel, readText, cookieLeads, collect, section } from './harness-walk.mjs';
import { SOLANA_PATTERNS, NEAR_CONTRACT_PATTERNS, NEAR_CLIENT_PATTERNS, EVM_CONTRACT_PATTERNS, EVM_CLIENT_PATTERNS } from './harness-patterns-chain.mjs';
import { WEB_PATTERNS, PY_PATTERNS, NODE_PATTERNS, CONFIG_PATTERNS, WEB_EXT } from './harness-patterns-app.mjs';

export function solanaStack(root) {
  const marks = [];
  walk(root, (file) => {
    const base = path.basename(file);
    if (base === 'Anchor.toml') marks.push(rel(root, file));
    else if (base === 'Cargo.toml') {
      const text = readText(file);
      if (text && /anchor-lang|solana-program|solana-sdk|pinocchio/.test(text)) marks.push(rel(root, file));
    }
  });
  return marks.slice(0, 20);
}

// Infra layer files: CI and compose YAML, Dockerfiles, proxy configuration, Terraform and committed environment files.
function configFile(file) {
  const base = path.basename(file);
  const ext = path.extname(file);
  return ext === '.yml' || ext === '.yaml' || ext === '.conf' || ext === '.tf' || ext === '.env' || base === '.env' || base.startsWith('.env.')
    || base === 'Dockerfile' || base.startsWith('Dockerfile.') || base.endsWith('.dockerfile');
}

export function writeConfig(root) {
  const { files, found } = collect(root, (file) => configFile(file), CONFIG_PATTERNS);
  const { total, body } = section(CONFIG_PATTERNS, found);
  if (!files) return { leads: 0, files: 0, body: '# Infra leads\n\nNo Dockerfile, YAML, proxy, Terraform or environment file. Infra surface absent.\n' };
  const header = [
    '# Infra leads',
    '',
    'Regex leads for the infra layer: containers, CI, proxy, orchestration and committed environment files. Not findings.',
    'Grep cannot close: a missing `USER`, missing security headers, network exposure, or who can read a secret store. Those are a source read.',
    'Sources: OWASP WSTG configuration, Docker and Kubernetes hardening guides, GitHub Actions security hardening.',
    `Files scanned: ${files}. Leads listed: ${total}.`,
    '',
    body,
  ];
  return { leads: total, files, body: header.join('\n') };
}
// Versions in use and release-profile hardening. Latest-version comparison needs the network and is left to the reviewer.
function solanaVersions(root, marks) {
  const deps = new Map();
  let overflow = false, profile = false;
  const manifests = new Set(marks.filter((m) => m.endsWith('Cargo.toml')));
  walk(root, (file) => { if (path.basename(file) === 'Cargo.toml' && /^\s*\[workspace\]/m.test(readText(file) || '')) manifests.add(rel(root, file)); });
  for (const mark of manifests) {
    const text = readText(path.join(root, mark)) || '';
    for (const m of text.matchAll(/^\s*(anchor-lang|anchor-spl|solana-program|solana-sdk|pinocchio|spl-token(?:-2022)?)\s*=\s*(?:"([^"]+)"|\{[^}]*?version\s*=\s*"([^"]+)")/gm)) deps.set(m[1], m[2] || m[3]);
    if (/^\s*\[profile\.release\]/m.test(text)) profile = true;
    if (/overflow-checks\s*=\s*true/.test(text)) overflow = true;
  }
  const anchors = [];
  walk(root, (file) => {
    if (path.basename(file) !== 'Anchor.toml') return;
    const text = readText(file) || '';
    for (const key of ['anchor_version', 'solana_version']) { const m = text.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`)); if (m) anchors.push(`${key} ${m[1]}`); }
  });
  return [
    `Versions in use: ${[...[...deps].map(([k, v]) => `${k} ${v}`), ...anchors].join(', ') || 'none declared'}. Compare against current releases when judging known-bug exposure.`,
    overflow ? 'Release profile sets overflow-checks = true.' : `LEAD: no manifest sets overflow-checks = true${profile ? ' ([profile.release] present without it)' : ' (no [profile.release])'}. Release builds then wrap on overflow unless every operation is checked_*.`,
  ];
}

function nearVersions(root, contract) {
  if (!contract) return ['No near-sdk manifest in this mark set. Contract version and overflow-checks are not applied.'];
  const lines = [];
  walk(root, (file) => {
    if (path.basename(file) !== 'Cargo.toml' || !isProductionPath(rel(root, file))) return;
    const info = cargoInfo(root, file);
    if (!isNearCargo(info)) return;
    const versions = info.dependencies.filter(d => d.package === 'near-sdk').map(d => d.version || 'unresolved');
    lines.push(`${rel(root, file)}: near-sdk ${versions.join(', ')}.`, nearReleaseEvidence(root, file));
  });
  return lines.length ? lines : ['LEAD: NEAR manifest evidence could not be resolved.'];
}

export function writeNear(root, eco) {
  const kinds = new Set(eco?.kinds || []);
  const contract = Boolean(eco?.contracts) || kinds.has('contract');
  const markedClient = ['client', 'intents', 'ai'].some((kind) => kinds.has(kind));
  const absent = '# NEAR leads\n\nNo production near-sdk Cargo.toml and no production manifest for near-api-js, NEAR Connect, NEAR Intents, or NEAR AI. NEAR surface absent.\n';
  const nodeExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
  const js = collect(root, (file, ext) => (nodeExt.has(ext) || path.basename(file) === 'package.json') && isProductionPath(rel(root, file)), NEAR_CLIENT_PATTERNS);
  const jsSection = section(NEAR_CLIENT_PATTERNS, js.found);
  // v1.signer and the hosted APIs are leads in production source. They do not mark the stack.
  if (!eco?.detected && !contract && jsSection.total === 0) return { leads: 0, files: 0, body: absent };
  let files = js.files;
  let total = 0;
  const parts = [];
  if (contract) {
    const rust = collect(root, (file, ext) => ext === '.rs' && isProductionPath(rel(root, file)), NEAR_CONTRACT_PATTERNS);
    files += rust.files;
    const sec = section(NEAR_CONTRACT_PATTERNS, rust.found);
    total += sec.total;
    parts.push(sec.body);
  }
  if (markedClient || eco?.detected || jsSection.total > 0) {
    total += jsSection.total;
    parts.push(jsSection.body);
  }
  const header = [
    '# NEAR leads',
    '',
    'Regex leads only. Not findings. Reviewers read source against the NEAR smart contract security checklist. Do not fetch that page from the sandbox.',
    'Checklist: https://docs.near.org/smart-contracts/security/checklist',
    'Do not deploy, do not run near-sandbox, do not call NEAR RPC, the faucet, NEAR AI Cloud, 1Click, the Intents agent API, OutLayer, or NEAR MCP, and do not read the near CLI keychain.',
    `Kinds: ${[...kinds].join(', ') || 'unspecified'}. Contracts: ${contract ? 'yes' : 'no'}. Marks: ${(eco?.marks || []).join(', ') || 'none'}.`,
    ...nearVersions(root, contract),
    `Files scanned: ${files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`,
    '',
    parts.join('\n'),
  ];
  return { leads: total, files, body: header.join('\n') };
}

// evm.md: Solidity/Vyper contract leads and wallet/RPC client leads. Foundry dependencies under lib/, tests
// (*.t.sol, test/) and scripts (*.s.sol, script/) are not scanned.
export function writeEvm(root, eco) {
  const absent = '# EVM leads\n\nNo production Solidity or Vyper source, no Foundry, Hardhat or Truffle project, and no production manifest for ethers, viem, wagmi or web3. EVM surface absent.\n';
  if (eco && !eco.detected) return { leads: 0, files: 0, body: absent };
  const vendored = (name) => /(?:^|\/)lib\//.test(name);
  const contracts = collect(root, (file, ext) => (ext === '.sol' || ext === '.vy') && !/\.[ts]\.sol$/.test(file) && isProductionPath(rel(root, file)) && !vendored(rel(root, file)), EVM_CONTRACT_PATTERNS);
  const nodeExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte']);
  const clients = collect(root, (file, ext) => nodeExt.has(ext) && !file.endsWith('.min.js') && isProductionPath(rel(root, file)), EVM_CLIENT_PATTERNS);
  const contractSection = section(EVM_CONTRACT_PATTERNS, contracts.found);
  const clientSection = section(EVM_CLIENT_PATTERNS, clients.found);
  if (!eco && !contracts.files && !clientSection.total) return { leads: 0, files: 0, body: absent };
  const total = contractSection.total + clientSection.total;
  const header = [
    '# EVM leads',
    '',
    'Regex leads only. Not findings. Contract leads follow the SWC registry and the OWASP Smart Contract Top 10.',
    'Grep cannot close: a function with no access modifier, a state update after an external call, price-oracle and flash-loan exposure, storage-layout collisions in a proxy, or rounding in share math. Those are a source read.',
    'Do not contact an RPC, a block explorer or a deployed contract, and do not send a transaction. forge, hardhat and solc are not in the sandbox image: contract tests are not run and stay a coverage gap.',
    `Kinds: ${(eco?.kinds || []).join(', ') || 'unspecified'}. Tooling: ${(eco?.tooling || []).join(', ') || 'none found'}. Marks: ${(eco?.marks || []).slice(0, 8).join(', ') || 'none'}.`,
    `Contract files scanned: ${contracts.files}. Client files scanned: ${clients.files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`,
    '',
    contractSection.body,
    clientSection.body,
  ];
  return { leads: total, files: contracts.files + clients.files, body: header.join('\n') };
}

export function writeSolana(root, marks) {
  if (!marks.length) {
    return { leads: 0, files: 0, body: '# Solana leads\n\nNo Anchor.toml and no Cargo.toml dependency on anchor-lang, solana-program, solana-sdk, or pinocchio. Solana surface absent.\n' };
  }
  const { files, found } = collect(root, (file, ext) => ext === '.rs' && isProductionPath(rel(root, file)), SOLANA_PATTERNS);
  const { total, body } = section(SOLANA_PATTERNS, found);
  const header = [
    '# Solana leads',
    '',
    'Regex leads only. Not findings.',
    'The OWASP Solana Programs Top 10 is unpublished (every row TBD). Do not invent S01–S10.',
    'Classes: coral-xyz/sealevel-attacks, Trail of Bits instruction introspection, Ackee account-reload / PDA-privilege / init front-run, and escrow custody when the program holds value for later release. The map onto OWASP Smart Contract Top 10 2026 is in the security-audit skill.',
    'Grep cannot close account-data matching, type cosplay, duplicate mutable accounts, PDA seed sharing, reload-after-CPI, or an escrow that pays the wrong party. Those are a source read.',
    `Stack marks: ${marks.join(', ')}`,
    ...solanaVersions(root, marks),
    `Rust files scanned: ${files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`,
    '',
    body,
  ];
  return { leads: total, files, body: header.join('\n') };
}

export function writePython(root, ecosystems) {
  if (ecosystems && !ecosystems.python.detected) {
    return { leads: 0, files: 0, body: '# Python leads\n\nNo production Python source. Python surface absent.\n' };
  }
  const { files, found } = collect(root, (file, ext) => ext === '.py' && isProductionPath(rel(root, file)), PY_PATTERNS);
  if (!files) return { leads: 0, files: 0, body: '# Python leads\n\nNo production Python source. Python surface absent.\n' };
  const { total, body } = section(PY_PATTERNS, found);
  const header = [
    '# Python leads',
    '',
    'Regex leads only. Not findings. Application code only (tests, docs, scripts and migrations are excluded).',
    'Grep cannot close: missing auth `Depends`, ownership checks, transaction/lock correctness, async races, or whether request data reaches a sink. Those are a source read.',
    `Python files scanned: ${files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`,
    '',
    body,
  ];
  return { leads: total, files, body: header.join('\n') };
}

export function writeNode(root, ecosystems) {
  const absent = '# Node leads\n\nNo production JavaScript/TypeScript source. Node surface absent.\n';
  if (ecosystems && !ecosystems.node.detected) return { leads: 0, files: 0, body: absent };
  const nodeExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte']);
  const { files, found } = collect(root, (file, ext) => nodeExt.has(ext) && !file.endsWith('.min.js') && isProductionPath(rel(root, file)), NODE_PATTERNS);
  if (!files) return { leads: 0, files: 0, body: absent };
  const { total, body } = section(NODE_PATTERNS, found);
  return { leads: total, files, body: ['# Node leads', '', 'Regex leads only. Not findings. Production JS/TS only (tests, docs and scripts excluded); generic sinks are also in web.md.', 'Grep cannot close: missing auth middleware, ownership checks, transaction/lock correctness or whether request data reaches a sink. Those are a source read.', `Files scanned: ${files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`, '', body].join('\n') };
}

export function writeWeb(root) {
  const extra = { id: 'cookie-no-httponly', surface: 'S1', note: 'Cookie setter with no httpOnly in the following 240 characters.', scan: cookieLeads };
  const { files, found } = collect(root, (file, ext) => WEB_EXT.has(ext) && !file.endsWith('.min.js'), WEB_PATTERNS, extra);
  const cookieRows = found.get(extra.id) || [];
  const shown = [...WEB_PATTERNS, { id: extra.id, cls: extra.surface, note: extra.note }];
  const { total, body } = section(shown, found);
  if (!files) {
    return { leads: 0, files: 0, body: '# Web leads\n\nNo JS, TS, Python, Go, PHP, Ruby, Java, or Kotlin sources. Web surface absent.\n' };
  }
  const header = [
    '# Web leads',
    '',
    'Regex leads only. Not findings. A sink is a finding only when attacker-controlled data reaches it.',
    'Not covered here, still required on the matching surface: IDOR, CSRF vs SameSite, races, business rules.',
    `Source files scanned: ${files}. Leads listed: ${total}. Cookie leads: ${cookieRows.length}.`,
    '',
    body,
  ];
  return { leads: total, files, body: header.join('\n') };
}
