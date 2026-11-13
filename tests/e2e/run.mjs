import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = {
  landing: ['landing/flow.test.mjs'],
};
const suite = process.argv[2];
if (suite && !Object.hasOwn(suites, suite)) {
  process.stderr.write(`unknown e2e suite: ${suite}\n`);
  process.exit(2);
}
const files = suites[suite ?? 'landing'];
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: here,
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
