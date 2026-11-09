// W18-02: GET /api/reports/:id receipt comes from the payment row, usage.json, findings statuses and chain tx ids.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validate } from '@omniswarm/schemas';
import type { ChainAttestation, ChainPort } from '../../src/chain/port.ts';
import type { Config } from '../../src/config/load.ts';
import type { Db } from '../../src/db/pool.ts';
import type { RequestRow } from '../../src/db/repositories/requests.ts';
import { reportIndex } from '../../src/modules/report-index/report-index.ts';

const ID = '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10';
const HASH = 'b'.repeat(64);
const REQUEST_HASH = 'c'.repeat(64);
const YOCTO = '1000000000000000000000000';

const attestation: ChainAttestation = {
  requestHash: REQUEST_HASH, repo: 'near/example', commit: 'd'.repeat(40), reportSha256: HASH,
  reportUri: 'https://reports.example/index.json', deployed: 'vault.test.near', codeHash: '9mZ3dQe1',
  maxSeverity: 'high', blockHeight: 10, blockTimestampMs: 1, bindingConfirmed: true,
};

function row(status: RequestRow['status'], extra: Partial<RequestRow> = {}): RequestRow {
  return {
    id: ID, account: 'alice.test.near', repo: 'near/example', commit_sha: 'd'.repeat(40), network: 'sandbox', preset: 'panel',
    deployed: 'vault.test.near', request_hash: REQUEST_HASH, price_yocto: YOCTO, status, attempts: 1, failure_cause: null,
    report_sha256: status === 'done' ? HASH : null, report_url: status === 'done' ? `https://reports.example/${ID}/report.html` : null,
    max_severity: 'high', scope: 'full', theme: null, parent_id: null, slice_path: null, incomplete: false,
    attest_tx: status === 'done' ? 'AttestTx111' : null, refund_tx: status === 'refunded' ? 'RefundTx111' : null,
    queued_at: new Date('2026-11-09T00:00:00.000Z'), created_at: new Date('2026-11-09T00:00:00.000Z'), updated_at: new Date('2026-11-09T00:00:00.000Z'),
    ...extra,
  };
}

function writeReport(dir: string): void {
  fs.mkdirSync(path.join(dir, 'reviewers', 'key-zai-glm-5-3'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reviewers', 'index.json'), JSON.stringify({
    groups: [{ family: 'key', label: 'API keys', vendors: [{ vendor: 'zai', reviewers: [{ id: 'key-zai-glm-5-3', model: 'glm-5.3' }] }] }],
    totals: {}, pages: [],
  }));
  fs.writeFileSync(path.join(dir, 'reviewers', 'key-zai-glm-5-3', 'usage.json'), JSON.stringify({
    passes: [], totals: { calls: 4, tokensIn: 1000, tokensOut: 800, cost: 0.02 },
  }));
  fs.writeFileSync(path.join(dir, 'findings-and-scores.json'), JSON.stringify([
    { id: 'F-1', finalStatus: 'CONFIRMED' },
    { id: 'F-2', finalStatus: 'REFUTED' },
    { id: 'F-3', status: 'DISPUTED' },
  ]));
  fs.writeFileSync(path.join(dir, 'general-review.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'published.json'), JSON.stringify({
    reportSha256: HASH, files: ['findings-and-scores.json', 'general-review.json', 'reviewers/index.json'],
  }));
}

function deps(root: string, current: RequestRow): { config: Config; pool: Db; chain: ChainPort } {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('FROM payment')) return { rows: [{ tx_hash: 'PayTx111', amount_yocto: YOCTO }] };
      if (sql.includes('FROM request')) return { rows: [current] };
      return { rows: [] };
    },
  } as unknown as Db;
  const chain = { getAttestation: async () => attestation } as unknown as ChainPort;
  const config = { storage: { reportsRoot: root, runsRoot: path.join(root, 'runs'), reportsBaseUrl: 'https://reports.example' } } as Config;
  return { config, pool, chain };
}

test('a fixture report gives the expected receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-receipt-'));
  writeReport(path.join(root, ID));
  const body = await reportIndex(deps(root, row('done')), ID);
  assert.equal(body.reportSha256, HASH);
  assert.ok(body.receipt);
  assert.deepEqual(body.receipt, {
    paid: { yocto: YOCTO, tx: 'PayTx111' },
    reviewers: [{ id: 'key-zai-glm-5-3', vendor: 'zai', model: 'glm-5.3', calls: 4, tokens: 1800, usd: 0.02 }],
    check: { passed: 2, total: 3, byStatus: { CONFIRMED: 1, REFUTED: 1, DISPUTED: 1 } },
    attestation: { tx: 'AttestTx111', hash: HASH, match: true },
  });
  assert.equal('refund' in (body.receipt ?? {}), false);
  assert.equal(validate('intake-api#report-index-response', body).ok, true, validate('intake-api#report-index-response', body).errors?.join('; '));
});

test('a refunded request has refund and no attestation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-receipt-'));
  const body = await reportIndex(deps(root, row('refunded')), ID);
  assert.deepEqual(body, {
    requestId: ID,
    receipt: {
      paid: { yocto: YOCTO, tx: 'PayTx111' },
      reviewers: [],
      check: { passed: 0, total: 0, byStatus: {} },
      refund: { tx: 'RefundTx111', yocto: YOCTO },
    },
  });
  if (!body.receipt) throw new Error('missing receipt');
  assert.equal('attestation' in body.receipt, false);
  assert.equal(validate('intake-api#report-index-response', body).ok, true);
});
