import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyseNodeDeps, analysePythonDeps, detectEcosystems, isProductionPath } from './stack-detect.mjs';
import { analyzeStackAndPlans, renderSurfaceSkillGuidance } from './audit-plans.mjs';

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

test('the bundled demo fixture is a NEAR contract plus a Node client', () => {
  const profile = detectEcosystems(path.join(path.dirname(new URL(import.meta.url).pathname), 'demo-fixture'));
  assert.equal(profile.near.detected, true);
  assert.equal(profile.near.contracts, true);
  assert.equal(profile.node.detected, true);
  assert.ok(profile.node.frameworks.includes('near-api-js'));
});

test('tests, docs and helper scripts do not decide the primary stack', () => {
  for (const p of ['backend/tests/test_a.py', 'frontend/scripts/check.mjs', 'docs/gen.js', 'x/conftest.py', 'web/app.test.ts']) assert.equal(isProductionPath(p), false, p);
  for (const p of ['backend/app/main.py', 'frontend/src/App.tsx']) assert.equal(isProductionPath(p), true, p);
});

test('a Python service with a Node helper script is routed as Python, with framework and declared version', t => {
  const root = tree(t, {
    'backend/requirements.txt': 'fastapi>=0.115\nsqlalchemy==2.0.48\n',
    'backend/Dockerfile': 'FROM python:3.12-slim\n',
    'backend/app/main.py': '@router.get("/x")\nasync def x(): ...\n',
    'backend/app/db.py': 'x = 1\n',
    'backend/tests/test_main.py': 'def test(): pass\n',
    'tools/scripts/build.mjs': 'export {}\n',
  });
  const eco = detectEcosystems(root);
  assert.equal(eco.python.detected, true);
  assert.equal(eco.node.detected, false);
  assert.deepEqual(eco.primary, ['python']);
  assert.deepEqual(eco.python.frameworks, ['fastapi', 'sqlalchemy']);
  assert.deepEqual(eco.python.declaredVersion, { version: '3.12', source: 'backend/Dockerfile' });
  assert.equal(eco.python.hasPytestSignal, true);
  const profile = analyzeStackAndPlans(root);
  assert.ok(profile.domains.find(d => d.id === 'http').leads[0].hits.some(h => h.citation === 'backend/app/main.py:1'), '@router.get is a route');
  const guidance = renderSurfaceSkillGuidance('S2', profile);
  assert.match(guidance, /Python: audit Pydantic/);
  assert.doesNotMatch(guidance, /Node: audit/);
  assert.doesNotMatch(guidance, /Solana|EVM \[/);
});

test('NEAR contracts and clients are detected from production manifests only', t => {
  const root = tree(t, {
    'contracts/Cargo.toml': '[package]\nname = "c"\nversion = "0.1.0"\n\n[dependencies]\nnear-sdk = "5.29.0"\n',
    'app/package.json': JSON.stringify({ dependencies: { 'near-api-js': '1.0.0', '@defuse-protocol/intents-sdk': '1.0.0', '@neardefi/shade-agent-js': '1.0.0' } }),
    'tests/hidden/Cargo.toml': '[dependencies]\nnear-sdk = "5.29.0"\n',
    'docs/note.js': 'const mpc = "v1.signer";\n',
  });
  const eco = detectEcosystems(root);
  assert.equal(eco.near.detected, true);
  assert.equal(eco.near.contracts, true);
  assert.deepEqual(eco.near.kinds, ['ai', 'client', 'contract', 'intents']);
  assert.ok(eco.near.marks.includes('contracts/Cargo.toml'));
  assert.ok(eco.near.marks.includes('app/package.json'));
  assert.ok(!eco.near.marks.some((mark) => mark.startsWith('tests/') || mark.startsWith('docs/')));
  const guidance = renderSurfaceSkillGuidance('S3', analyzeStackAndPlans(root));
  assert.match(guidance, /NEAR contract/);
  assert.match(guidance, /NEAR Intents/);
  const plain = tree(t, { 'svc/app.py': 'x = 1\n' });
  assert.equal(detectEcosystems(plain).near.detected, false);
  assert.equal(detectEcosystems(plain).near.contracts, false);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S3', analyzeStackAndPlans(plain)), /NEAR contract/);
});

test('without a profile every stack is covered, and a test-only marker does not activate a domain', t => {
  assert.match(renderSurfaceSkillGuidance('S5'), /Python: audit `requirements/);
  assert.match(renderSurfaceSkillGuidance('S5'), /Node: audit/);
  const root = tree(t, { 'svc/app.py': 'x = 1\n', 'svc/tests/test_ws.py': '@app.websocket("/ws")\nasync def ws(): ...\n' });
  assert.ok(!analyzeStackAndPlans(root).detectedStacks.includes('websockets'));
});

test('unpinned and non-index Python requirements are an advisory coverage gap; pinned or locked trees are not', t => {
  const loose = analysePythonDeps(tree(t, { 'a/requirements.txt': 'fastapi>=0.1\nrequests==2.32.0\n-e git+https://x/y.git#egg=y\n# c\n' }));
  assert.equal(loose.applicable, true);
  assert.equal(loose.unpinned.length, 1);
  assert.equal(loose.risky.length, 1);
  assert.ok(loose.unresolved >= 2);
  const pinned = analysePythonDeps(tree(t, { 'b/requirements.txt': 'fastapi==0.115.0 ; python_version>"3.9"\n--hash=sha256:abc\n', 'b/poetry.lock': '' }));
  assert.equal(pinned.unresolved, 0);
  assert.equal(analysePythonDeps(tree(t, { 'c/main.js': '' })).applicable, false);
});

test('Node manifests without a lockfile, with git sources or open ranges are a coverage gap; workspace locks count', t => {
  const bad = analyseNodeDeps(tree(t, { 'a/package.json': JSON.stringify({ dependencies: { x: '*', y: 'github:o/r', z: '^1.0.0' }, scripts: { postinstall: 'node x.js' } }) }));
  assert.equal(bad.noLock.length, 1);
  assert.equal(bad.nonRegistry.length, 1);
  assert.equal(bad.loose.length, 1);
  assert.equal(bad.lifecycle.length, 1);
  assert.ok(bad.unresolved >= 3);
  const ok = analyseNodeDeps(tree(t, { 'package-lock.json': '{}', 'packages/w/package.json': JSON.stringify({ dependencies: { z: '^1.0.0' } }) }));
  assert.equal(ok.unresolved, 0);
  assert.equal(analyseNodeDeps(tree(t, { 'x/y.py': '' })).applicable, false);
});

test('NEAR guidance includes callback receipt failure and bounded FT settlement', t => {
  const root = tree(t, { 'Cargo.toml': '[package]\nname="c"\n[dependencies.near-sdk]\nversion="5.29.0"' });
  const guidance = renderSurfaceSkillGuidance('S3', analyzeStackAndPlans(root));
  for (const check of ['callback receipt itself fails', 'bound result bytes', 'settle once', 'receiver balance', 'stuck operations']) assert.ok(guidance.includes(check), check);
});

test('Anchor, Solidity, Vyper, Foundry, Hardhat and wallet libraries are not a review stack', (t) => {
  const marked = detectEcosystems(tree(t, {
    'Anchor.toml': '[programs.localnet]\n',
    'programs/vault/Cargo.toml': '[package]\nname = "vault"\n[dependencies]\nanchor-lang = "0.30.1"\nsolana-program = "1.18.0"\npinocchio = "0.1.0"\n',
    'programs/vault/src/lib.rs': 'pub fn init() {}\n',
    'foundry.toml': '[profile.default]\n',
    'hardhat.config.ts': 'export default {};\n',
    'truffle-config.js': 'module.exports = {};\n',
    'remappings.txt': 'forge-std/=lib/forge-std/src/\n',
    'src/Vault.sol': 'contract Vault {}\n',
    'contracts/Vault.vy': '# @version 0.4.0\n',
    'package.json': '{"dependencies":{"ethers":"^6.0.0","viem":"^2.0.0","wagmi":"^2.0.0","web3":"^4.0.0","@solana/web3.js":"^1.98.0","hardhat":"^2.22.0"}}',
    'src/app.ts': "import { createWalletClient } from 'viem';\n",
    'requirements.txt': 'solders==0.21.0\nsolana==0.34.0\n',
    'app/main.py': 'x = 1\n',
  }));
  assert.equal('solana' in marked, false);
  assert.equal('evm' in marked, false);
  for (const id of ['solana-py', 'solana-web3', 'evm-client', 'hardhat']) {
    assert.equal(marked.python.frameworks.includes(id), false, id);
    assert.equal(marked.node.frameworks.includes(id), false, id);
  }
  assert.equal(marked.near.detected, false);
  const guidance = renderSurfaceSkillGuidance('S3', analyzeStackAndPlans(tree(t, {
    'foundry.toml': '',
    'src/Vault.sol': 'pragma solidity ^0.8.0;\ncontract Vault { function f() external { require(tx.origin == msg.sender); } }\n',
    'src/app.ts': "import { createWalletClient } from 'viem';\n",
  })));
  assert.doesNotMatch(guidance, /Solana|EVM \[|NEAR contract/);
  // A plain Rust crate and a Python service do not receive NEAR contract guidance.
  const rust = analyzeStackAndPlans(tree(t, { 'Cargo.toml': '[package]\nname = "svc"\nversion = "0.1.0"\n', 'src/main.rs': 'fn main() {}\n' }));
  assert.equal(rust.ecosystems.near.detected, false);
  assert.equal(rust.layers.counts.web3, 0);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S3', rust), /NEAR contract|Solana|EVM \[/);
  const py = analyzeStackAndPlans(tree(t, { 'svc/app.py': 'x = 1\n' }));
  assert.doesNotMatch(renderSurfaceSkillGuidance('S3', py), /NEAR contract|Solana|EVM \[/);
});

test('NEAR Wallet Selector, Chain Signatures, Shade Agent attestation and Python NEAR AI packages route kinds, layers and crypto plans', (t) => {
  const walletAndAi = analyzeStackAndPlans(tree(t, {
    'web/package.json': JSON.stringify({ dependencies: { '@near-wallet-selector/core': '^8.9.0', 'chainsig.js': '^0.4.0', '@nearai/inference-sdk': '^0.1.0', 'near-kit': '^0.3.0' } }),
    'web/src/sign.ts': "import { setupWalletSelector } from '@near-wallet-selector/core';\nimport { chainAdapters } from 'chainsig.js';\n",
    'web/src/ai.ts': "import { InferenceClient } from '@nearai/inference-sdk/node';\n",
    'verifier/Cargo.toml': '[package]\nname = "verifier"\n[dependencies]\nshade-attestation = "0.1.0"\n',
    'verifier/src/lib.rs': 'pub fn check() {}\n',
    'tests/only/package.json': JSON.stringify({ dependencies: { '@defuse-protocol/intents-sdk': '1.0.0' } }),
  }));
  assert.equal(walletAndAi.ecosystems.near.detected, true);
  assert.equal(walletAndAi.ecosystems.near.contracts, false);
  assert.deepEqual(walletAndAi.ecosystems.near.kinds, ['ai', 'client']);
  assert.ok(walletAndAi.ecosystems.node.frameworks.includes('near-wallet-selector'));
  assert.ok(walletAndAi.ecosystems.node.frameworks.includes('near-chainsig'));
  assert.ok(walletAndAi.ecosystems.node.frameworks.includes('near-ai'));
  assert.ok(walletAndAi.detectedStacks.includes('crypto'));
  assert.ok(walletAndAi.layers.files.web3.includes('web/src/sign.ts'));
  assert.ok(walletAndAi.layers.files.web3.includes('web/src/ai.ts'));
  assert.ok(walletAndAi.layers.files.web3.includes('verifier/src/lib.rs'));
  assert.match(renderSurfaceSkillGuidance('S1', walletAndAi), /- NEAR client \[Wallet client, NEP-413 and NEP-366\]/);
  assert.match(renderSurfaceSkillGuidance('S1', walletAndAi), /- NEAR AI \[NEAR AI Cloud, Shade Agents and TEEs\]/);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S1', walletAndAi), /- NEAR contract \[/);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S1', walletAndAi), /- NEAR Intents \[/);

  // A pure near-sdk contract with no JS crypto library still activates the crypto risk domain and S2 contract checks.
  const pureContract = analyzeStackAndPlans(tree(t, {
    'Cargo.toml': '[package]\nname = "escrow"\n[dependencies]\nnear-sdk = "5.6.0"\n',
    'src/lib.rs': 'use near_sdk::near;\n#[near(contract_state)]\npub struct Escrow {}\n',
  }));
  assert.ok(pureContract.detectedStacks.includes('crypto'));
  assert.match(renderSurfaceSkillGuidance('S2', pureContract), /- NEAR contract \[/);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S6', pureContract), /- NEAR client \[/);
});
