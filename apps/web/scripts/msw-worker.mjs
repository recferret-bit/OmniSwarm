// Runs before `next dev` and `next build`. With NEXT_PUBLIC_API_MOCK=1 it copies
// msw's mockServiceWorker.js into public/; otherwise it deletes any copy, so a
// production build never ships the worker. Env comes from the shell and the
// committed .env files, loaded the way Next loads them.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
nextEnv.loadEnvConfig(root, dev, { info() {}, error: console.error });

const target = path.join(root, 'public', 'mockServiceWorker.js');
if (process.env.NEXT_PUBLIC_API_MOCK === '1') {
  const source = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js');
  fs.copyFileSync(source, target);
  console.log('msw: public/mockServiceWorker.js copied (NEXT_PUBLIC_API_MOCK=1)');
} else if (fs.existsSync(target)) {
  fs.rmSync(target);
  console.log('msw: removed public/mockServiceWorker.js (mocks are off)');
}
