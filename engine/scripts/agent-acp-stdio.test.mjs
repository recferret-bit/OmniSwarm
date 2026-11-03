import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serveAcpStdio } from './agent-acp-stdio.mjs';

function serve(agent, options = {}) {
  const input = new PassThrough();
  const sent = [];
  serveAcpStdio(agent, { errorReason: 'provider_error', input, send: (msg) => sent.push(msg), ...options });
  return { input, sent };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('requests are answered by id, errors carry the agent reason or the default', async () => {
  const agent = { request: async (method) => { if (method === 'bad') throw Object.assign(new Error('x'), { reason: 'model_mismatch' }); if (method === 'boom') throw new Error('x'); return { ok: method }; } };
  const { input, sent } = serve(agent);
  input.write('{"id":1,"method":"initialize"}\n\n{"id":2,"method":"bad"}\n{"id":3,"method":"boom"}\n{"method":"notify"}\n');
  await tick(); await tick();
  assert.deepEqual(sent.find((m) => m.id === 1), { id: 1, result: { ok: 'initialize' } });
  assert.equal(sent.find((m) => m.id === 2).error.message, 'model_mismatch');
  assert.equal(sent.find((m) => m.id === 3).error.message, 'provider_error');
  assert.equal(sent.length, 3);
});

test('a prompt that is still running does not block a cancel', async () => {
  let release;
  const agent = { request: (method) => (method === 'session/prompt' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ cancelled: true })) };
  const { input, sent } = serve(agent);
  input.write('{"id":1,"method":"session/prompt"}\n{"id":2,"method":"session/cancel"}\n');
  await tick(); await tick();
  assert.deepEqual(sent.map((m) => m.id), [2]);
  release({ stopReason: 'cancelled' });
  await tick();
  assert.deepEqual(sent.map((m) => m.id), [2, 1]);
});

test('an unparseable or oversized frame ends input and runs onAbort; stdin end runs onEnd', async () => {
  const saved = process.exitCode;
  try {
    let aborted = 0; let ended = 0;
    const bad = serve({ request: async () => ({}) }, { onAbort: () => { aborted += 1; } });
    bad.input.write('not json\n');
    assert.equal(aborted, 1);
    assert.equal(bad.input.destroyed, true);
    const big = serve({ request: async () => ({}) }, { onAbort: () => { aborted += 1; } });
    big.input.write('x'.repeat(4 * 1024 * 1024 + 1));
    assert.equal(aborted, 2);
    const done = serve({ request: async () => ({}) }, { onEnd: () => { ended += 1; } });
    done.input.end();
    await tick();
    assert.equal(ended, 1);
    assert.equal(process.exitCode, 2);
  } finally { process.exitCode = saved; }
});
