// GET /api/ledger (W09-18, INTAKE section 4, public): sales, model costs and refunds per paid request
// for the web ledger page. Request ids, repos, amounts and costs only; never an account.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ledgerRows, ledgerTotals } from '../../db/repositories/costs.ts';
import type { Db } from '../../db/pool.ts';
import type { ApiDeps } from '../../http/deps.ts';
import { perMinute } from '../../http/plugins/rate-limit.ts';
import { errorResponse, ledgerResponse } from '../../http/schemas.ts';

export const LEDGER_LIMIT = 500;

export async function readLedger(db: Db) {
  const [rows, totals] = await Promise.all([ledgerRows(db, LEDGER_LIMIT), ledgerTotals(db)]);
  return {
    entries: rows.map((row) => ({
      requestId: row.id, repo: row.repo, status: row.status, priceYocto: row.price_yocto, paidYocto: row.paid_yocto,
      modelCostUsd: Number(row.cost_usd), reviewers: row.reviewers, ...(row.refund_tx ? { refundTx: row.refund_tx } : {}),
    })),
    totals: {
      requests: totals.requests, salesYocto: totals.sales_yocto, refundedYocto: totals.refunded_yocto,
      modelCostUsd: Math.round(Number(totals.cost_usd) * 1e6) / 1e6,
    },
  };
}

export const ledgerRoutes: FastifyPluginAsyncZod<{ deps: ApiDeps }> = async (app, { deps }) => {
  app.get('/api/ledger', {
    config: perMinute(deps.config.http.rateLimitPerMinute),
    schema: { summary: 'Public ledger: deposits, model costs and refunds per paid request', response: { 200: ledgerResponse, 429: errorResponse } },
  }, async () => readLedger(deps.pool));
};
