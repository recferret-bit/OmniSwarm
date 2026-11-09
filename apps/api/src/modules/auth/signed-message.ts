// The signed request message must be exactly the canonical form built by
// @omniswarm/schemas/canonical-message: the same eight keys, sorted, no whitespace, v = 1.
// Anything else (an extra key, a reordered or pretty-printed body, a bad field) is MESSAGE_INVALID.
import { canonicalRequestMessage } from '@omniswarm/schemas/canonical-message';
import { z } from 'zod';
import { fail } from '../../shared/errors.ts';
import { accountId, commitSha, nonce, preset, repo } from '../../shared/patterns.ts';

const messageSchema = z.strictObject({
  account: accountId,
  commit: commitSha,
  deployed: accountId.nullable(),
  network: z.enum(['testnet', 'mainnet', 'sandbox']),
  nonce,
  preset,
  repo,
  v: z.literal(1),
});

export type SignedMessage = z.infer<typeof messageSchema>;

export function parseSignedMessage(message: string): SignedMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    fail('MESSAGE_INVALID', 'The signed message is not JSON');
  }
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail('MESSAGE_INVALID', `The signed message is invalid at ${issue?.path.join('.') || '$'}: ${issue?.message ?? 'bad value'}`);
  }
  const { v: _v, ...fields } = parsed.data;
  if (canonicalRequestMessage(fields) !== message) fail('MESSAGE_INVALID', 'The signed message is not in canonical form');
  return parsed.data;
}
