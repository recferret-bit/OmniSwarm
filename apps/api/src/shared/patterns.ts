// Field patterns shared by DTOs and the job payload. They mirror the `$defs` of
// packages/schemas/intake-api.schema.json and job.schema.json (test/unit/dto.test.ts checks the DTOs
// against that schema's examples).
import { z } from 'zod';

export const accountId = z.string().regex(/^[a-z0-9._-]{2,64}$/, 'not a NEAR account id');
export const repo = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'not owner/repo');
export const commitSha = z.string().regex(/^[0-9a-f]{40}$/, 'not a 40-hex commit');
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'not a 64-hex sha256');
export const nonce = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'not a 32-byte base64 nonce');
export const preset = z.string().regex(/^[a-z0-9-]{1,40}$/, 'not a preset name');
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'not a UUIDv4');
