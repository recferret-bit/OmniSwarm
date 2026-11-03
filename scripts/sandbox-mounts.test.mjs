// sandbox.sh bind-mounts engine modules one by one into /opt/audit. A module that one of them imports but that is
// not mounted breaks the container at load time, and only a Docker run would notice. This reads every `docker run`
// in sandbox.sh and checks that the mounts cover the static import closure of each module that run starts, plus
// the modules sandbox-inside.mjs starts in the container (the harness).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { importClosure } from './worker-isolation-bundle.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const MOUNT = /-v "\$(?:SCRIPT_DIR\/([\w.-]+)|LIB):\/opt\/audit\/([\w.-]+):ro"/;
const STARTED = /\/opt\/audit\/([\w-]+\.mjs)/g;

function dockerRuns(text) {
  const runs = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!current && /\bdocker run\b/.test(line)) current = [];
    if (current) {
      current.push(line);
      if (!/\\\s*$/.test(line)) { runs.push(current); current = null; }
    }
  }
  return runs.map((lines) => {
    const mounts = new Map();
    const started = new Set();
    for (const line of lines) {
      const mount = MOUNT.exec(line);
      if (mount) mounts.set(mount[2], mount[1] || 'sandbox-lib.mjs');
      else for (const m of line.matchAll(STARTED)) started.add(m[1]);
    }
    return { mounts, started, text: lines.join('\n') };
  });
}

const closureNames = (entry) => importClosure(path.join(scripts, entry)).map((file) => {
  assert.equal(path.dirname(file), scripts, `${entry} imports ${file}, which is outside scripts/ and cannot be mounted flat into /opt/audit`);
  return path.basename(file);
});

test('every module a sandbox.sh container loads is mounted at /opt/audit under its own name', () => {
  const runs = dockerRuns(fs.readFileSync(path.join(scripts, 'sandbox.sh'), 'utf8')).filter((run) => run.started.size);
  assert.ok(runs.length >= 3, 'the export, proxy and sandbox containers start /opt/audit modules');
  const inside = fs.readFileSync(path.join(scripts, 'sandbox-inside.mjs'), 'utf8');
  const spawnedInside = [...inside.matchAll(STARTED)].map((m) => m[1]);
  assert.ok(spawnedInside.includes('harness.mjs'), 'sandbox-inside.mjs starts the harness in the container');
  for (const run of runs) {
    for (const [dst, src] of run.mounts) assert.equal(dst, src, `mount ${src} -> /opt/audit/${dst} renames the module`);
    const entries = [...run.started, ...(run.started.has('sandbox-inside.mjs') ? spawnedInside : [])];
    for (const entry of entries) {
      for (const name of closureNames(entry)) assert.ok(run.mounts.has(name), `${entry} loads ${name}, which this docker run does not mount:\n${run.text}`);
    }
  }
});

test('the coverage check notices a module that is imported but not mounted', () => {
  const [run] = dockerRuns('docker run --rm \\\n  -v "$SCRIPT_DIR/harness.mjs:/opt/audit/harness.mjs:ro" \\\n  image node /opt/audit/harness.mjs\n');
  assert.deepEqual([...run.started], ['harness.mjs']);
  const missing = closureNames('harness.mjs').filter((name) => !run.mounts.has(name));
  assert.ok(missing.includes('audit-plans.mjs') && missing.includes('stack-detect.mjs'), missing.join(', '));
});
