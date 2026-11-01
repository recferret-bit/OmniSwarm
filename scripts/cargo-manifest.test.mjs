import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cargoInfo, isNearCargo, nearReleaseEvidence } from './cargo-manifest.mjs';
import { detectEcosystems } from './stack-detect.mjs';
import { buildExistingTestCatalog } from './review-workflow.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'near-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
const pkg = '[package]\nname="contract"\nversion="0.1.0"\n';
const near = '[dependencies]\nnear-sdk="5.29.0"\n';

test('Cargo dependency forms select NEAR guidance and exclude contract/workspace tests', t => {
  for (const dependency of [
    '[dependencies.near-sdk]\nversion="5.29.0"',
    '[dependencies]\nsdk={package="near-sdk",version="5.29.0"}',
    '[dependencies."sdk"]\npackage="near-sdk"\nversion="5.29.0"',
    '[target.\'cfg(target_arch = "wasm32")\'.dependencies]\nnear-sdk="5.29.0"',
    '[dependencies]\nsdk.workspace=true',
    '[dependencies.sdk]\nworkspace=true',
  ]) {
    const files = { 'Cargo.toml': '[workspace]\nmembers=["contract"]\n[workspace.dependencies]\nsdk={package="near-sdk",version="5.29.0"}', 'contract/Cargo.toml': pkg + dependency, 'contract/src/lib.rs': '' };
    const root = fixture(t, files);
    const info = cargoInfo(root, path.join(root, 'contract/Cargo.toml'));
    assert.equal(isNearCargo(info), true, dependency);
    assert.equal(detectEcosystems(root).near.contracts, true, dependency);
    const catalog = buildExistingTestCatalog(root, { digest: 'fixture', files: Object.keys(files).map(path => ({ path, sha256: 'fixture' })) });
    assert.deepEqual(catalog.tests, [], dependency);
    assert.match(catalog.coverageGaps.join('\n'), /NEAR build verification unavailable/);
  }
});

test('comments, metadata, unused workspace dependencies and dev-only dependencies do not route production', t => {
  for (const extra of ['# near-sdk="5"', '[package.metadata]\nnear-sdk="5"', '[workspace.dependencies]\nnear-sdk="5"', '[dev-dependencies]\nnear-sdk="5"']) {
    const root = fixture(t, { 'Cargo.toml': pkg + extra });
    assert.equal(detectEcosystems(root).near.contracts, false, extra);
  }
});

test('release evidence cannot be satisfied by dev, comments, member profiles or other contracts', t => {
  const root = fixture(t, {
    'Cargo.toml': '[workspace]\nmembers=["contract"]\n[profile.dev]\noverflow-checks=true\n[profile.release]\noverflow-checks=false\n',
    'contract/Cargo.toml': pkg + near + '[profile.release]\noverflow-checks=true\n',
    'other/Cargo.toml': pkg + near + '[profile.release]\noverflow-checks=true\n',
  });
  assert.match(nearReleaseEvidence(root, root + '/contract/Cargo.toml'), /LEAD:/);
  fs.writeFileSync(root + '/Cargo.toml', '[workspace]\nmembers=["contract"]\n[profile.release]\noverflow-checks=true\n');
  assert.match(nearReleaseEvidence(root, root + '/contract/Cargo.toml'), /release overflow-checks = true/);
  fs.mkdirSync(root + '/.cargo');
  fs.writeFileSync(root + '/.cargo/config.toml', '[profile.release]\noverflow-checks=false\n');
  assert.match(nearReleaseEvidence(root, root + '/contract/Cargo.toml'), /LEAD:/);
});

test('release package overrides and comments never produce an unconditional safety claim', t => {
  for (const profile of ['[profile.release]\n# overflow-checks=true\noverflow-checks=false', '[profile.release]\noverflow-checks=true\n[profile.release.package.contract]\noverflow-checks=false']) {
    const root = fixture(t, { 'Cargo.toml': pkg + near + profile });
    assert.match(nearReleaseEvidence(root, root + '/Cargo.toml'), /LEAD:/);
  }
});
