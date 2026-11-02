import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ACCOUNTS, verdictFor, wrap } from './index.mjs';

test('demo accounts return allow, warn, or block with the reason codes', () => {
  assert.deepEqual(verdictFor('clean.testnet'), { verdict: 'allow', reasons: ['ATTESTED_CLEAN'], account: 'clean.testnet' });
  assert.equal(verdictFor('critical.testnet').verdict, 'block');
  assert.equal(verdictFor('reported.testnet').reasons[0], 'REPORTED');
  assert.equal(verdictFor('changed.testnet').verdict, 'warn');
  assert.equal(verdictFor('new.testnet').reasons[0], 'ACCOUNT_TOO_NEW');
  assert.equal(verdictFor('unreviewed.testnet').reasons[0], 'CONTRACT_NOT_REVIEWED');
  for (const account of Object.keys(DEMO_ACCOUNTS)) {
    const row = verdictFor(account);
    assert.ok(['allow', 'warn', 'block'].includes(row.verdict), account);
  }
});

test('block throws before the signer, and warn asks a human', async () => {
  let signed = 0;
  const signer = { async sign() { signed += 1; return { tx: 'sent' }; } };
  const blocked = wrap(signer);
  await assert.rejects(blocked.sign({ account: 'critical.testnet', method: 'pay' }), /guard blocked/);
  assert.equal(signed, 0);
  let asked = 0;
  const warned = wrap(signer, { onWarn() { asked += 1; return false; } });
  await assert.rejects(warned.sign({ account: 'changed.testnet', method: 'pay' }), /not approved/);
  assert.equal(asked, 1);
  assert.equal(signed, 0);
});
