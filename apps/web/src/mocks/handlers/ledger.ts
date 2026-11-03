// Dev/e2e only. GET /api/ledger (public): every paid request, newest first, with the deposit,
// the model cost and the refund, plus totals over all paid requests. Never an account id.
import { http, HttpResponse } from 'msw';
import type { LedgerResponse } from '@/lib/api/schema.gen';
import { readState, type MockRequest } from '../db';
import { REVIEWERS } from '../state-machine';
import { statusOf } from './status';

const LEDGER_LIMIT = 500;
// The cost is recorded once a request is published or refunded. The mock preset is `scripted`,
// whose reviewers cost nothing, so only the reviewer count changes.
const RECORDED = new Set(['done', 'refunded']);

type Entry = LedgerResponse['entries'][number];

async function entryOf(row: MockRequest): Promise<Entry> {
  const status = await statusOf(row);
  const paidYocto = readState().txs[row.txHash!]?.deposit ?? row.priceYocto;
  return {
    requestId: row.id, repo: row.repo, status: status.status, priceYocto: row.priceYocto, paidYocto,
    modelCostUsd: 0, reviewers: RECORDED.has(status.status) ? REVIEWERS.length : 0,
    ...(status.refundTx ? { refundTx: status.refundTx } : {}),
  };
}

function totalsOf(entries: Entry[]): LedgerResponse['totals'] {
  const sum = (rows: Entry[]) => rows.reduce((total, entry) => total + BigInt(entry.paidYocto), 0n).toString();
  return {
    requests: entries.length,
    salesYocto: sum(entries.filter((entry) => entry.status !== 'refunded')),
    refundedYocto: sum(entries.filter((entry) => entry.status === 'refunded')),
    modelCostUsd: entries.reduce((total, entry) => total + entry.modelCostUsd, 0),
  };
}

const ledger = http.get('/api/ledger', async () => {
  const paid = readState().requests.filter((row) => row.paidAt !== null && row.txHash !== null)
    .sort((a, b) => b.paidAt! - a.paidAt! || a.id.localeCompare(b.id));
  const entries = await Promise.all(paid.map(entryOf));
  const body: LedgerResponse = { entries: entries.slice(0, LEDGER_LIMIT), totals: totalsOf(entries) };
  return HttpResponse.json(body);
});

export const ledgerHandlers = [ledger];
