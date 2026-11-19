import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LAYERS, buildLayerMap, layerOfPath, renderLayerLines } from './harness-layers.mjs';
import { analyzeStackAndPlans, renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const MIXED = {
  'api/src/server.ts': "import express from 'express';\n",
  'api/src/payout.ts': "import { connect } from 'near-api-js';\n",
  'web/src/app.tsx': 'export const App = () => null;\n',
  'web/src/wallet.ts': 'export const connect = () => window.solana.connect();\n',
  'web/src/near.ts': 'export const connect = () => window.near.requestSignIn();\n',
  'contracts/escrow/Cargo.toml': '[dependencies]\nnear-sdk = "5.1.0"\n',
  'contracts/escrow/src/lib.rs': 'pub fn f() {}\n',
  'contracts/escrow/Dockerfile': 'FROM rust:1.80\n',
  'services/indexer/Cargo.toml': '[dependencies]\ntokio = "1"\n',
  'services/indexer/src/main.rs': 'fn main() {}\n',
  'Dockerfile': 'FROM node:24\n',
  'docker-compose.yml': 'services: {}\n',
  '.env.production': 'PORT=1\n',
  '.github/workflows/ci.yml': 'on: push\n',
  'deploy/main.tf': 'resource "x" "y" {}\n',
  'deploy/release.ts': "import { connect } from 'near-api-js';\n",
};

test('every file lands in exactly one layer', () => {
  const layers = buildLayerMap(tree(MIXED));
  const of = (rel) => layerOfPath(rel, layers);
  assert.deepEqual(layers.roots.web3, ['contracts/escrow']);
  for (const rel of ['api/src/server.ts', 'web/src/app.tsx', 'web/src/wallet.ts', 'services/indexer/src/main.rs', 'services/indexer/Cargo.toml']) assert.equal(of(rel), 'web2', rel);
  // A NEAR crate, a NEAR client import, and window.near. window.solana is not a chain signal.
  for (const rel of ['contracts/escrow/src/lib.rs', 'contracts/escrow/Cargo.toml', 'api/src/payout.ts', 'web/src/near.ts']) assert.equal(of(rel), 'web3', rel);
  // Deploy configuration is infra wherever it sits, including inside a contract directory or a deploy script.
  for (const rel of ['Dockerfile', 'docker-compose.yml', '.env.production', '.github/workflows/ci.yml', 'deploy/main.tf', 'contracts/escrow/Dockerfile', 'deploy/release.ts']) assert.equal(of(rel), 'infra', rel);
  assert.equal(Object.values(layers.counts).reduce((a, b) => a + b, 0), Object.keys(MIXED).length);
  assert.deepEqual(layers.present, LAYERS);
  // A finding location carries a line number.
  assert.equal(of('contracts/escrow/src/lib.rs:42'), 'web3');
});

test('a NEAR crate at the repository root does not turn the whole tree into web3', () => {
  const layers = buildLayerMap(tree({ 'Cargo.toml': '[dependencies]\nnear-sdk = "5.1.0"\n', 'src/lib.rs': 'pub fn f() {}\n', 'app/index.ts': 'export {};\n', 'Anchor.toml': '[programs]\n' }));
  assert.equal(layerOfPath('src/lib.rs', layers), 'web3');
  assert.equal(layerOfPath('Cargo.toml', layers), 'web3');
  assert.equal(layerOfPath('Anchor.toml', layers), 'web2');
  assert.equal(layerOfPath('app/index.ts', layers), 'web2');
});

test('without a layer map the path rules still separate infra from application source', () => {
  assert.equal(layerOfPath('infra/nginx.conf'), 'infra');
  assert.equal(layerOfPath('contracts/Token.sol'), 'web2');
  assert.equal(layerOfPath('foundry.toml'), 'web2');
  assert.equal(layerOfPath('src/index.js'), 'web2');
});

test('the plan lists the layers and the guidance shows only the layers that are present', () => {
  const profile = analyzeStackAndPlans(tree({ 'src/server.js': "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => res.end());\n", 'package.json': '{"dependencies":{"express":"^4"}}' }));
  assert.deepEqual(profile.layers.present, ['web2']);
  assert.match(renderReviewPlansMarkdown(profile), /## Review Layers\n[^\n]+\n- \*\*Web2[^\n]+2 file\(s\)[^\n]+\n- \*\*Web3[^\n]+absent\n- \*\*Infra[^\n]+absent/);
  for (const code of ['S1', 'S3', 'S4', 'S5', 'S6']) {
    const text = renderSurfaceSkillGuidance(code, profile);
    assert.match(text, /#### Web2:/, code);
    assert.doesNotMatch(text, /#### Web3:|#### Infra:/, code);
  }
  assert.deepEqual(renderLayerLines(null), []);
  // With no profile every layer's guidance is shown.
  assert.match(renderSurfaceSkillGuidance('S4'), /#### Web2:[\s\S]+#### Web3:[\s\S]+#### Infra:/);
});

test('Solidity, Foundry, Hardhat and non-NEAR wallet code are not web3', () => {
  const layers = buildLayerMap(tree({
    'contracts/evm/foundry.toml': '[profile.default]\n', 'contracts/evm/src/Vault.sol': 'contract Vault {}\n', 'contracts/evm/test/Vault.t.sol': 'contract T {}\n',
    'contracts/evm/package.json': '{}', 'web/src/evm.ts': "import { Contract } from 'ethers';\n", 'web/src/chain.ts': "import { createPublicClient } from 'viem';\n",
    'web/src/solana.ts': 'export const connect = () => window.solana.connect();\n', 'web/src/eth.ts': 'export const connect = () => window.ethereum.request({});\n',
    'py/chain.py': 'import solders\nfrom solana.rpc.api import Client\nimport web3\nfrom eth_account import Account\n',
    'web/src/page.tsx': 'export const Page = () => null;\n', 'hardhat.config.ts': 'export default {};\n', 'src/Token.sol': 'contract Token {}\n', 'src/server.ts': 'export {};\n',
    'web/src/near.ts': "import { connect } from 'near-api-js';\n",
  }));
  assert.deepEqual(layers.roots.web3, []);
  for (const rel of ['contracts/evm/foundry.toml', 'contracts/evm/src/Vault.sol', 'contracts/evm/test/Vault.t.sol', 'contracts/evm/package.json', 'web/src/evm.ts', 'web/src/chain.ts', 'web/src/solana.ts', 'web/src/eth.ts', 'py/chain.py', 'hardhat.config.ts', 'src/Token.sol', 'web/src/page.tsx', 'src/server.ts']) assert.equal(layerOfPath(rel, layers), 'web2', rel);
  assert.equal(layerOfPath('web/src/near.ts', layers), 'web3');
});
