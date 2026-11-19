import crypto from 'node:crypto';
import { utils } from 'near-api-js';
import { DstackClient } from '@phala/dstack-sdk';
import { verifyAttestationReport } from 'nearai-cloud-verifier';

const NEP413_TAG = 2147484061;

export function createEnclaveClient() {
  const endpoint = process.env.DSTACK_SIMULATOR_ENDPOINT || '/var/run/dstack.sock';
  return new DstackClient(endpoint);
}

export function verifyNep413Session(publicKey: string, payloadBorsh: Uint8Array, signature: Uint8Array) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(NEP413_TAG, 0);
  const digest = crypto.createHash('sha256').update(Buffer.concat([prefix, Buffer.from(payloadBorsh)])).digest();
  return utils.PublicKey.fromString(publicKey).verify(digest, signature);
}

export async function executeOneClickQuote(sendTransfer: (to: string, amount: bigint) => Promise<void>, requestedAmount: bigint) {
  const res = await fetch('https://1click.chaindefuser.com/v0/quote');
  const quote = await res.json();
  await sendTransfer(quote.depositAddress, requestedAmount);
}

export async function verifyConfidentialModelReply(model: string, responseBody: string, responseSig: string) {
  const nonce = crypto.randomBytes(32).toString('hex');
  const res = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}`);
  const report = await res.json();
  return verifyAttestationReport({ report, expectedNonce: nonce, responseBody, responseSig });
}
