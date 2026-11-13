// `npm run guard`: builds production (NEXT_PUBLIC_WALLET=real, mocks off) into
// .next-guard and fails if the mock wallet, MSW, the mock controls, the recorded
// sample report hash or any key-shaped string reached first-party output.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, scan } from './bundle-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = '.next-guard';
const env = { ...process.env, NEXT_PUBLIC_WALLET: 'real', NEXT_PUBLIC_API_MOCK: '0', NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' };

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    process.exit(result.status || 1);
  }
}

// The guard is only meaningful if the dev sources still carry the tokens it bans.
const sources = { 'src/mocks/wallet.ts': ['MockConnector', 'ed25519:'], 'src/mocks/MockPanel.tsx': ['Tamper the report', 'Mock mode (dev only)'] };
for (const [file, tokens] of Object.entries(sources)) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const token of tokens) {
    if (!text.includes(token)) {
      console.error(`${file} no longer contains "${token}"; update the guard so it still checks the real mock code`);
      process.exit(1);
    }
  }
}

fs.rmSync(path.join(root, distDir), { recursive: true, force: true });
run(['scripts/msw-worker.mjs']);
run([createRequire(import.meta.url).resolve('next/dist/bin/next'), 'build']);

if (fs.existsSync(path.join(root, 'public/mockServiceWorker.js'))) {
  console.error('public/mockServiceWorker.js exists in a production build');
  process.exit(1);
}
const out = path.join(root, distDir);
const files = [
  ...listFiles(path.join(out, 'static')),
  ...listFiles(path.join(out, 'server/app')),
  ...listFiles(path.join(out, 'server/chunks')),
  ...listFiles(path.join(root, 'public')),
];
const sampleHash = JSON.parse(fs.readFileSync(path.join(root, 'public/sample/report-hash.json'), 'utf8')).reportSha256;
const hits = scan(files.filter((file) => !file.includes(`${path.sep}public${path.sep}sample${path.sep}`)), [sampleHash]);
if (!files.some((file) => file.includes(`${path.sep}static${path.sep}`))) {
  console.error('no client bundle found; the build output layout changed');
  process.exit(1);
}
if (hits.length) {
  for (const hit of hits) console.error(`${path.relative(root, hit.file)}: ${hit.rule}`);
  process.exit(1);
}
console.log(`production bundle checked (${files.length} files): no mock wallet, MSW, mock controls, fixture hash or key-shaped strings`);
