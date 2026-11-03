import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

test('control assertions show their evidence text with a model-assertion pill', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-evidence-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'auditors'));
  fs.mkdirSync(path.join(dir, 'harness'));
  fs.writeFileSync(path.join(dir, 'harness/sandbox.md'), '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
  const meta = { agents: ['claude'], surface: 's1', models: { claude: 'requested-model' }, workerExits: { 'claude-s1-auth': 0 }, crosscheckExits: {}, stageFailures: [], finalized: true };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  const control = { control: 'Signer gate', how_attacked: 'Read the handler', holds: true, evidence: 'DISTINCTIVE_EVIDENCE_7731 at src/gate.ts:9' };
  fs.writeFileSync(path.join(dir, 'auditors/claude-s1-auth.json'), JSON.stringify([{ verified_safe: [control] }]));
  fs.writeFileSync(path.join(dir, 'auditors/claude-s1-auth.md'), 'Source review only.\n');
  const r = spawnSync(process.execPath, [path.join(scripts, 'generate-html-report.mjs'), dir], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.ok(html.includes('DISTINCTIVE_EVIDENCE_7731 at src/gate.ts:9'));
  assert.ok(html.includes('<span class="pill">model assertion</span>'));
  assert.ok(!html.includes('model_assertion'));
});
