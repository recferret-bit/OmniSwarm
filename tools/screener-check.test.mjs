import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', ...args], { cwd, encoding: 'utf8' });

// A throwaway repository with a README of screener blocks, a fake demo command and the real secret sweep.
function fixtureRepo(blocks, demoFiles = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screener-repo-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  for (const file of ['secret-sweep.sh', 'secret-shapes.txt']) fs.copyFileSync(path.join(TOOLS, file), path.join(dir, 'tools', file));
  fs.writeFileSync(path.join(dir, 'README.md'), blocks.map(([run, see]) => `<!-- screener\nrun: ${run}\nyou should see: ${see}\n-->\n`).join('\n'));
  const writes = demoFiles.map((rel) => `fs.mkdirSync(path.dirname(path.join(out, ${JSON.stringify(rel)})), { recursive: true }); fs.writeFileSync(path.join(out, ${JSON.stringify(rel)}), 'DEMO — not a review');`).join('\n');
  fs.writeFileSync(path.join(dir, 'demo.mjs'), `import fs from 'node:fs'; import path from 'node:path';\nconst out = path.resolve('demo-out'); fs.mkdirSync(out, { recursive: true });\nconsole.log('DEMO — not a review');\n${writes}\nconsole.log('Demo report saved to: ' + out);\n`);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

const screener = (repo) => spawnSync('bash', [path.join(TOOLS, 'screener-check.sh')], { encoding: 'utf8', env: { ...process.env, SCREENER_REPO: repo, SECRET_SWEEP_NO_GITLEAKS: '1' }, timeout: 120_000 });
const ALL = ['report.html', 'reviewers/index.json', 'debate/clusters.json', 'debate/adjudication.json', 'general-review.json'];

test('a block that prints the expected line but exits nonzero fails', () => {
  const result = screener(fixtureRepo([["sh -c 'echo banner; exit 3'", 'banner']]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exit 3/);
});

test('a demo that prints the banner without its debate, general review and reviewers fails', () => {
  const result = screener(fixtureRepo([['node demo.mjs', 'DEMO — not a review']], ['report.html']));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no reviewers\/index\.json, debate\/clusters\.json, debate\/adjudication\.json, general-review\.json/);
});

test('a demo with its real output passes, then the secret sweep runs', () => {
  const result = screener(fixtureRepo([['node demo.mjs', 'DEMO — not a review']], ALL));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /screener ok: node demo\.mjs/);
  assert.match(result.stdout, /secret sweep ok\nscreener check ok/);
});
