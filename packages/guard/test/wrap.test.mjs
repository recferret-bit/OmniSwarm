import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard, GuardBlockedError, GuardWarnDeclinedError } from '../index.mjs';
import { NOW, reader, spySigner, transferIntent } from './chain.mjs';

const guard = () => createGuard({ reader: reader(), now: () => NOW });

test('the receiver is checked, not the signer: a clean signer paying a reported account is blocked', async () => {
  const { calls, signer } = spySigner();
  const wrapped = guard().wrap(signer);
  const error = await assert.rejects(wrapped.signAndSendTransaction(transferIntent('attacker.testnet', 'clean.testnet')), GuardBlockedError);
  assert.equal(calls.length, 0);
  return error;
});

test('block is decided by an async lookup that is awaited before the signer', async () => {
  const { calls, signer } = spySigner();
  const slow = createGuard({
    source: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { verdict: 'block', reasons: ['REPORTED'], signals: {} };
    },
  });
  await assert.rejects(slow.wrap(signer).signAndSendTransaction(transferIntent('clean.testnet')), (e) => e.code === 'GUARD_BLOCK');
  assert.equal(calls.length, 0);
});

test('reasons from a remote source that are not known codes are kept', async () => {
  const { calls, signer } = spySigner();
  const remote = createGuard({ source: async () => ({ verdict: 'block', reasons: ['custom text', 'REPORTED'], signals: {} }) });
  const verdict = await remote.checkIntent(transferIntent('clean.testnet'));
  assert.deepEqual(verdict.reasons, ['REPORTED', 'custom text']);
  await assert.rejects(remote.wrap(signer).signAndSendTransaction(transferIntent('clean.testnet')), /REPORTED, custom text/);
  assert.equal(calls.length, 0);
});

test('allow reaches the signer once with the same params', async () => {
  const { calls, signer } = spySigner();
  const intent = transferIntent('clean.testnet');
  const result = await guard().wrap(signer).signAndSendTransaction(intent);
  assert.deepEqual(result, { transaction: { hash: 'spy' } });
  assert.deepEqual(calls, [{ method: 'signAndSendTransaction', params: intent }]);
});

test('warn asks onWarn; only exactly true proceeds', async () => {
  for (const answer of [false, undefined, 1, 'yes', {}, Promise.resolve('true')]) {
    const { calls, signer } = spySigner();
    let asked = 0;
    const wrapped = guard().wrap(signer, { onWarn: () => { asked += 1; return answer; } });
    await assert.rejects(wrapped.signAndSendTransaction(transferIntent('unreviewed.testnet')), GuardWarnDeclinedError);
    assert.equal(asked, 1);
    assert.equal(calls.length, 0, String(answer));
  }
  const { calls, signer } = spySigner();
  let seen;
  const wrapped = guard().wrap(signer, { onWarn: async (verdict) => { seen = verdict; return true; } });
  await wrapped.signAndSendTransaction(transferIntent('unreviewed.testnet'));
  assert.equal(calls.length, 1);
  assert.deepEqual(seen.reasons, ['CONTRACT_NOT_REVIEWED']);
  assert.equal(seen.targets[0].accountId, 'unreviewed.testnet');
});

test('warn without onWarn is declined', async () => {
  const { calls, signer } = spySigner();
  await assert.rejects(guard().wrap(signer).transfer({ receiverId: 'new-user.testnet', amount: '1' }), GuardWarnDeclinedError);
  assert.equal(calls.length, 0);
});

test('a lookup that throws goes to onWarn with SIGNAL_UNAVAILABLE', async () => {
  const { calls, signer } = spySigner();
  const broken = createGuard({ source: async () => { throw new Error('rpc down'); } });
  let seen;
  await assert.rejects(broken.wrap(signer, { onWarn: (v) => { seen = v; return false; } }).transfer({ receiverId: 'clean.testnet', amount: '1' }), GuardWarnDeclinedError);
  assert.deepEqual(seen.reasons, ['SIGNAL_UNAVAILABLE']);
  assert.equal(seen.targets[0].signals.error, 'rpc down');
  assert.equal(calls.length, 0);
});

test('a malformed verdict from a source is treated as unavailable', async () => {
  const { calls, signer } = spySigner();
  const odd = createGuard({ source: async () => ({ verdict: 'ALLOW', reasons: [], signals: {} }) });
  await assert.rejects(odd.wrap(signer).transfer({ receiverId: 'clean.testnet', amount: '1' }), GuardWarnDeclinedError);
  assert.equal(calls.length, 0);
});

test('every transaction in a batch is checked before any is signed', async () => {
  const { calls, signer } = spySigner();
  const batch = { transactions: [transferIntent('clean.testnet'), transferIntent('critical.testnet')] };
  const error = await assert.rejects(guard().wrap(signer).signAndSendTransactions(batch), GuardBlockedError);
  assert.equal(calls.length, 0);
  return error;
});

test('a payee inside function-call args is checked (ft_transfer.receiver_id)', async () => {
  const { calls, signer } = spySigner();
  const intent = {
    receiverId: 'token.testnet',
    actions: [{ type: 'FunctionCall', params: { methodName: 'ft_transfer', args: { receiver_id: 'attacker.testnet', amount: '5' }, deposit: '1' } }],
  };
  const verdict = await guard().checkIntent(intent);
  assert.deepEqual(verdict.targets.map((t) => [t.accountId, t.role, t.verdict]), [['token.testnet', 'receiver', 'allow'], ['attacker.testnet', 'beneficiary', 'block']]);
  await assert.rejects(guard().wrap(signer).signAndSendTransaction(intent), GuardBlockedError);
  await assert.rejects(guard().wrap(signer).callFunction({ contractId: 'token.testnet', methodName: 'ft_transfer', args: { receiver_id: 'attacker.testnet' } }), GuardBlockedError);
  assert.equal(calls.length, 0);
});

test('near-api-js actions with byte args are read too', async () => {
  const args = new TextEncoder().encode(JSON.stringify({ receiver: 'attacker.testnet' }));
  const verdict = await guard().checkIntent({ receiverId: 'token.testnet', actions: [{ functionCall: { methodName: 'pay_out', args } }] });
  assert.equal(verdict.verdict, 'block');
  assert.equal(verdict.targets[1].via, 'pay_out.receiver');
});

test('an intent without a valid receiver never reaches the signer', async () => {
  const { calls, signer } = spySigner();
  await assert.rejects(guard().wrap(signer).signAndSendTransaction({ receiverId: 'Not Valid', actions: [] }), TypeError);
  await assert.rejects(guard().wrap(signer).signAndSendTransactions({ transactions: [] }), TypeError);
  assert.equal(calls.length, 0);
});

test('the wrapper exposes only intercepted methods', () => {
  const { signer } = spySigner();
  const wrapped = guard().wrap(signer);
  assert.deepEqual(Object.keys(wrapped).sort(), ['callFunction', 'signAndSendTransaction', 'signAndSendTransactions', 'transfer']);
  assert.equal(wrapped.signMessage, undefined);
  assert.ok(Object.isFrozen(wrapped));
});
