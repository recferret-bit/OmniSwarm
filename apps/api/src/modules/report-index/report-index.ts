// GET /api/reports/:id (INTAKE section 4, public): the index of a published report, plus one receipt.
// The hash and URL come from the request row (what was attested), the reviewer list and the general
// review from the published copy's manifest (REPORTS_ROOT/<id>/published.json, read-only), and the
// attestation from the registry itself. The receipt is assembled from the payment row, each
// reviewers/<id>/usage.json, findings-and-scores.json and the chain tx ids. Nothing is estimated.
import fs from 'node:fs';
import path from 'node:path';
import type { ChainAttestation, ChainPort } from '../../chain/port.ts';
import type { Config } from '../../config/load.ts';
import type { Db } from '../../db/pool.ts';
import { findRequest, type RequestRow } from '../../db/repositories/requests.ts';
import { fail } from '../../shared/errors.ts';
import { readJson } from '../../worker/classify.ts';
import { readPublished } from '../../worker/publish.ts';

export interface ReportIndexDeps { config: Config; pool: Db; chain: ChainPort }

const PASSED = new Set(['CONFIRMED', 'LIKELY', 'REFUTED']);

export interface ReceiptReviewer {
  id: string; vendor: string; model: string; calls: number; tokens: number; usd: number;
}

export interface Receipt {
  paid: { yocto: string; tx: string };
  reviewers: ReceiptReviewer[];
  check: { passed: number; total: number; byStatus: Record<string, number> };
  attestation?: { tx: string; hash: string; match?: boolean };
  refund?: { tx: string; yocto?: string };
}

/** packages/schemas/attestation.schema.json */
export function attestationDto(a: ChainAttestation) {
  return {
    requestHash: a.requestHash, reportSha256: a.reportSha256, reportUri: a.reportUri, deployed: a.deployed, codeHash: a.codeHash,
    maxSeverity: a.maxSeverity, repo: a.repo, commit: a.commit, bindingConfirmed: a.bindingConfirmed, blockHeight: a.blockHeight,
    ...(a.blockTimestampMs !== null ? { blockTimestampMs: a.blockTimestampMs } : {}),
  };
}

function reviewersOf(dir: string): string[] {
  const groups = readJson(path.join(dir, 'reviewers', 'index.json'))?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group: { reviewers?: unknown }) => (Array.isArray(group?.reviewers) ? group.reviewers : []))
    .filter((id: unknown): id is string => typeof id === 'string');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Calls, tokens and USD from one usage.json. Totals win; otherwise the passes add up. */
export function usageTotals(usage: Record<string, unknown> | null): { calls: number; tokens: number; usd: number } | null {
  if (!usage) return null;
  const totals = usage.totals as { calls?: unknown; tokensIn?: unknown; tokensOut?: unknown; cost?: unknown } | undefined;
  const fromTotals = totals && whole(totals.calls) !== null && whole(totals.tokensIn) !== null && whole(totals.tokensOut) !== null && money(totals.cost) !== null
    ? { calls: whole(totals.calls)!, tokens: whole(totals.tokensIn)! + whole(totals.tokensOut)!, usd: money(totals.cost)! }
    : null;
  if (fromTotals) return fromTotals;
  if (!Array.isArray(usage.passes)) return null;
  let calls = 0;
  let tokens = 0;
  let usd = 0;
  for (const pass of usage.passes) {
    const row = pass as { calls?: unknown; tokensIn?: unknown; tokensOut?: unknown; cost?: unknown };
    const oneCalls = whole(row?.calls);
    const tokensIn = whole(row?.tokensIn);
    const tokensOut = whole(row?.tokensOut);
    const cost = money(row?.cost);
    if (oneCalls === null || tokensIn === null || tokensOut === null || cost === null) return null;
    calls += oneCalls;
    tokens += tokensIn + tokensOut;
    usd += cost;
  }
  return { calls, tokens, usd };
}

function identityRow(id: unknown, vendor: unknown, model: unknown): { id: string; vendor: string; model: string } | null {
  const reviewerId = text(id);
  const vendorName = text(vendor);
  const modelName = text(model);
  return reviewerId && vendorName && modelName ? { id: reviewerId, vendor: vendorName, model: modelName } : null;
}

/** Vendor and model as the report stored them. A bare reviewer id is not turned into either. */
function identities(dir: string): { id: string; vendor: string; model: string }[] {
  const index = readJson(path.join(dir, 'reviewers', 'index.json'));
  const found: { id: string; vendor: string; model: string }[] = [];
  const groups = Array.isArray(index?.groups) ? index.groups : [];
  for (const group of groups) {
    const vendors = Array.isArray(group?.vendors) ? group.vendors : [];
    for (const bucket of vendors) {
      const reviewers = Array.isArray(bucket?.reviewers) ? bucket.reviewers : [];
      for (const reviewer of reviewers) {
        const row = identityRow(reviewer?.id, reviewer?.vendor ?? bucket?.vendor, reviewer?.model);
        if (row) found.push(row);
      }
    }
  }
  if (found.length) return found;
  const meta = readJson(path.join(dir, 'meta.json'));
  const reviewers = Array.isArray(meta?.reviewers) ? meta.reviewers : [];
  return reviewers.flatMap((reviewer: { id?: unknown; vendor?: unknown; model?: unknown }) => {
    const row = identityRow(reviewer?.id, reviewer?.vendor, reviewer?.model);
    return row ? [row] : [];
  });
}

