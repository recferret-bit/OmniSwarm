import { buildSignedRequest, encodeKey, generateKeyPair } from '../src/lib.ts';
import { createPool, migrate, putKey } from '../src/store.ts';

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const databaseUrl = process.env.DATABASE_URL || arg('database-url');
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const account = arg('account', 'alice.mock');
const permission = arg('permission', 'FullAccess') === 'FunctionCall' ? 'FunctionCall' : 'FullAccess';
const keys = generateKeyPair();
const pool = createPool(databaseUrl);
await migrate(pool);
await putKey(pool, account, encodeKey(keys.rawPublic), permission);
const body = await buildSignedRequest({
  privateKey: keys.privateKey,
  rawPublic: keys.rawPublic,
  accountId: account,
  repo: arg('repo', 'near/near-sdk-rs'),
  commit: arg('commit', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'),
  nonce: arg('nonce'),
  recipient: process.env.INTAKE_RECIPIENT || 'omniswarm.testnet',
  network: arg('network', 'testnet'),
  preset: arg('preset', 'scripted'),
});
await pool.end();
process.stdout.write(`${JSON.stringify(body)}\n`);
