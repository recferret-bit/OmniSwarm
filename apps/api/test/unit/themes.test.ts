import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScopes, partition, partitionTree, shouldSplit, themeOf } from '../../src/worker/themes.ts';

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
