// `near:local view <account> <method> [args-json]`. Prints the JSON view. No keys.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callView, resolveAccount } from './rpc.mjs';

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function usage() {
  console.error('usage: near:local view <account> <method> [args-json]');
}

export async function viewCommand(argv) {
  if (argv[0] !== 'view' || argv.length < 3 || argv.length > 4) {
    usage();
    process.exit(2);
  }
  const account = resolveAccount(argv[1]);
  const method = argv[2];
  let args = {};
  if (argv[3] !== undefined) {
    try {
      args = JSON.parse(argv[3]);
    } catch {
      console.error('view: args are not JSON');
      process.exit(2);
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      console.error('view: args must be a JSON object');
      process.exit(2);
    }
  }
  const result = await callView(account, method, args);
  const text = JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
  process.stdout.write(`${text}\n`);
}

if (isDirectRun()) {
  viewCommand(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`view: ${message}`);
    process.exit(1);
  });
}
