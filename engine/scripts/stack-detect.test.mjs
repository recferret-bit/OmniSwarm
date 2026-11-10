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
  assert.doesNotMatch(guidance, /Solana\/Anchor/);
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

test('EVM is detected from production contract source, a project file or a client library', (t) => {
  const foundry = detectEcosystems(tree(t, { 'foundry.toml': '[profile.default]\n', 'src/Vault.sol': 'contract Vault {}\n', 'test/Vault.t.sol': 'contract T {}\n', 'script/Deploy.s.sol': 'contract D {}\n', 'lib/forge-std/src/Test.sol': 'contract Test {}\n' })).evm;
  assert.deepEqual([foundry.detected, foundry.contracts, foundry.sourceFiles, foundry.kinds, foundry.tooling], [true, true, 1, ['contract'], ['foundry']]);
  assert.deepEqual(foundry.marks, ['foundry.toml', 'src/Vault.sol']);
  const hardhat = detectEcosystems(tree(t, { 'hardhat.config.ts': 'export default {};\n', 'contracts/Token.sol': 'contract Token {}\n', 'package.json': '{"devDependencies":{"hardhat":"^2.22.0"}}' })).evm;
  assert.deepEqual([hardhat.contracts, hardhat.tooling], [true, ['hardhat']]);
  const vyper = detectEcosystems(tree(t, { 'contracts/Vault.vy': '# @version 0.4.0\n' })).evm;
  assert.deepEqual([vyper.detected, vyper.contracts], [true, true]);
  // A dApp front end with no contract source: client only.
  const client = detectEcosystems(tree(t, { 'package.json': '{"dependencies":{"viem":"^2.0.0","wagmi":"^2.0.0"}}', 'src/app.ts': 'export {};\n' })).evm;
  assert.deepEqual([client.detected, client.contracts, client.kinds], [true, false, ['client']]);
});

test('tests, scripts, vendored libraries and unrelated packages do not mark EVM', (t) => {
  const absent = (files) => assert.equal(detectEcosystems(tree(t, files)).evm.detected, false, Object.keys(files).join(', '));
  absent({ 'src/index.ts': 'export {};\n', 'package.json': '{"dependencies":{"express":"^4"}}' });
  // Only test and script contracts, and a vendored library, with no project file.
  absent({ 'test/Vault.t.sol': 'contract T {}\n', 'script/Deploy.s.sol': 'contract D {}\n', 'lib/openzeppelin/Ownable.sol': 'contract Ownable {}\n' });
  // A project file or a client dependency that lives only under tests or examples.
  absent({ 'examples/demo/foundry.toml': '', 'tests/e2e/package.json': '{"dependencies":{"ethers":"^6"}}' });
  // A package whose name merely contains a library name, and a Rust file that mentions Solidity.
  absent({ 'package.json': '{"dependencies":{"ethers-like-lib":"1.0.0","my-web3-helpers":"1.0.0"}}', 'src/lib.rs': '// pragma solidity ^0.8.0;\n' });
  const eco = detectEcosystems(tree(t, { 'Cargo.toml': '[package]\nname = "c"\n[dependencies]\nnear-sdk = "5.1.0"\n', 'src/lib.rs': 'pub fn f() {}\n' }));
  assert.deepEqual([eco.near.detected, eco.evm.detected], [true, false]);
});

test('EVM guidance and the EVM lead file appear only for an EVM target', (t) => {
  const evm = analyzeStackAndPlans(tree(t, { 'foundry.toml': '', 'src/Vault.sol': 'pragma solidity ^0.8.0;\ncontract Vault { function f() external { require(tx.origin == msg.sender); } }\n' }));
  const plain = analyzeStackAndPlans(tree(t, { 'src/server.js': "require('express')().get('/x', (req, res) => res.end());\n", 'package.json': '{"dependencies":{"express":"^4"}}' }));
  for (const code of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    assert.match(renderSurfaceSkillGuidance(code, evm), /- EVM \[/, code);
    assert.doesNotMatch(renderSurfaceSkillGuidance(code, plain), /EVM/, code);
  }
  assert.doesNotMatch(renderSurfaceSkillGuidance('S3', evm), /Solana\/Anchor|NEAR contract|Python:/);
  // Contract source only: no wallet-client rows. A client-only dApp: wallet rows and no contract rows.
  assert.doesNotMatch(renderSurfaceSkillGuidance('S6', evm), /\[Wallet client\]/);
  const dapp = analyzeStackAndPlans(tree(t, { 'package.json': '{"dependencies":{"viem":"^2.0.0"}}', 'src/app.ts': "import { createWalletClient } from 'viem';\n" }));
  assert.match(renderSurfaceSkillGuidance('S6', dapp), /- EVM \[Wallet client\]/);
  assert.doesNotMatch(renderSurfaceSkillGuidance('S3', dapp), /- EVM \[SC0/);
  assert.equal(evm.layers.counts.web3, 2);
  assert.deepEqual(evm.layers.present, ['web3']);
});
