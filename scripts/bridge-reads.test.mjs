import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callBridgeTool } from './docker-mcp-bridge.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import {
  LIST_FILES_SCRIPT, PREPARE_RUN_SCRIPT, SEARCH_CODE_SCRIPT, SEALED_DEPS, SKIP_DIRS, SOURCE_DIGEST_SCRIPT, listTree, searchTree,
} from './bridge-programs.mjs';

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-reads-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return fs.realpathSync(root);
}

const runScript = (script, args) => {
  const result = spawnSync(process.execPath, ['-e', script, ...args.map(String)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

test('search_code says how much of a long hit line it cut, on the host and in the container program', async (t) => {
  const long = `const key = "${'k'.repeat(300)}";`;
  const root = tree(t, { 'src/lib.js': `${long}\nshort key line\n` });
  const reportDir = tree(t, { 'harness/.keep': '' });
  const ctx = { role: 'auditor', demoHost: root, reportDir, surface: 'S1' };
  const hits = (await callBridgeTool(ctx, 'search_code', { pattern: 'key' })).split('\n');
  assert.equal(hits.length, 2);
  assert.ok(hits[0].startsWith('src/lib.js:1: const key = "kkk'));
  assert.ok(hits[0].endsWith(`… [+${long.length - 220} chars]`), hits[0]);
  assert.equal(hits[1], 'src/lib.js:2: short key line');
  // The container runs the same walker as source text: same cut, same marker.
  const inContainer = runScript(SEARCH_CODE_SCRIPT, [root, 'key', '', 80]).split('\n');
  assert.ok(inContainer[0].endsWith(`… [+${long.length - 220} chars]`));
  assert.equal(inContainer[0].slice(inContainer[0].indexOf(':1:')), hits[0].slice(hits[0].indexOf(':1:')));
});

test('a search from a subdirectory still cites paths relative to the source root', async (t) => {
  const root = tree(t, { 'src/auth/check.rs': 'fn check() {}\n' });
  const reportDir = tree(t, { 'harness/.keep': '' });
  const hit = await callBridgeTool({ role: 'auditor', demoHost: root, reportDir, surface: 'S1' }, 'search_code', { pattern: 'fn check', path: 'src/auth' });
  assert.equal(hit, 'src/auth/check.rs:1: fn check() {}');
});

test('host walkers and the container programs are one algorithm', (t) => {
  const root = tree(t, { 'a.rs': 'one\n', 'src/b.ts': 'two\n', 'node_modules/x/index.js': 'skip\n', 'deep/er/c.py': 'three\n' });
  const digest = JSON.parse(runScript(SOURCE_DIGEST_SCRIPT.replace("'/src'", JSON.stringify(root)), []));
  assert.deepEqual(digest, digestTree(root));
  assert.equal(runScript(LIST_FILES_SCRIPT, [root, 3]), listTree(fs, path, root, 3, SKIP_DIRS));
  assert.doesNotMatch(listTree(fs, path, root, 3, SKIP_DIRS), /index\.js/);
  assert.equal(runScript(SEARCH_CODE_SCRIPT, [root, 'o|e', '', 80]), searchTree(fs, path, root, '/src', 'o|e', '', 80, SKIP_DIRS, 220));
});

// The prepare program, pointed at a scratch layout instead of /src, /work/src and /work/deps.
function prepareInScratch(t, { sealed }) {
  const base = tree(t, {
    'src/package.json': '{}', 'src/app/package.json': '{}',
    'work-src/node_modules/dep/index.js': 'poisoned by an earlier suite', 'work-src/app/node_modules/dep/index.js': 'poisoned',
    ...(sealed ? { 'deps/node_modules/dep/index.js': 'sealed at handoff', 'deps/app/node_modules/dep/index.js': 'sealed at handoff' } : {}),
  });
  const script = PREPARE_RUN_SCRIPT.split('\n').filter((line) => !line.includes('Invalid run directory')).join('\n')
    .replaceAll(`'${SEALED_DEPS}'`, JSON.stringify(path.join(base, 'deps')))
    .replace("fs.cpSync('/src'", `fs.cpSync(${JSON.stringify(path.join(base, 'src'))}`)
    .replace("'/work/src'", JSON.stringify(path.join(base, 'work-src')));
  const run = path.join(base, 'run');
  const mode = runScript(script, [run]);
  const read = (rel) => fs.readFileSync(path.join(run, 'src', rel), 'utf8');
  return { mode, read };
}

test('a suite run copies node_modules from the handoff seal, not from the writable /work/src', (t) => {
  const sealed = prepareInScratch(t, { sealed: true });
  assert.equal(sealed.mode, 'sealed');
  assert.equal(sealed.read('node_modules/dep/index.js'), 'sealed at handoff');
  assert.equal(sealed.read('app/node_modules/dep/index.js'), 'sealed at handoff');
  // A sandbox without the seal keeps working, and the run records that its dependencies were not sealed.
  const legacy = prepareInScratch(t, { sealed: false });
  assert.equal(legacy.mode, 'unsealed');
  assert.equal(legacy.read('node_modules/dep/index.js'), 'poisoned by an earlier suite');
});
