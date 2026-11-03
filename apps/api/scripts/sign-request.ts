// Dev script (W08 demo step 4): make a wallet key, register it on the MOCK chain with the given
// permission, and print a signed POST /api/requests body.
//   node apps/api/scripts/sign-request.ts --account alice.mock --nonce <nonce> [--repo o/r] [--commit sha]
//     [--permission FullAccess|FunctionCall] [--network testnet] [--preset scripted] [--deployed acct] [--seed s]
import { registerKey } from '../src/chain/mock/mock-ledger.ts';
import { createPool } from '../src/db/pool.ts';
import { databaseUrl, devOnly, flags } from './cli.ts';
import { DevWallet } from './dev-wallet.ts';

devOnly('sign-request');
const { values } = flags({
  account: { type: 'string', default: 'alice.mock' }, nonce: { type: 'string' }, repo: { type: 'string', default: 'near/near-sdk-rs' },
  commit: { type: 'string', default: '5c7a2f1e9b3d4c6a8e0f1a2b3c4d5e6f7a8b9c0d' }, permission: { type: 'string', default: 'FullAccess' },
  network: { type: 'string', default: 'testnet' }, preset: { type: 'string', default: 'scripted' }, deployed: { type: 'string' },
  seed: { type: 'string' },
}, 'sign-request.ts --account <id> --nonce <base64> [...]');
if (!values.nonce) {
  process.stderr.write('--nonce is required (POST /api/challenge)\n');
  process.exit(2);
}
const permission = values.permission === 'FunctionCall' ? 'FunctionCall' : 'FullAccess';
const wallet = new DevWallet(values.account, values.seed);
const pool = createPool(databaseUrl(), 1);
try {
  await registerKey(pool, wallet.accountId, wallet.publicKey, permission);
} finally {
  await pool.end();
}
const body = wallet.signRequest({
  commit: values.commit, deployed: values.deployed ?? null, network: values.network, nonce: values.nonce,
  preset: values.preset, repo: values.repo,
}, process.env.INTAKE_RECIPIENT ?? 'omniswarm.testnet');
process.stdout.write(`${JSON.stringify(body)}\n`);
