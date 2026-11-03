// npm run test:schemas [-- <schema-name> ...]
// Runs the schema example tests (filtered when names are given) and, when unfiltered, the canonical-message,
// canonical-json and nep413 helper tests.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2);
const files = [path.join(dir, 'schemas.test.mjs')];
if (!names.length) for (const name of ['canonical-message', 'canonical-json', 'nep413']) files.push(path.join(dir, `${name}.test.mjs`));
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, SCHEMA_FILTER: names.join(' ') } });
process.exit(run.status ?? 1);
