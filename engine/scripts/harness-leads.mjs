// The per-stack lead files (near.md, web.md, python.md, node.md, config.md). Regex leads only, not findings.
import path from 'node:path';
import { cargoInfo, isNearCargo, nearReleaseEvidence } from './cargo-manifest.mjs';
import { isProductionPath } from './stack-detect.mjs';
import { PER_PATTERN, walk, rel, readText, cookieLeads, collect, section } from './harness-walk.mjs';
import { NEAR_CONTRACT_PATTERNS, NEAR_CLIENT_PATTERNS } from './harness-patterns-chain.mjs';
import { WEB_PATTERNS, PY_PATTERNS, NODE_PATTERNS, CONFIG_PATTERNS, WEB_EXT } from './harness-patterns-app.mjs';

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

function nearVersions(root, contract) {
  const lines = [];
  walk(root, (file) => {
    const base = path.basename(file);
    const r = rel(root, file);
    if (!isProductionPath(r)) return;
    if (base === 'package.json') {
      try {
        const pkg = JSON.parse(readText(file) || '{}');
        const ver = pkg?.dependencies?.['near-sdk-js'] || pkg?.devDependencies?.['near-sdk-js'];
        if (ver) lines.push(`${r}: near-sdk-js ${ver} (JS/TS WASM contract: inspect @call privateFunction/payableFunction guards and BigInt yoctoNEAR math).`);
      } catch { /* malformed package.json is handled elsewhere */ }
      return;
    }
    if (base !== 'Cargo.toml') return;
    const info = cargoInfo(root, file);
    const nearRustDeps = info.dependencies.filter((d) => (['shade-attestation', 'near-crypto', 'near-primitives', 'near-api', 'near-jsonrpc-client'].includes(d.package) || (isNearCargo(info) && d.package === 'dcap-qvl')) && /(?:^|\.)dependencies$/.test(d.group)).map((d) => `${d.package} ${d.version || 'unresolved'}`);
    if (nearRustDeps.length) lines.push(`${r}: ${nearRustDeps.join(', ')}.`);
    if (!contract || !isNearCargo(info)) return;
    const versions = info.dependencies.filter(d => d.package === 'near-sdk').map(d => d.version || 'unresolved');
    const legacy = versions.some((v) => /^[~^=]?\s*[0-4]\./.test(v)) ? ' (legacy near-sdk <5: check #[near_bindgen] / Borsh layout compatibility and RustSec advisories)' : '';
    lines.push(`${r}: near-sdk ${versions.join(', ')}${legacy}.`, nearReleaseEvidence(root, file));
  });
  if (!contract && !lines.length) return ['No near-sdk manifest in this mark set. Contract version and overflow-checks are not applied.'];
  return lines.length ? lines : ['LEAD: NEAR manifest evidence could not be resolved.'];
}

export function writeNear(root, eco) {
  const kinds = new Set(eco?.kinds || []);
  const contract = Boolean(eco?.contracts) || kinds.has('contract');
  const markedClient = ['client', 'intents', 'ai'].some((kind) => kinds.has(kind));
  const absent = '# NEAR leads\n\nNo production near-sdk Cargo.toml and no production manifest for near-api-js, NEAR Wallet Selector, NEAR Connect, Chain Signatures, NEAR Intents, or NEAR AI. NEAR surface absent.\n';
  const clientExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py', ...(!contract ? ['.rs'] : [])]);
  const js = collect(root, (file, ext) => ((clientExt.has(ext) && !file.endsWith('.min.js')) || path.basename(file) === 'package.json') && isProductionPath(rel(root, file)), NEAR_CLIENT_PATTERNS);
  const jsSection = section(NEAR_CLIENT_PATTERNS, js.found);
  const hasRecognitionLead = NEAR_CLIENT_PATTERNS.some((p) => p.recognition && (js.found.get(p.id)?.length || 0) > 0);
  // v1.signer and the hosted APIs are leads in production source. Generic TEE/delegate identifiers without a NEAR mark do not wake near.md.
  if (!eco?.detected && !contract && !hasRecognitionLead) return { leads: 0, files: 0, body: absent };
  let files = js.files;
  let total = 0;
  const parts = [];
  if (contract || kinds.has('ai')) {
    const rust = collect(root, (file, ext) => ext === '.rs' && isProductionPath(rel(root, file)), NEAR_CONTRACT_PATTERNS);
    const sec = section(NEAR_CONTRACT_PATTERNS, rust.found);
    if (contract || sec.total > 0) {
      files += rust.files;
      total += sec.total;
      parts.push(sec.body);
    }
  }
  if (markedClient || eco?.detected || hasRecognitionLead) {
    total += jsSection.total;
    parts.push(jsSection.body);
  }
  const header = [
    '# NEAR leads',
    '',
    'Regex leads only. Not findings. Reviewers read source against the NEAR smart contract security checklist, NEP standards and NEAR AI / Chain Signatures controls. Do not fetch external pages from the sandbox.',
    'Checklist: https://docs.near.org/smart-contracts/security/checklist',
    'Grep cannot close: a public method, CKD wrapper or yield-resume handler with no caller check, optimistic internal credit before deposit-notification hooks settle (sum(internal_balances) <= escrowed), state clobbered by snapshot rollback or DeleteAccount push-payout DoS, callback abort via the 16 KB cumulative receipt-log cap or gas starvation, ecrecover malleability, storage-shrinkage refund theft, shared Chain Signature derivation paths, unverified NEP-413 FullAccess key ownership, or bypassed TEE codehash checks. Those are a source read.',
    'Do not deploy, do not run near-sandbox, do not call NEAR RPC, the faucet, NEAR AI Cloud, 1Click, the Intents agent API, OutLayer, Phala/Dstack, or NEAR MCP, and do not read the near CLI keychain.',
    `Kinds: ${[...kinds].join(', ') || 'unspecified'}. Contracts: ${contract ? 'yes' : 'no'}. Marks: ${(eco?.marks || []).join(', ') || 'none'}.`,
    ...nearVersions(root, contract),
    `Files scanned: ${files}. Leads listed: ${total} (capped at ${PER_PATTERN} per pattern).`,
    '',
    parts.join('\n'),
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
