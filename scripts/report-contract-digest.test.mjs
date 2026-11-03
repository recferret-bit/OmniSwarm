import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { copyTree } from './sandbox-lib.mjs';
import { sha256Hex, sha256Json } from './hash-util.mjs';

// The served-source check (report-contract sourceReadDigestProblem) requires the digest of /src to EQUAL the
// sealed manifest. /src is sandbox.sh's `sandbox-lib copy` of the sealed snapshot. This pins the invariant that
// makes equality safe: the copy drops nothing the snapshot kept, for every name either filter treats specially.
function treeDigest(root) {
  const files = [];
  (function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), next);
      else if (ent.isFile()) {
        const body = fs.readFileSync(path.join(dir, ent.name));
        files.push({ path: next, bytes: body.length, sha256: sha256Hex(body) });
      }
    }
  })(root, '');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return sha256Json(files);
}

test('the sandbox copy of a sealed snapshot serves exactly the manifest', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-copy-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-dest-'));
  t.after(() => { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); });
  const put = (rel, body = `// ${rel}\n`) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
  for (const rel of ['src/lib.rs', 'src/app.ts', 'package.json', '.env', '.env.example', '.env.local', 'id.json', 'deploy/secrets/k.json',
    'deploy/app.yaml', '.next/x.js', 'node_modules/a/index.js', 'target/x.rs', 'dist/a.js', '.cargo/config.toml', 'keypair-dev.json',
    'server.pem', '.npmrc', 'secrets/a.ts', 'coverage/a.js', '.ssh/config', 'lib/keep.py', 'Cargo.lock']) put(rel);
  const capture = createSnapshot(repo);
  try {
    copyTree(capture.snapshot, path.join(dest, 'src'));
    assert.ok(capture.manifest.files.some((file) => file.path === 'src/lib.rs'));
    assert.equal(treeDigest(path.join(dest, 'src')), capture.manifest.digest);
  } finally { disposeSnapshot(capture); }
});
