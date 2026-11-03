// GET /api/reports/:id (INTAKE section 4, public): the index of a published report. The hash and URL
// come from the request row (what was attested), the reviewer list and the general review from the
// published copy's manifest (REPORTS_ROOT/<id>/published.json, read-only), and the attestation from
// the registry itself, so a reader can compare the attested hash with the one it recomputes.
import fs from 'node:fs';
import path from 'node:path';
import type { ChainAttestation, ChainPort } from '../../chain/port.ts';
import type { Config } from '../../config/load.ts';
import type { Db } from '../../db/pool.ts';
import { findRequest } from '../../db/repositories/requests.ts';
import { fail } from '../../shared/errors.ts';
import { readJson } from '../../worker/classify.ts';
import { readPublished } from '../../worker/publish.ts';

export interface ReportIndexDeps { config: Config; pool: Db; chain: ChainPort }

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

export async function reportIndex(deps: ReportIndexDeps, requestId: string) {
  const row = await findRequest(deps.pool, requestId);
  if (!row) fail('REQUEST_NOT_FOUND', 'Request not found');
  if (row.status !== 'done' || !row.report_sha256 || !row.report_url) fail('NOT_FOUND', 'Report not published yet');
  const base = `${deps.config.storage.reportsBaseUrl}/${row.id}`;
  const published = readPublished(deps.config.storage.reportsRoot, row.id);
  const hasGeneral = published?.files.includes('general-review.json') ?? false;
  const reviewers = published && fs.existsSync(published.dir) ? reviewersOf(published.dir) : [];
  const attestation = await deps.chain.getAttestation(row.request_hash);
  return {
    requestId: row.id, reportUrl: row.report_url, reportSha256: row.report_sha256,
    ...(reviewers.length ? { reviewers } : {}),
    ...(hasGeneral ? { generalReviewUrl: `${base}/general-review.json` } : {}),
    ...(attestation ? { attestation: attestationDto(attestation) } : {}),
  };
}