function findingStatus(row: { finalStatus?: unknown; status?: unknown }): string {
  const status = row.finalStatus ?? row.status;
  return typeof status === 'string' ? status : '';
}

/** CONFIRMED, LIKELY and REFUTED passed the check. Every other stored status is only counted. */
export function checkFromFindings(value: unknown): Receipt['check'] {
  const rows = Array.isArray(value) ? value
    : value && typeof value === 'object' && Array.isArray((value as { findings?: unknown }).findings)
      ? (value as { findings: unknown[] }).findings : [];
  const byStatus: Record<string, number> = {};
  let passed = 0;
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    total += 1;
    const status = findingStatus(row as { finalStatus?: unknown; status?: unknown });
    if (!status) continue;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (PASSED.has(status)) passed += 1;
  }
  return { passed, total, byStatus };
}

function artifactDir(reportsRoot: string, runsRoot: string, requestId: string): string | null {
  const published = readPublished(reportsRoot, requestId);
  if (published && fs.existsSync(published.dir)) return published.dir;
  const base = path.join(runsRoot, requestId);
  if (!fs.existsSync(base)) return null;
  const attempts = fs.readdirSync(base).filter((name) => fs.existsSync(path.join(base, name, 'report'))).sort();
  const latest = attempts.at(-1);
  return latest ? path.join(base, latest, 'report') : null;
}

export function reviewersFromDir(dir: string | null): ReceiptReviewer[] {
  if (!dir) return [];
  return identities(dir).flatMap((identity) => {
    const usage = usageTotals(readJson(path.join(dir, 'reviewers', identity.id, 'usage.json')));
    return usage ? [{ ...identity, ...usage }] : [];
  });
}

interface PaymentRow { tx_hash: string; amount_yocto: string }

async function paymentOf(pool: Db, requestId: string): Promise<PaymentRow | null> {
  const result = await pool.query<PaymentRow>('SELECT tx_hash, amount_yocto FROM payment WHERE request_id = $1', [requestId]);
  return result.rows[0] ?? null;
}

export function buildReceipt(input: {
  paid: { yocto: string; tx: string };
  dir: string | null;
  findings: unknown;
  attestation: { tx: string; hash: string; match?: boolean } | null;
  refund: { tx: string; yocto?: string } | null;
}): Receipt {
  const receipt: Receipt = {
    paid: input.paid,
    reviewers: reviewersFromDir(input.dir),
    check: checkFromFindings(input.findings),
  };
  if (input.refund) receipt.refund = input.refund;
  else if (input.attestation) receipt.attestation = input.attestation;
  return receipt;
}

function receiptFor(row: RequestRow, paid: PaymentRow, dir: string | null, chainAttestation: ChainAttestation | null): Receipt {
  const yocto = String(paid.amount_yocto);
  const findings = dir ? readJson(path.join(dir, 'findings-and-scores.json')) : null;
  if (row.status === 'refunded') {
    if (!row.refund_tx) fail('NOT_FOUND', 'Refund has no transaction');
    return buildReceipt({
      paid: { yocto, tx: paid.tx_hash }, dir, findings,
      attestation: null,
      refund: { tx: row.refund_tx, yocto },
    });
  }
  const attestation = row.attest_tx && chainAttestation
    ? {
      tx: row.attest_tx,
      hash: chainAttestation.reportSha256,
      ...(row.report_sha256 ? { match: row.report_sha256 === chainAttestation.reportSha256 } : {}),
    }
    : null;
  return buildReceipt({ paid: { yocto, tx: paid.tx_hash }, dir, findings, attestation, refund: null });
}

export interface ReportIndexBody {
  requestId: string;
  reportUrl?: string;
  reportSha256?: string;
  reviewers?: string[];
  generalReviewUrl?: string;
  attestation?: ReturnType<typeof attestationDto>;
  receipt?: Receipt;
}

export async function reportIndex(deps: ReportIndexDeps, requestId: string): Promise<ReportIndexBody> {
  const row = await findRequest(deps.pool, requestId);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  const paid = await paymentOf(deps.pool, row.id);
  if (row.status === 'refunded') {
    if (!paid) fail('NOT_FOUND', 'Refunded request has no payment');
    const dir = artifactDir(deps.config.storage.reportsRoot, deps.config.storage.runsRoot, row.id);
    return { requestId: row.id, receipt: receiptFor(row, paid, dir, null) };
  }
  if (row.status !== 'done' || !row.report_sha256 || !row.report_url) fail('NOT_FOUND', 'Report not published yet');
  const base = `${deps.config.storage.reportsBaseUrl}/${row.id}`;
  const published = readPublished(deps.config.storage.reportsRoot, row.id);
  const hasGeneral = published?.files.includes('general-review.json') ?? false;
  const reviewers = published && fs.existsSync(published.dir) ? reviewersOf(published.dir) : [];
  const attestation = await deps.chain.getAttestation(row.request_hash);
  const dir = published && fs.existsSync(published.dir) ? published.dir : null;
  return {
    requestId: row.id, reportUrl: row.report_url, reportSha256: row.report_sha256,
    ...(reviewers.length ? { reviewers } : {}),
    ...(hasGeneral ? { generalReviewUrl: `${base}/general-review.json` } : {}),
    ...(attestation ? { attestation: attestationDto(attestation) } : {}),
    ...(paid ? { receipt: receiptFor(row, paid, dir, attestation) } : {}),
  };
}
