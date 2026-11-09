// Field patterns shared by DTOs, the signed message and the job payload. They mirror the `$defs` of
// packages/schemas/intake-api.schema.json and job.schema.json (test/unit/dto.test.ts checks the DTOs
// against that schema's examples).
import { z } from 'zod';

export const accountId = z.string().regex(/^[a-z0-9._-]{2,64}$/, 'not a NEAR account id');
export const repo = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'not owner/repo');
export const commitSha = z.string().regex(/^[0-9a-f]{40}$/, 'not a 40-hex commit');
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'not a 64-hex sha256');
export const nonce = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'not a 32-byte base64 nonce');
export const preset = z.string().regex(/^[a-z0-9-]{1,40}$/, 'not a preset name');
export const yocto = z.string().regex(/^(0|[1-9][0-9]{0,38})$/, 'not a yocto amount');
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'not a UUIDv4');
export const network = z.enum(['testnet', 'mainnet', 'sandbox']);
export const txHash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/, 'not a base58 tx hash');
export const publicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/, 'not an ed25519 public key');
