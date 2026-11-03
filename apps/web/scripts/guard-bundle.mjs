import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const built = spawnSync('npx', ['vite', 'build'], { cwd: root, encoding: 'utf8' });
if (built.status !== 0) {
  console.error(built.stderr || built.stdout);
  process.exit(built.status || 1);
}
const walletSource = fs.readFileSync(path.join(root, 'src/mock-wallet.ts'), 'utf8');
for (const token of ['MockConnector', 'ed25519:']) {
  if (!walletSource.includes(token)) {
    console.error(`mock wallet is missing ${token}; the bundle guard would not be checking a real connector`);
    process.exit(1);
  }
}
const dist = path.join(root, 'dist');
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(dist);
const banned = [/ed25519:/, /(?<![A-Za-z])sk-/, /ghp_/, /github_pat_/, /OPENROUTER/, /ZAI_/, /MockConnector/];
const text = files.filter((file) => file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.html')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const hits = banned.filter((token) => token.test(text)).map(String);
if (hits.length) {
  console.error(`production bundle contains ${hits.join(', ')}`);
  process.exit(1);
}
console.log(`production bundle checked (${files.length} files), no mock connector or key-shaped strings`);
