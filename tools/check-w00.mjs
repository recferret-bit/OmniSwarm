#!/usr/bin/env node
// npm run check:w00 : schemas + engine + skill-copy cmp + layout presence. Prints "W00 ok" or exits non-zero.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.join(ROOT, p);
const failures = [];
const fail = (m) => { failures.push(m); process.stdout.write(`FAIL ${m}\n`); };
const read = (p) => fs.readFileSync(rel(p), 'utf8');

function layout() {
  for (const d of ['backend', 'frontend', 'contracts', 'infra', 'packages', 'eval', 'e2e']) {
    const f = `${d}/README.md`;
    if (!fs.existsSync(rel(f))) { fail(`${f} missing`); continue; }
    const t = read(f);
    for (const need of ['Owning waves', 'Gate command', 'Boundary']) if (!t.includes(need)) fail(`${f} lacks "${need}"`);
  }
  const schemas = ['reviewer-spec', 'run-config', 'reviewer-report', 'usage', 'debate-round', 'adjudication', 'general-review', 'job', 'attestation', 'intake-api'];
  for (const s of schemas) if (!fs.existsSync(rel(`shared/schemas/${s}.schema.json`))) fail(`shared/schemas/${s}.schema.json missing`);
  for (const f of ['shared/schemas/canonical-message.mjs', 'tools/worktree-env.mjs', 'RULES.md', '.github/workflows/ci.yml']) if (!fs.existsSync(rel(f))) fail(`${f} missing`);
  const agents = fs.existsSync(rel('AGENTS.md')) ? read('AGENTS.md') : '';
  for (const need of ['Tracks and boundaries', 'keyFingerprint', 'allow-listed']) if (!agents.includes(need)) fail(`AGENTS.md lacks "${need}"`);
  const claude = fs.existsSync(rel('CLAUDE.md')) ? read('CLAUDE.md') : '';
  for (const need of ['keyFingerprint', 'allow-listed', 'test:schemas']) if (!claude.includes(need)) fail(`CLAUDE.md lacks "${need}"`);
  if (!/^\.env\.worktree$/m.test(read('.gitignore'))) fail('.gitignore lacks .env.worktree');
  if (!/Hackathon baseline/.test(read('README.md'))) fail('README.md lacks the "Hackathon baseline" section');
  const pkg = JSON.parse(read('package.json'));
  const want = ['test', 'test:docker', 'test:schemas', 'test:intake', 'test:landing', 'test:contract', 'test:e2e', 'check:infra', 'check:all', 'eval:golden', ...Array.from({ length: 15 }, (_, i) => `check:w${String(i).padStart(2, '0')}`)];
  for (const s of want) if (!pkg.scripts?.[s]) fail(`package.json lacks script ${s}`);
  if (pkg.scripts?.test !== 'node --test --test-concurrency=2 scripts/*.test.mjs') fail('npm test script changed');
}

function step(label, cmd, args) {
  process.stdout.write(`\n== ${label}\n$ ${[cmd, ...args].join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail(`${label} (exit ${r.status})`);
}

layout();
step('schemas', 'npm', ['run', 'test:schemas']);
step('tools', process.execPath, ['--test', 'tools/worktree-env.test.mjs', 'tools/wave.test.mjs']);
step('harness self-test', process.execPath, ['scripts/harness.mjs', '--self-test']);
step('skill copies identical', 'cmp', ['skills/security-audit/SKILL.md', '.claude/skills/security-audit/SKILL.md']);
step('engine tests (npm test)', 'npm', ['test']);

if (failures.length) { process.stdout.write(`\nW00 FAILED\n${failures.map((f) => `- ${f}`).join('\n')}\n`); process.exit(1); }
process.stdout.write('\nW00 ok\n');
