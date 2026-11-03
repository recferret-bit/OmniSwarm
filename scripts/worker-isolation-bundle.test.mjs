import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, RUNTIME_ENTRY, importClosure, importSpecifiers, runtimeBundle, liveBundleDigest, bundleMountArgs } from './worker-isolation-bundle.mjs';
import { runtimeDigest } from './worker-supervisor.mjs';

// Records every file: module Node itself loads for the entry (in-thread module.registerHooks), then the
// entry refuses its missing mode and exits; linking has already loaded the whole graph by then.
const RECORDER = `import fs from 'node:fs';
import { registerHooks } from 'node:module';
const seen = new Set();
registerHooks({ load(url, context, next) { if (url.startsWith('file:')) seen.add(url); return next(url, context); } });
process.on('exit', () => fs.writeSync(3, JSON.stringify([...seen])));`;

function nodeLoadedModules(entry) {
  const run = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(RECORDER)}`, entry], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20_000 });
  return JSON.parse(run.output[3]).map((url) => fileURLToPath(url)).sort();
}

test('the runtime bundle is exactly the module graph Node loads for worker-runtime.mjs', () => {
  const entry = path.join(REPO_ROOT, RUNTIME_ENTRY);
  const loaded = nodeLoadedModules(entry);
  assert.ok(loaded.includes(path.join(REPO_ROOT, 'packages/schemas/index.mjs')), 'the graph reaches the schema validator');
  assert.deepEqual(importClosure(entry), loaded);
  const bundle = runtimeBundle();
  assert.deepEqual(bundle.filter((rel) => /\.m?js$/.test(rel)).map((rel) => path.join(REPO_ROOT, rel)), loaded);
  for (const name of fs.readdirSync(path.join(REPO_ROOT, 'packages/schemas')).filter((n) => n.endsWith('.schema.json'))) {
    assert.ok(bundle.includes(`packages/schemas/${name}`), `${name} is read beside index.mjs and must be sealed`);
  }
});

test('the runtime digest covers every bundle file, not only the entry directory', () => {
  assert.equal(runtimeDigest(), liveBundleDigest());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-bundle-'));
  try {
    for (const rel of runtimeBundle()) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(root, rel));
    }
    const before = liveBundleDigest(root);
    assert.equal(before, runtimeDigest());
    fs.appendFileSync(path.join(root, 'packages/schemas/job.schema.json'), '\n');
    assert.notEqual(liveBundleDigest(root), before, 'a schema edit changes the runtime identity');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bare and dynamic imports fail closed; node: builtins and multi-line imports are read', () => {
  assert.deepEqual(importSpecifiers("import fs from 'node:fs';\nimport {\n  a,\n  b as c,\n} from './x.mjs';\nexport * from '../y.mjs';\nimport './z.mjs';\n// import q from './comment.mjs'\n"), ['node:fs', './x.mjs', '../y.mjs', './z.mjs']);
  assert.throws(() => importSpecifiers("const m = await import('./x.mjs');"), /dynamic import/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-bundle-bare-'));
  try {
    fs.writeFileSync(path.join(root, 'entry.mjs'), "import './dep.mjs';\n");
    fs.writeFileSync(path.join(root, 'dep.mjs'), "import fs from 'fs';\n");
    assert.throws(() => importClosure(path.join(root, 'entry.mjs')), /bare import fs/);
    fs.writeFileSync(path.join(root, 'dep.mjs'), "import x from '@omniswarm/schemas';\n");
    assert.throws(() => importClosure(path.join(root, 'entry.mjs')), /bare import @omniswarm\/schemas/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bundle mounts map scripts to /trusted and the schema directory beside it, read-only', () => {
  const args = bundleMountArgs('/snap');
  assert.deepEqual(args, ['--mount', 'type=bind,src=/snap/scripts,dst=/trusted,readonly', '--mount', 'type=bind,src=/snap/packages/schemas,dst=/packages/schemas,readonly']);
  assert.equal(path.posix.resolve('/trusted', '../packages/schemas/index.mjs'), '/packages/schemas/index.mjs');
});
