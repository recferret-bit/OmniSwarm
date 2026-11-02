#!/usr/bin/env node
// Root-script helper for tracks whose package does not exist yet (PRODUCT_WAVES section 4, "Root scripts").
//   node tools/gate.mjs <label> <probe-path> -- <command> [args...]   run the command once <probe-path> exists
//   node tools/gate.mjs <label> --pending <text>                      reserved name, prints "<label>: <text>"
// Extra arguments given to the npm script (`npm run test:e2e -- landing`) are appended to <command>.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [label, probe, ...rest] = process.argv.slice(2);
if (!label || !probe) { process.stderr.write('usage: gate.mjs <label> <probe-path> -- <command...> | gate.mjs <label> --pending <text>\n'); process.exit(2); }

if (probe === '--pending') {
  process.stdout.write(`${label}: ${rest.join(' ') || 'not built yet'}\n`);
  process.exit(0);
}
if (!fs.existsSync(path.join(ROOT, probe))) {
  process.stdout.write(`${label}: skipped (no package yet)\n`);
  process.exit(0);
}
const cut = rest.indexOf('--');
const [cmd, ...args] = cut === -1 ? rest : rest.slice(cut + 1);
if (!cmd) { process.stderr.write('gate.mjs: missing command\n'); process.exit(2); }
const run = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
