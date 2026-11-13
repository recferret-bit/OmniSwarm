// W08-01: the zod DTOs and the error enum agree with packages/schemas/intake-api.schema.json.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadSchema, SCHEMA_DIR } from '@omniswarm/schemas';
import type { ZodType } from 'zod';
import * as dto from '../../src/http/schemas.ts';
import { STATUSES } from '../../src/modules/requests/state.ts';
import { ERROR_CODES } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const DEFS = (loadSchema('intake-api') as { $defs: Record<string, { enum?: string[] }> }).$defs;

const BY_DEF: Record<string, ZodType> = {
  'error-response': dto.errorResponse, 'challenge-response': dto.challengeResponse, 'request-status-response': dto.requestStatusResponse,
  'progress-event': dto.progressEvent, 'request-list-response': dto.requestListResponse, 'health-response': dto.healthResponse,
  'ready-response': dto.readyResponse, 'report-index-response': dto.reportIndexResponse,
};

test('error codes and statuses are the schema enums', () => {
  assert.deepEqual([...ERROR_CODES].sort(), [...(DEFS['error-code']?.enum ?? [])].sort());
  assert.deepEqual([...STATUSES].sort(), [...(DEFS.status?.enum ?? [])].sort());
  assert.equal(dto.errorResponse.safeParse({ error: { code: 'NOT_A_CODE', message: 'x', retryable: false } }).success, false);
});

test('the committed openapi.json matches the routes (npm run openapi -- --check)', () => {
  const run = spawnSync(process.execPath, [path.join(APP_ROOT, 'scripts/openapi.ts'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('every intake-api example validates (or fails) the same way through the DTOs', () => {
  const dir = path.join(SCHEMA_DIR, 'examples', 'intake-api');
  let checked = 0;
  for (const file of fs.readdirSync(dir)) {
    const [kind, rest] = [file.split('-', 1)[0], file.slice(file.indexOf('-') + 1)];
    const def = rest.split('--')[0] ?? '';
    const schema = BY_DEF[def];
    if (!schema) continue;
    const value: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(schema.safeParse(value).success, kind === 'valid', file);
    checked++;
  }
  assert.ok(checked >= 8, `checked ${checked} examples`);
});
