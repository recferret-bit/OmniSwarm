import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeScopes, partition, partitionTree, rootFileThemes, shouldSplit, themeOf } from '../../src/worker/themes.ts';
import { materialize } from '../../src/worker/theme-split.ts';

test('top-level names land in one theme, and deps and docs are skipped', () => {
  assert.equal(themeOf('contracts'), 'web3');
  assert.equal(themeOf('programs'), 'web3');
  assert.equal(themeOf('apps'), 'apps');
  assert.equal(themeOf('frontend'), 'apps');
  assert.equal(themeOf('infra'), 'infra');
  assert.equal(themeOf('.github'), 'infra');
  assert.equal(themeOf('scripts'), 'scripts');
  assert.equal(themeOf('packages'), 'apps');
  assert.equal(themeOf('node_modules'), null);
  assert.equal(themeOf('docs'), null);
  assert.equal(themeOf('.git'), null);
});

test('web3 keeps chain trees, web2 drops them, and full keeps every theme', () => {
  const names = ['contracts', 'apps', 'infra', 'scripts', 'docs', 'README.md'];
  assert.deepEqual(partition(names, 'web3').map((slice) => slice.theme), ['web3']);
  assert.deepEqual(partition(names, 'web2').map((slice) => slice.theme), ['apps', 'infra', 'scripts']);
  assert.equal(partition(names, 'full').length, 4);
  assert.deepEqual(partition(['contracts', 'apps'], 'web3')[0]?.dirs, ['contracts']);
});

test('a chain project nested under backend is web3, and the app slice leaves it out', () => {
  const files = ['backend/programs/Anchor.toml', 'backend/src/index.ts', 'frontend/package.json', 'infra/nginx.conf', 'scripts/build.sh', 'docs/readme.md'];
  const web3 = partitionTree(files, 'web3');
  assert.deepEqual(web3, [{ theme: 'web3', dirs: ['backend/programs'] }]);
  const full = partitionTree(files, 'full');
  assert.deepEqual(full.find((slice) => slice.theme === 'apps'), { theme: 'apps', dirs: ['backend', 'frontend'], exclude: ['backend/programs'] });
  assert.deepEqual(partitionTree(files, 'web2').map((slice) => slice.theme), ['apps', 'infra', 'scripts']);
});

test('a small full review stays one job; a large or scoped review is queued per theme', () => {
  assert.equal(shouldSplit({ scope: 'full', themes: 4, files: 100, bytes: 1000 }), false);
  assert.equal(shouldSplit({ scope: 'full', themes: 3, files: 5000, bytes: 1000 }), true);
  assert.equal(shouldSplit({ scope: 'web3', themes: 1, files: 10, bytes: 10 }), true);
  assert.equal(shouldSplit({ scope: 'web2', themes: 0, files: 10, bytes: 10 }), false);
  assert.equal(normalizeScopes(['web2', 'web3']), 'full');
  assert.equal(normalizeScopes(['web3']), 'web3');
  assert.equal(normalizeScopes(['full', 'web2']), 'full');
  assert.equal(normalizeScopes([]), 'full');
});

test('root files are not themes, and each slice receives only the root files of its own layer', () => {
  const files = ['Anchor.toml', 'README.md', 'package.json', 'docker-compose.yml', '.env', 'Dockerfile', 'backend/src/index.ts', 'programs/vault/src/lib.rs', 'infra/nginx.conf'];
  assert.deepEqual(partitionTree(files, 'full'), [{ theme: 'web3', dirs: ['programs'] }, { theme: 'apps', dirs: ['backend'] }, { theme: 'infra', dirs: ['infra'] }]);
  assert.deepEqual(rootFileThemes('Anchor.toml'), ['web3']);
  assert.deepEqual(rootFileThemes('.env.production'), ['infra']);
  assert.deepEqual(rootFileThemes('Dockerfile'), ['apps', 'infra']);
  assert.equal(rootFileThemes('package.json').length, 4);
  // A repository with no directories is still one apps slice.
  assert.deepEqual(partitionTree(['index.js', 'package.json'], 'web2'), [{ theme: 'apps', dirs: ['index.js', 'package.json'] }]);

  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-src-'));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), 'x\n');
  }
  const rootOf = (theme: 'web3' | 'apps' | 'infra') => {
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'themes-out-')), theme);
    materialize(source, partitionTree(files, 'full').find((slice) => slice.theme === theme)!, dest);
    return fs.readdirSync(dest).sort();
  };
  assert.deepEqual(rootOf('apps'), ['Dockerfile', 'README.md', 'backend', 'package.json']);
  assert.deepEqual(rootOf('web3'), ['Anchor.toml', 'README.md', 'package.json', 'programs']);
  assert.deepEqual(rootOf('infra'), ['.env', 'Dockerfile', 'README.md', 'docker-compose.yml', 'infra', 'package.json']);
});

test('EVM projects are web3 themes, wherever they sit', () => {
  assert.equal(themeOf('evm'), 'web3');
  assert.equal(themeOf('solidity'), 'web3');
  assert.equal(themeOf('evmos-docs-site'), 'apps');
  const files = ['backend/onchain/foundry.toml', 'backend/onchain/src/Vault.sol', 'backend/src/index.ts', 'packages/hh/hardhat.config.ts', 'packages/hh/contracts/Token.sol', 'packages/ui/src/app.tsx'];
  assert.deepEqual(partitionTree(files, 'web3'), [{ theme: 'web3', dirs: ['backend/onchain', 'packages/hh'] }]);
  const apps = partitionTree(files, 'web2').find((slice) => slice.theme === 'apps');
  assert.deepEqual(apps, { theme: 'apps', dirs: ['backend', 'packages'], exclude: ['backend/onchain', 'packages/hh'] });
  assert.deepEqual(rootFileThemes('foundry.toml'), ['web3']);
  assert.deepEqual(rootFileThemes('hardhat.config.ts'), ['web3']);
  assert.equal(rootFileThemes('hardhat.md').length, 4);
});
