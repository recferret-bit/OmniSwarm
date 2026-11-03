// The client's own unit tests. They run offline with node:test against the locked near-api-js.
// Browser storage is replaced with an in-memory stand-in; the key pair is generated per run, never committed.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { KeyPair } from 'near-api-js';
import { account, remember } from '../src/wallet.ts';

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

beforeEach(() => {
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
  }
});

test('remember keeps the account id for the session and returns it', () => {
  assert.equal(remember('alice.testnet'), 'alice.testnet');
  assert.equal(sessionStorage.getItem('near-account'), 'alice.testnet');
});

test('account parses an ed25519 secret into the matching key pair', () => {
  const generated = KeyPair.fromRandom('ed25519');
  const parsed = account(generated.toString());
  assert.equal(parsed.getPublicKey().toString(), generated.getPublicKey().toString());
});

test('account rejects a malformed secret', () => {
  assert.throws(() => account('ed25519:not-a-key'));
});
