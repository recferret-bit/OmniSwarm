// The NEAR and NEAR AI checklist (audit-plans-data-near.mjs), lead patterns, and writeNear behavior:
// coverage of contracts, NEP standards, Chain Signatures, Intents, Shade Agents / TEE attestation and NEAR AI Cloud,
// routing by surface and detected NEAR kind, and strict positive/negative lead matching without cross-chain noise.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NEAR_CHECKS, NEAR_GROUPS, nearSurfaceLines } from './audit-plans-data-near.mjs';
import { analyzeStackAndPlans, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { evidencePanels } from './generate-html-report-evidence.mjs';
import { callBridgeTool } from './docker-mcp-bridge.mjs';
import { layerOfPath } from './harness-layers.mjs';
import { writeConfig, writeNear } from './harness-leads.mjs';
import { NEAR_CLIENT_PATTERNS, NEAR_CONTRACT_PATTERNS } from './harness-patterns-chain.mjs';
import { readHarnessContext } from './orchestrator-prompts.mjs';
import { REVIEW_WORKFLOW, buildExistingTestCatalog } from './review-workflow.mjs';
import { detectEcosystems } from './stack-detect.mjs';

const hits = (list, id, text) => { const { re } = list.find((p) => p.id === id); re.lastIndex = 0; return re.test(text); };
const contract = (id, text) => hits(NEAR_CONTRACT_PATTERNS, id, text);
const client = (id, idText) => hits(NEAR_CLIENT_PATTERNS, id, idText);

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'near-plans-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

test('the checklist covers every NEAR and NEAR AI group with bounded, surface-assigned rows', () => {
  for (const id of ['AUTH', 'CRYPTO', 'ASYNC', 'YIELD', 'STATE', 'STORAGE', 'MATH', 'CHAINSIG', 'BUILD', 'WALLET', 'INTENTS', 'AI']) {
    assert.ok(NEAR_CHECKS.some((row) => row.group === id), `no check for ${id}`);
  }
  for (const row of NEAR_CHECKS) {
    assert.ok(NEAR_GROUPS[row.group], row.group);
    assert.match(row.surface, /^S[1-6]$/);
    assert.ok(['contract', 'client', 'intents', 'ai'].includes(row.kind), row.kind);
    assert.ok(row.text.length > 60 && row.text.length < 520, `${row.group} (${row.surface}): ${row.text.length} chars`);
  }
});

test('the checklist describes defensive controls and sandbox limits, never exploitation', () => {
  const text = NEAR_CHECKS.map((row) => row.text).join('\n');
  assert.doesNotMatch(text, /\b(?:exploit\s+payload|proof of concept|PoC|attack script|drain it|send a transaction)\b/i);
  for (const required of [
    'Do not install',
    'were not executed: say so as a coverage gap',
    '16,384 bytes',
    'max_total_log_length',
    'max_number_logs',
    'sum(internal_balances) <= actual_escrowed_tokens',
    'unaudited published library, not a deprecated package',
    '2147484061',
    'promise_yield_resume',
    'malleability_flag = true',
    'ed25519_verify',
    'bls12381_p1_sum',
    'alt_bn128_',
    'request_app_private_key',
    'CKDRequestArgs',
    'domain_id = 2',
    'verify_foreign_transaction',
    'v1.signer',
    'public in receipt outcomes',
    'AccountDoesNotExist',
    'promise_results_count',
    'EVENT_JSON:',
    'sender_id == receiver_id',
    'storage-refund theft',
    'cache aliasing',
    'SignedDelegate',
    'U128',
    'codehash',
    '/v1/attestation/report',
  ]) {
    assert.ok(text.includes(required), `missing "${required}"`);
  }
});

test('each surface gets only the rows of the NEAR kinds detected in the target', () => {
  for (const code of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    const lines = nearSurfaceLines(code, ['contract']);
    assert.ok(lines.length > 0, `contract ${code}`);
    assert.ok(lines.every((line) => line.startsWith('- NEAR contract [')));
  }
  assert.deepEqual(nearSurfaceLines('S6', ['contract']), []);

  for (const code of ['S1', 'S4', 'S6']) {
    const lines = nearSurfaceLines(code, ['client']);
    assert.ok(lines.length > 0, `client ${code}`);
    assert.ok(lines.every((line) => line.startsWith('- NEAR client [')));
  }
  assert.deepEqual(nearSurfaceLines('S2', ['client']), []);
  assert.deepEqual(nearSurfaceLines('S3', ['client']), []);
  assert.deepEqual(nearSurfaceLines('S5', ['client']), []);

  for (const code of ['S1', 'S2', 'S3', 'S6']) {
    const lines = nearSurfaceLines(code, ['intents']);
    assert.ok(lines.length > 0, `intents ${code}`);
    assert.ok(lines.every((line) => line.startsWith('- NEAR Intents [')));
  }
  assert.deepEqual(nearSurfaceLines('S4', ['intents']), []);
  assert.deepEqual(nearSurfaceLines('S5', ['intents']), []);

  for (const code of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
    const lines = nearSurfaceLines(code, ['ai']);
    assert.ok(lines.length > 0, `ai ${code}`);
    assert.ok(lines.every((line) => line.startsWith('- NEAR AI [')));
  }

  assert.deepEqual(nearSurfaceLines('S3', []), []);
  assert.deepEqual(nearSurfaceLines('S9'), []);
});

test('contract leads match risky NEAR, Chain Signatures, yield-resume, global-contract and TEE forms and skip safe idioms', () => {
  assert.equal(new Set(NEAR_CONTRACT_PATTERNS.map((p) => p.id)).size, NEAR_CONTRACT_PATTERNS.length);
  assert.equal(new Set(NEAR_CLIENT_PATTERNS.map((p) => p.id)).size, NEAR_CLIENT_PATTERNS.length);

  assert.ok(contract('ft-entry', 'pub fn mt_resolve_deposit(&mut self, amount: U128) -> U128 {'));
  assert.ok(contract('ft-entry', 'pub fn mt_on_transfer(&mut self, sender_id: AccountId) -> Vec<U128> {'));
  assert.ok(contract('ft-entry', 'pub fn nft_on_transfer(&mut self, sender_id: AccountId) -> bool {'));
  assert.equal(contract('ft-entry', 'pub fn credit_deposit(&mut self, amount: U128) {'), false);

  assert.ok(contract('yield-resume', 'let id = env::promise_yield_create("on_answer", &args, gas, weight, 0);'));
  assert.ok(contract('yield-resume', 'env::promise_yield_resume(&yield_id, &bytes);'));
  assert.equal(contract('yield-resume', 'Promise::new(account).transfer(amount);'), false);

  assert.ok(contract('mpc-sign-call', 'let mpc: AccountId = "v1.signer".parse().unwrap();'));
  assert.ok(contract('mpc-sign-call', 'let mpc: AccountId = "v1.signer-prod.testnet".parse().unwrap();'));
  assert.ok(contract('mpc-sign-call', 'ext_signer::ext(signer).sign(request)'));
  assert.ok(contract('mpc-sign-call', 'let req = SignRequest { payload, path, key_version: 0 };'));
  assert.ok(contract('mpc-sign-call', 'let ckd = CKDRequestArgs { derivation_path, app_public_key, domain_id: 2 };'));
  assert.ok(contract('mpc-sign-call', 'ext_mpc::ext(id).request_app_private_key(args)'));
  assert.ok(contract('mpc-sign-call', 'ext_mpc::ext(id).verify_foreign_transaction(req)'));
  assert.equal(contract('mpc-sign-call', 'let caller = env::signer_account_id();'), false);

  assert.ok(contract('near-crypto-verify', 'let pk = env::ecrecover(&hash, &sig, v, false);'));
  assert.ok(contract('near-crypto-verify', 'let pk = ecrecover(&hash, &sig, v, false);'));
  assert.ok(contract('near-crypto-verify', 'env::ed25519_verify(&sig, &msg, &pk);'));
  assert.ok(contract('near-crypto-verify', 'let ok = env::bls12381_pairing_check(&buf);'));
  assert.ok(contract('near-crypto-verify', 'let ok = env::alt_bn128_pairing_check(&buf);'));
  assert.equal(contract('near-crypto-verify', 'let digest = env::sha256(&msg);'), false);

  assert.ok(contract('dynamic-gas-or-and', 'let rem = env::prepaid_gas().saturating_sub(env::used_gas());'));
  assert.ok(contract('dynamic-gas-or-and', 'for i in 0..env::promise_results_count() {}'));
  assert.ok(contract('dynamic-gas-or-and', 'p1.and(Promise::new(other))'));
  assert.ok(contract('dynamic-gas-or-and', 'p1.and(p2).then(Self::ext(env::current_account_id()).on_both())'));
  assert.equal(contract('dynamic-gas-or-and', 'const CALLBACK_GAS: Gas = Gas::from_tgas(20);'), false);

  assert.ok(contract('storage-usage-refund', 'let before = env::storage_usage();'));
  assert.equal(contract('storage-usage-refund', 'let cost = env::storage_byte_cost();'), false);

  assert.ok(contract('nep297-event-format', 'env::log_str(&format!("EVENT_JSON:{{\\"standard\\":\\"nep141\\",\\"memo\\":\\"{memo}\\"}}"));'));
  assert.ok(contract('nep297-event-format', 'env::log_str(&format!(r#"EVENT_JSON:{{"standard":"nep141","memo":"{memo}"}}"#));'));
  assert.equal(contract('nep297-event-format', 'env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&ev).unwrap()));'), false);

  assert.ok(contract('self-deploy-or-key', 'Promise::new(env::current_account_id()).deploy_contract(code)'));
  assert.ok(contract('self-deploy-or-key', 'Promise::new(id).use_global_contract_by_account_id(publisher)'));
  assert.ok(contract('self-deploy-or-key', 'Promise::new(id).add_full_access_key(pk)'));
  assert.equal(contract('self-deploy-or-key', 'Promise::new(id).add_access_key_allowance(pk, allowance, receiver, methods)'), false);

  assert.ok(contract('account-balance-accounting', 'let share = env::account_balance();'));
  assert.equal(contract('account-balance-accounting', 'let attached = env::attached_deposit();'), false);

  assert.ok(contract('storage-unregister', 'pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {'));
  assert.equal(contract('storage-unregister', 'pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {'), false);

  assert.ok(contract('tee-attestation-verify', 'pub fn register_worker(&mut self, quote_hex: String, codehash: String) {'));
  assert.ok(contract('tee-attestation-verify', 'use shade_attestation::attestation::DstackAttestation;'));
  assert.equal(contract('tee-attestation-verify', 'pub fn register_user(&mut self, handle: String) {'), false);

  assert.ok(contract('unbounded-log-or-iter', 'let all: Vec<_> = self.accounts.iter().collect();'));
  assert.ok(contract('unbounded-log-or-iter', 'for (k, v) in self.accounts.iter() { total += v; }'));
  assert.ok(contract('unbounded-log-or-iter', 'env::log_str(&format!("refunding {accounts:?}"));'));
  assert.equal(contract('unbounded-log-or-iter', 'items.iter().skip(from).take(limit).copied().collect::<Vec<_>>()'), false);
  assert.equal(contract('unbounded-log-or-iter', 'env::log_str("settled");'), false);

  assert.ok(contract('storage-prefix', 'LookupMap::new(b"m")'));
  assert.ok(contract('storage-prefix', "LookupMap::new(b'a')"));
  assert.ok(contract('storage-prefix', 'LookupMap::with_hasher(b"m")'));
  assert.equal(contract('storage-prefix', 'LookupMap::new(StorageKey::Balances)'), false);

  assert.ok(contract('callback-shaped', 'pub fn on_withdraw(&mut self) {'));
  assert.ok(contract('callback-shaped', '#[payable]\npub fn on_withdraw(&mut self) {'));
  assert.equal(contract('callback-shaped', '#[private]\npub fn on_withdraw(&mut self) {'), false);
  assert.equal(contract('callback-shaped', '#[private]\n#[handle_result]\npub fn on_withdraw(&mut self) -> Result<(), String> {'), false);
});

test('client, near-sdk-js, NEP-413, NEP-366, Intents and NEAR AI leads match NEAR idioms without firing on EVM, Solana or WebCrypto', () => {
  assert.ok(client('nep413-sign-message', "await wallet.signMessage({ message, recipient: 'app.near', nonce });"));
  assert.ok(client('nep413-sign-message', `await wallet.signMessage({\n  message: '${'x'.repeat(280)}',\n  meta: { nested: true },\n  nonce,\n  recipient: 'app.near',\n});`));
  assert.ok(client('nep413-sign-message', 'const TAG = 2147484061;'));
  assert.equal(client('nep413-sign-message', 'await signer.signMessage(encodedBytes);'), false);

  assert.ok(client('near-sdk-js-contract', '@NearBindgen({ requireInit: true })\nexport class Vault {'));
  assert.ok(client('near-sdk-js-contract', 'const caller = near.signerAccountId();'));
  assert.equal(client('near-sdk-js-contract', 'const caller = near.predecessorAccountId();'), false);

  assert.ok(client('nep366-delegate-action', 'actionCreators.signedDelegate({ delegateAction, signature })'));
  assert.ok(client('nep366-delegate-action', 'const d = buildDelegateAction({ senderId, receiverId, actions });'));
  assert.equal(client('nep366-delegate-action', "actionCreators.functionCall('tip', {}, gas, deposit)"), false);

  assert.ok(client('localstorage-keystore', 'new keyStores.BrowserLocalStorageKeyStore()'));
  assert.ok(client('localstorage-keystore', "import { parseSeedPhrase } from 'near-seed-phrase';"));
  assert.equal(client('localstorage-keystore', 'new keyStores.InMemoryKeyStore()'), false);

  assert.ok(client('tee-tappd-socket', "const client = new DstackClient('/var/run/dstack.sock');"));
  assert.ok(client('tee-tappd-socket', "fetch('https://cloud-api.near.ai/v1/attestation/report?nonce=' + nonce)"));
  assert.equal(client('tee-tappd-socket', 'await crypto.subtle.deriveKey(alg, baseKey, derivedType, false, ["encrypt"]);'), false);

  assert.ok(client('near-ai-host', "import { NearAI } from '@nearai/inference-sdk';"));
  assert.ok(client('near-ai-host', "import { verify } from 'nearai-cloud-verifier';"));
  assert.equal(client('near-ai-host', "fetch('https://api.openai.com/v1/chat/completions')"), false);

  assert.ok(client('chain-sig-contract', "import { chainAdapters } from 'chainsig.js';"));
  assert.ok(client('chain-sig-contract', "const contract = 'v1.signer-prod.testnet';"));
  assert.ok(client('chain-sig-contract', "await contract.request_app_private_key({ derivation_path: 'agent', app_public_key });"));
  assert.equal(client('chain-sig-contract', 'const signer = provider.getSigner();'), false);

  assert.ok(client('intents-host', "const verifier = 'intents.near';"));
  assert.equal(client('intents-host', "const userIntent = 'swap';"), false);
});

test('writeNear scans Python NEAR AI agents, flags legacy near-sdk <5 and shade-attestation, and stays absent on non-NEAR repos', (t) => {
  const pyAgent = tree(t, {
    'requirements.txt': 'nearai-cloud-verifier==0.2.0\npy-near==1.1.50\n',
    'app/agent.py': ' ATTEST = "https://cloud-api.near.ai/v1/attestation/report"\nSOCK = "/var/run/dstack.sock"\n',
  });
  const pyEco = detectEcosystems(pyAgent);
  assert.equal(pyEco.near.detected, true);
  assert.deepEqual(pyEco.near.kinds, ['ai', 'client']);
  const pyLeads = writeNear(pyAgent, pyEco.near);
  assert.ok(pyLeads.leads >= 2);
  assert.match(pyLeads.body, /## near-ai-host /);
  assert.match(pyLeads.body, /## tee-tappd-socket /);

  const legacyShade = tree(t, {
    'Cargo.toml': '[package]\nname = "agent"\nversion = "0.1.0"\n[dependencies]\nnear-sdk = "4.1.1"\nshade-attestation = "0.1.0"\n',
    'src/lib.rs': 'pub fn register_worker(quote: String) {}\n',
  });
  const shadeEco = detectEcosystems(legacyShade);
  assert.deepEqual(shadeEco.near.kinds, ['ai', 'contract']);
  const shadeLeads = writeNear(legacyShade, shadeEco.near);
  assert.match(shadeLeads.body, /shade-attestation 0\.1\.0/);
  assert.match(shadeLeads.body, /legacy near-sdk <5/);
  assert.match(shadeLeads.body, /## tee-attestation-verify /);

  const nonNear = tree(t, {
    'package.json': '{"dependencies":{"express":"^4.19.0","viem":"^2.0.0"}}',
    'src/index.ts': 'export async function sign(s: any, b: Uint8Array) { return s.signMessage(b); }\n',
  });
  const nonNearEco = detectEcosystems(nonNear);
  assert.equal(nonNearEco.near.detected, false);
  assert.match(writeNear(nonNear, nonNearEco.near).body, /NEAR surface absent/);
});

test('edge cases: empty dir, malformed manifests, v1.signer lead without stack mark, and shade-attestation cargo test preservation', (t) => {
  const empty = tree(t, {});
  const emptyEco = detectEcosystems(empty);
  assert.equal(emptyEco.near.detected, false);
  assert.deepEqual(writeNear(empty, emptyEco.near), {
    leads: 0,
    files: 0,
    body: '# NEAR leads\n\nNo production near-sdk Cargo.toml and no production manifest for near-api-js, NEAR Wallet Selector, NEAR Connect, Chain Signatures, NEAR Intents, or NEAR AI. NEAR surface absent.\n',
  });

  // Malformed manifests do not crash stack detection or writeNear; v1.signer in production source emits a lead without marking the stack.
  const partial = tree(t, {
    'package.json': '{broken json',
    'Cargo.toml': '[package\nbroken',
    'src/mpc.ts': "export const SIGNER = 'v1.signer';\n",
  });
  const partialEco = detectEcosystems(partial);
  assert.equal(partialEco.near.detected, false);
  const partialLeads = writeNear(partial, partialEco.near);
  assert.equal(partialLeads.leads, 1);
  assert.match(partialLeads.body, /## chain-sig-contract /);

  // A standalone Rust crate using shade-attestation (without near-sdk) still gets its offline cargo test;
  // a near-sdk + shade-attestation cdylib contract skips cargo test and runs near-build + near-clippy.
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const makeCatalog = (files) => {
    const dir = tree(t, files);
    const entries = Object.entries(files).map(([p, text]) => ({ path: p, sha256: sha(text), bytes: Buffer.byteLength(text) }));
    return buildExistingTestCatalog(dir, { digest: sha(JSON.stringify(entries)), files: entries });
  };
  const verifierOnly = makeCatalog({
    'Cargo.toml': '[package]\nname = "verifier"\nversion = "0.1.0"\n[dependencies]\nshade-attestation = "0.1.0"\n',
    'src/lib.rs': 'pub fn verify() {}\n',
  });
  assert.deepEqual(verifierOnly.tests.map((row) => row.kind), ['cargo']);
  assert.deepEqual(verifierOnly.coverageGaps, []);

  const shadeContract = makeCatalog({
    'Cargo.toml': '[package]\nname = "agent"\nversion = "0.1.0"\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nnear-sdk = "5.6.0"\nshade-attestation = "0.1.0"\n',
    'src/lib.rs': 'pub fn register_worker() {}\n',
  });
  assert.deepEqual(shadeContract.tests.map((row) => row.kind), ['near-build', 'near-clippy']);
  assert.ok(shadeContract.coverageGaps.some((gap) => /local-sandbox coverage gap/.test(gap)));

  // near-sdk-js + near-workspaces / near-sandbox and Rust near-workspaces crates record local-sandbox coverage gaps instead of running offline.
  const jsContract = makeCatalog({
    'package.json': JSON.stringify({ scripts: { test: 'ava' }, dependencies: { 'near-sdk-js': '^2.0.0' }, devDependencies: { 'near-workspaces': '^4.1.0' } }),
    'src/contract.ts': "import { NearBindgen, near } from 'near-sdk-js';\n",
  });
  assert.deepEqual(jsContract.tests, []);
  assert.ok(jsContract.coverageGaps.some((gap) => /near-workspaces/.test(gap)));

  const nearSandboxPkg = makeCatalog({
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { 'near-sandbox': '^2.5.0', vitest: '^2.0.0' } }),
  });
  assert.deepEqual(nearSandboxPkg.tests, []);
  assert.ok(nearSandboxPkg.coverageGaps.some((gap) => /near-sandbox/.test(gap)));

  const rustWorkspacesSuite = makeCatalog({
    'Cargo.toml': '[workspace]\nmembers = ["crates/client", "integration-tests"]\n',
    'crates/client/Cargo.toml': '[package]\nname = "client"\nversion = "0.1.0"\n[dependencies]\nnear-crypto = "0.28.0"\nnear-jsonrpc-client = "0.15.0"\n',
    'crates/client/src/lib.rs': 'pub fn sign() {}\n',
    'integration-tests/Cargo.toml': '[package]\nname = "it"\nversion = "0.1.0"\n[dependencies]\nnear-workspaces = "0.21.0"\n',
    'integration-tests/src/lib.rs': 'pub fn test_it() {}\n',
  });
  assert.deepEqual(rustWorkspacesSuite.tests.map((row) => `${row.kind}:${row.cwd}`), ['cargo:crates/client']);
  assert.ok(rustWorkspacesSuite.coverageGaps.some((gap) => /NEAR contract tests in integration-tests/.test(gap)));
  assert.ok(rustWorkspacesSuite.coverageGaps.some((gap) => /NEAR contract tests in \./.test(gap)));
});

test('non-NEAR Phala Dstack / EVM repos do not wake near.md, while Shade Agent compose files emit infra TEE leads', (t) => {
  const evmPhala = tree(t, {
    'package.json': JSON.stringify({ description: 'Unrelated to near-api-js', homepage: 'https://example.com/@near-js/docs', dependencies: { viem: '^2.0.0', '@phala/dstack-sdk': '^0.2.0' } }),
    'src/enclave.ts': "import { DstackClient } from '@phala/dstack-sdk';\nconst c = new DstackClient('/var/run/dstack.sock');\nexport interface SignedDelegate { id: string }\n",
    'docker-compose.yml': 'services:\n  worker:\n    image: app:1.0@sha256:1111111111111111111111111111111111111111111111111111111111111111\n    volumes:\n      - /var/run/dstack.sock:/var/run/dstack.sock\n',
  });
  const eco = detectEcosystems(evmPhala);
  assert.equal(eco.near.detected, false);
  assert.equal(eco.evm.detected, true);
  assert.match(writeNear(evmPhala, eco.near).body, /NEAR surface absent/);
  assert.match(writeConfig(evmPhala).body, /## tee-enclave-sock[\s\S]*docker-compose\.yml:5/);
});

test('--scope web3 and --scope web2 both work cleanly across NEAR AI SDK files, Python PEP-503 packages, and pure HTTP callers', async (t) => {
  // 1. SDK-based NEAR AI + subpath imports + Python PEP-503 underscore packages classify into web3 and pass --scope web3 submit.
  const sdkRepo = tree(t, {
    'web/package.json': JSON.stringify({ dependencies: { '@nearai/inference-sdk': '^0.1.0', 'near-api-js': '^5.0.0', '@phala/dstack-sdk': '^0.2.0' } }),
    'web/src/ai.ts': "import { InferenceClient } from '@nearai/inference-sdk/node';\nimport { KeyPair } from 'near-api-js/lib/utils';\n",
    'agent/pyproject.toml': '[project]\nname = "agent"\ndependencies = ["py_near==1.1.50", "nearai_cloud_verifier==0.2.0"]\n',
    'agent/app/worker.py': 'from py_near.account import Account\nimport nearai_cloud_verifier\n',
    'Cargo.toml': '[workspace]\nmembers = ["contracts/agent"]\n[workspace.dependencies]\nnear_sdk = { package = "near-sdk", version = "5.6.0" }\ndcap = { package = "dcap-qvl", version = "0.1.0" }\n',
    'contracts/agent/Cargo.toml': '[package]\nname = "agent"\n[dependencies]\nnear_sdk.workspace = true\n[target.\'cfg(target_arch = "wasm32")\'.dependencies]\ndcap.workspace = true\n',
    'contracts/agent/src/lib.rs': 'pub fn register_worker() {}\n',
  });
  const sdkProfile = analyzeStackAndPlans(sdkRepo);
  assert.deepEqual(sdkProfile.ecosystems.near.kinds, ['ai', 'client', 'contract']);
  assert.ok(sdkProfile.detectedStacks.includes('crypto'));
  assert.equal(layerOfPath('web/src/ai.ts', sdkProfile.layers), 'web3');
  assert.equal(layerOfPath('agent/app/worker.py', sdkProfile.layers), 'web3');
  assert.equal(layerOfPath('contracts/agent/src/lib.rs', sdkProfile.layers), 'web3');

  const reportDir = tree(t, { 'harness/stack-profile.json': JSON.stringify(sdkProfile), 'harness/near.md': '# NEAR leads\n- web/src/ai.ts:1\n' });
  const identity = { name: 'claude-s3-logic', agent: 'claude', role: 'auditor', workflow: REVIEW_WORKFLOW, surface: 'S3', model: 'fixture', sourceDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64) };
  await callBridgeTool(
    { reportDir, role: 'auditor', auditor: 'claude-s3-logic', surface: 'S3', scope: 'web3', submissionIdentity: identity },
    'submit_audit_report',
    {
      findings: [{ title: 'Unverified NEAR AI response signature', surface: 'S3', severity: 'medium', confidence: 'confirmed', location: ['web/src/ai.ts:1'], impact: 'i', preconditions: 'p', analysis: 'a', validation: 'v', fix: 'f' }],
      verified_safe: [],
      markdown_summary: 'Reviewed web3 NEAR AI SDK and contract files.',
    },
  );

  const fullReport = tree(t, { 'harness/stack-profile.json': JSON.stringify(sdkProfile), 'harness/near.md': writeNear(sdkRepo, sdkProfile.ecosystems.near).body });
  assert.match(readHarnessContext(fullReport, 'S6', 'full'), /### NEAR Leads[\s\S]*web\/src\/ai\.ts:1/);

  // 2. Pure web2 HTTP caller of cloud-api.near.ai (no NEAR SDK import, so file stays web2) still gets NEAR AI guidance and near.md under --scope web2.
  const web2AiRepo = tree(t, {
    'package.json': JSON.stringify({ dependencies: { express: '^4.19.0' }, scripts: { start: 'NEARAI_BASE=https://cloud-api.near.ai/v1 node src/chat.js' } }),
    'src/chat.js': "const express = require('express');\nfetch('https://cloud-api.near.ai/v1/chat/completions');\n",
  });
  const web2AiProfile = analyzeStackAndPlans(web2AiRepo);
  assert.deepEqual(web2AiProfile.ecosystems.near.kinds, ['ai']);
  assert.equal(layerOfPath('src/chat.js', web2AiProfile.layers), 'web2');
  const web2Guidance = renderSurfaceSkillGuidance('S3', web2AiProfile, 'web2');
  assert.match(web2Guidance, /- NEAR AI \[NEAR AI Cloud, Shade Agents and TEEs\]:.*\/v1\/attestation\/report/);
  // Full-scope run does not duplicate NEAR AI rows across Web2 and Web3 blocks.
  const fullGuidance = renderSurfaceSkillGuidance('S3', web2AiProfile, 'full');
  assert.equal((fullGuidance.match(/\/v1\/attestation\/report/g) || []).length, 1);
  const web2Report = tree(t, { 'harness/stack-profile.json': JSON.stringify(web2AiProfile), 'harness/near.md': writeNear(web2AiRepo, web2AiProfile.ecosystems.near).body });
  assert.match(readHarnessContext(web2Report, 'S3', 'web2'), /### NEAR Leads[\s\S]*src\/chat\.js:2/);

  // 3. OpenAI-SDK / HTTP caller of cloud-api.near.ai, outlayer.fastnear.com or 1click.chaindefuser.com WITH NO NEAR
  // package in package.json (so profile.ecosystems.near.kinds is []) STILL receives near.md under --scope web2,
  // while a pure web3 contract repo with no web2 NEAR leads does NOT leak near.md into --scope web2.
  const openAiNearRepo = tree(t, {
    'package.json': JSON.stringify({ dependencies: { openai: '^4.52.0', express: '^4.19.0' } }),
    'src/llm.ts': "import OpenAI from 'openai';\nexport const ai = new OpenAI({ baseURL: 'https://cloud-api.near.ai/v1', apiKey: process.env.NEARAI_API_KEY });\nexport const job = 'https://outlayer.fastnear.com/v1/run';\nexport const quote = 'https://1click.chaindefuser.com/v0/quote';\n",
  });
  const openAiNearProfile = analyzeStackAndPlans(openAiNearRepo);
  assert.deepEqual(openAiNearProfile.ecosystems.near.kinds, []);
  assert.equal(layerOfPath('src/llm.ts', openAiNearProfile.layers), 'web2');
  const openAiNearLeads = writeNear(openAiNearRepo, openAiNearProfile.ecosystems.near);
  assert.ok(openAiNearLeads.leads >= 3);
  const openAiNearReport = tree(t, { 'harness/stack-profile.json': JSON.stringify(openAiNearProfile), 'harness/near.md': openAiNearLeads.body });
  const openAiWeb2Ctx = readHarnessContext(openAiNearReport, 'S3', 'web2');
  assert.match(openAiWeb2Ctx, /### NEAR Leads[\s\S]*src\/llm\.ts:2/);
  assert.match(openAiWeb2Ctx, /src\/llm\.ts:3/);
  assert.match(openAiWeb2Ctx, /src\/llm\.ts:4/);
  const bridgeWeb2Ctx = await callBridgeTool({ reportDir: openAiNearReport, role: 'auditor', surface: 'S3', scope: 'web2', container: 'inert' }, 'get_audit_context', {});
  assert.match(bridgeWeb2Ctx, /## NEAR Leads[\s\S]*src\/llm\.ts:2/);
  assert.ok(openAiNearProfile.detectedStacks.includes('crypto'));

  // 3b. Hybrid repo with >6,000 bytes of web3 Rust contract leads at the top of near.md + a web2 cloud-api.near.ai lead
  // at the bottom: under --scope web2, neither readHarnessContext nor get_audit_context truncates the web2 lead.
  const bigContractLines = Array.from({ length: 45 }, (_, i) => `pub fn on_cb_${i}(&mut self, a: u128) { let _ = (env::signer_account_id(), env::promise_result(0), env::account_balance(), a.wrapping_add(1)); }`).join('\n');
  const hybridOverflowRepo = tree(t, {
    'package.json': JSON.stringify({ dependencies: { openai: '^4.52.0' } }),
    'backend/src/llm.ts': "import OpenAI from 'openai';\nexport const ai = new OpenAI({ baseURL: 'https://cloud-api.near.ai/v1' });\n",
    'contracts/vault/Cargo.toml': '[package]\nname = "vault"\n[dependencies]\nnear-sdk = "5.6.0"\n',
    'contracts/vault/src/lib.rs': `${bigContractLines}\n`,
  });
  const hybridProfile = analyzeStackAndPlans(hybridOverflowRepo);
  const hybridNearMd = writeNear(hybridOverflowRepo, hybridProfile.ecosystems.near).body;
  assert.ok(hybridNearMd.length > 7000, `expected >7000 chars, got ${hybridNearMd.length}`);
  const hybridReport = tree(t, { 'harness/stack-profile.json': JSON.stringify(hybridProfile), 'harness/near.md': hybridNearMd });
  const hybridPromptNear = readHarnessContext(hybridReport, 'S3', 'web2').split('### NEAR Leads')[1] || '';
  assert.match(hybridPromptNear, /backend\/src\/llm\.ts:2/);
  assert.doesNotMatch(hybridPromptNear, /contracts\/vault\/src\/lib\.rs/);
  const hybridBridgeNear = (await callBridgeTool({ reportDir: hybridReport, role: 'auditor', surface: 'S3', scope: 'web2', container: 'inert' }, 'get_audit_context', {})).split('## NEAR Leads')[1] || '';
  assert.match(hybridBridgeNear, /backend\/src\/llm\.ts:2/);
  assert.doesNotMatch(hybridBridgeNear, /contracts\/vault\/src\/lib\.rs/);

  // 3c. Off-chain Rust NEAR crates (near-crypto / near-primitives / near-api / near-jsonrpc-client) and @tappd/sdk classify cleanly,
  // and pure Rust web2 services calling cloud-api.near.ai wake near.md.
  const rustClientRepo = tree(t, {
    'relayer/Cargo.toml': '[package]\nname = "relayer"\nversion = "0.1.0"\n[dependencies]\nnear-crypto = "0.28.0"\nnear-primitives = "0.28.0"\n',
    'relayer/src/lib.rs': 'pub const TAG: u32 = 2147484061;\n',
    'enclave/src/worker.ts': "import { TappdClient } from '@tappd/sdk';\nexport const c = new TappdClient();\n",
  });
  const rustClientProfile = analyzeStackAndPlans(rustClientRepo);
  assert.equal(rustClientProfile.ecosystems.near.detected, true);
  assert.equal(rustClientProfile.ecosystems.near.contracts, false);
  assert.deepEqual(rustClientProfile.ecosystems.near.kinds, ['client']);
  assert.equal(layerOfPath('relayer/src/lib.rs', rustClientProfile.layers), 'web3');
  assert.equal(layerOfPath('enclave/src/worker.ts', rustClientProfile.layers), 'web3');
  assert.match(writeNear(rustClientRepo, rustClientProfile.ecosystems.near).body, /near-crypto 0\.28\.0[\s\S]*## nep413-sign-message[\s\S]*relayer\/src\/lib\.rs:1/);

  const rustWeb2Ai = tree(t, {
    'Cargo.toml': '[package]\nname = "api"\nversion = "0.1.0"\n[dependencies]\naxum = "0.7"\n',
    'src/main.rs': 'const URL: &str = "https://cloud-api.near.ai/v1/attestation/report";\n',
  });
  const rustWeb2Profile = analyzeStackAndPlans(rustWeb2Ai);
  assert.equal(rustWeb2Profile.ecosystems.near.detected, false);
  assert.match(writeNear(rustWeb2Ai, rustWeb2Profile.ecosystems.near).body, /## near-ai-host[\s\S]*src\/main\.rs:1/);

  const contractOnlyRepo = tree(t, {
    'package.json': JSON.stringify({ dependencies: { express: '^4.19.0' } }),
    'src/server.js': "const express = require('express');\nexpress().get('/health', (_req, res) => res.send('ok'));\n",
    'contracts/vault/Cargo.toml': '[package]\nname = "vault"\n[dependencies]\nnear-sdk = "5.6.0"\n',
    'contracts/vault/src/lib.rs': 'pub fn on_withdraw() { let _ = env::signer_account_id(); }\n',
  });
  const contractOnlyProfile = analyzeStackAndPlans(contractOnlyRepo);
  const contractOnlyReport = tree(t, {
    'harness/stack-profile.json': JSON.stringify(contractOnlyProfile),
    'harness/near.md': writeNear(contractOnlyRepo, contractOnlyProfile.ecosystems.near).body,
  });
  assert.doesNotMatch(readHarnessContext(contractOnlyReport, 'S1', 'web2'), /### NEAR Leads/);
  assert.match(readHarnessContext(contractOnlyReport, 'S1', 'web3'), /### NEAR Leads[\s\S]*contracts\/vault\/src\/lib\.rs:1/);

  // 4. [CRYPTO] domain markers & leads cover near-ai-cloud, nearai, dstack_sdk, TappdClient, and NEAR crypto host calls.
  const cryptoMarkersRepo = tree(t, {
    'agent/worker.py': 'import dstack_sdk\nimport nearai\nclient = TappdClient()\n',
    'web/sdk.ts': "import 'near-ai-cloud';\n",
    'contracts/verifier/src/lib.rs': 'pub fn verify(h: [u8; 32], s: [u8; 64], b: Vec<u8>) { let _ = env::ecrecover(&h, &s, 0, true); let _ = env::bls12381_pairing_check(&b); let _ = env::alt_bn128_pairing_check(&b); request_app_private_key(); }\n',
  });
  const cryptoProfile = analyzeStackAndPlans(cryptoMarkersRepo);
  const cryptoDom = cryptoProfile.domains.find((d) => d.id === 'crypto');
  assert.equal(cryptoDom.detected, true);
  for (const cite of ['agent/worker.py:1', 'agent/worker.py:2', 'agent/worker.py:3', 'web/sdk.ts:1', 'contracts/verifier/src/lib.rs:1']) {
    assert.ok(cryptoDom.markerHits.some((m) => m.startsWith(cite)), `missing [CRYPTO] marker at ${cite}: ${cryptoDom.markerHits.join(', ')}`);
  }
  const sigLeadHits = cryptoDom.leads.find((l) => l.id === 'crypto-sig-challenge').hits.map((h) => h.citation);
  assert.ok(sigLeadHits.includes('contracts/verifier/src/lib.rs:1'));
});

test('HTML report stack coverage preserves npm/pytest/cargo suites and near-workspaces notes across NEAR repo shapes', (t) => {
  const renderHtml = (profile, catalog, verificationSuites = [], testNotes = []) => evidencePanels({
    complete: true,
    reviewComplete: true,
    sourceLine: 'fixture',
    meta: { isolation: {} },
    workerJobs: [],
    sandboxRows: [],
    sandboxMd: '',
    verifiedSafe: [],
    diagrams: [],
    profile,
    catalog,
    health: {
      errors: [],
      verification: { suites: verificationSuites, gaps: testNotes },
    },
  }, []);
  const nearRowOf = (html) => (html.match(/<tr><td><b>NEAR<\/b>[\s\S]*?<\/tr>/) || [''])[0];

  // 1. Full-stack repo (nearRust = true + unrelated root Express npm suite + Node near-api-js npm suite + Python nearai pytest suite + unrelated Solana cargo failure).
  const fullstackNear = tree(t, {
    'package.json': JSON.stringify({ scripts: { test: 'vitest root' }, dependencies: { express: '^4.19.0' } }),
    'contracts/vault/Cargo.toml': '[package]\nname = "vault"\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nnear-sdk = "5.6.0"\n',
    'contracts/vault/src/lib.rs': 'pub fn init() {}\n',
    'programs/sol/Cargo.toml': '[package]\nname = "sol"\n[dependencies]\nanchor-lang = "0.30.1"\n',
    'programs/sol/src/lib.rs': 'pub fn sol() {}\n',
    'web/package.json': JSON.stringify({ scripts: { test: 'vitest' }, dependencies: { 'near-api-js': '^5.0.0' } }),
    'web/src/app.ts': "import 'near-api-js';\n",
    'agent/requirements.txt': 'nearai-cloud-verifier==0.2.0\n',
    'agent/app.py': 'import nearai_cloud_verifier\n',
    'agent/test_agent.py': 'def test_ok(): assert True\n',
  });
  const fsProfile = analyzeStackAndPlans(fullstackNear);
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const makeManifest = (rootDir) => {
    const entries = fs.readdirSync(rootDir, { recursive: true })
      .filter((rel) => fs.statSync(path.join(rootDir, rel)).isFile())
      .map((rel) => {
        const p = rel.split(path.sep).join('/');
        const bytes = fs.readFileSync(path.join(rootDir, rel));
        return { path: p, sha256: sha(bytes), bytes: bytes.length };
      });
    return { digest: sha(JSON.stringify(entries)), files: entries };
  };
  const fsCatalog = buildExistingTestCatalog(fullstackNear, makeManifest(fullstackNear));
  const fsHtml = renderHtml(
    fsProfile,
    fsCatalog,
    fsCatalog.tests.map((s) => ({ id: s.id, state: s.kind === 'cargo' ? 'failed_or_unverified' : 'passed' })),
    ['cargo existing tests in programs/sol: Exit 2; failed.', ...fsCatalog.coverageGaps],
  );
  assert.match(fsHtml, /Python · Node · Solana · NEAR · EVM/);
  const fsNearRow = nearRowOf(fsHtml);
  assert.match(fsNearRow, /cargo test not run: local near-sandbox or testnet/);
  assert.match(fsNearRow, /NEAR WASM build .* in contracts\/vault: passed/);
  assert.match(fsNearRow, /npm existing tests in web: passed/);
  assert.doesNotMatch(fsNearRow, /npm existing tests in \.:/, 'Unrelated root web2 npm suite must not leak into NEAR row');
  assert.match(fsNearRow, /pytest existing tests in agent: passed/);
  assert.doesNotMatch(fsNearRow, /programs\/sol/, 'Solana cargo failure must not leak into NEAR row');

  // 2. Python NEAR AI repo (nearRust = false): preserves pytest suite.
  const pyOnly = tree(t, {
    'requirements.txt': 'py-near==1.1.50\nnearai-cloud-verifier==0.2.0\n',
    'app/worker.py': 'import py_near\n',
    'tests/test_worker.py': 'def test_w(): assert True\n',
  });
  const pyCatalog = buildExistingTestCatalog(pyOnly, makeManifest(pyOnly));
  const pyNearRow = nearRowOf(renderHtml(analyzeStackAndPlans(pyOnly), pyCatalog, pyCatalog.tests.map((s) => ({ id: s.id, state: 'passed' }))));
  assert.match(pyNearRow, /pytest existing tests in \.: passed/);

  // 3. Standalone shade-attestation Rust crate (nearRust = false): preserves offline cargo test.
  const shadeCrate = tree(t, {
    'Cargo.toml': '[package]\nname = "verifier"\nversion = "0.1.0"\n[dependencies]\nshade-attestation = "0.1.0"\n',
    'src/lib.rs': 'pub fn check() {}\n',
  });
  const shadeCatalog = buildExistingTestCatalog(shadeCrate, makeManifest(shadeCrate));
  const shadeNearRow = nearRowOf(renderHtml(analyzeStackAndPlans(shadeCrate), shadeCatalog, shadeCatalog.tests.map((s) => ({ id: s.id, state: 'passed' }))));
  assert.match(shadeNearRow, /cargo existing tests in \.: passed/);

  // 4. near-sdk-js + near-workspaces contract: notes near-workspaces / near-sandbox instead of "no suite catalogued".
  const jsContractRepo = tree(t, {
    'package.json': JSON.stringify({ scripts: { test: 'ava' }, dependencies: { 'near-sdk-js': '^2.0.0' }, devDependencies: { 'near-workspaces': '^4.1.0' } }),
    'src/contract.ts': "import { NearBindgen } from 'near-sdk-js';\n",
  });
  const jsCatalog = buildExistingTestCatalog(jsContractRepo, makeManifest(jsContractRepo));
  const jsNearRow = nearRowOf(renderHtml(analyzeStackAndPlans(jsContractRepo), jsCatalog, [], jsCatalog.coverageGaps));
  assert.match(jsNearRow, /near-sdk-js contract/);
  assert.match(jsNearRow, /npm sandbox tests not run: near-workspaces \/ near-sandbox/);
  assert.doesNotMatch(jsNearRow, /no suite catalogued/);
});
