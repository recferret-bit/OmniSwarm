// zod DTOs for every route (W08-01). They are the runtime form of
// packages/schemas/intake-api.schema.json; test/unit/dto.test.ts runs that schema's examples through
// them, and the integration tests validate live responses against the JSON Schema itself.
import { z } from 'zod';
import { GUARD_REPORT_STATUSES } from '../db/repositories/guard-reports.ts';
import { STATUSES } from '../modules/requests/state.ts';
import { ERROR_CODES } from '../shared/errors.ts';
import { accountId, commitSha, network, nonce, preset, publicKey, repo, sha256Hex, txHash, uuid, yocto } from '../shared/patterns.ts';

const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
const https = z.string().regex(/^https:\/\/[^\s]+$/);
const status = z.enum(STATUSES);

export const errorResponse = z.strictObject({
  error: z.strictObject({ code: z.enum(ERROR_CODES as [string, ...string[]]), message: z.string().min(1).max(2000), retryable: z.boolean() }),
});

export const challengeRequest = z.strictObject({}).nullish();
export const challengeResponse = z.strictObject({ nonce, expiresAt: timestamp });

export const quoteRequest = z.strictObject({ repoUrl: z.string().min(1).max(300), network, ref: z.string().min(1).max(200).optional() });
export const quoteResponse = z.strictObject({
  normalizedRepo: repo, commitSha, priceYocto: yocto, contractId: accountId, queueDepth: z.int().min(0), preset, etaMinutes: z.int().min(0),
});

export const createRequestBody = z.strictObject({
  accountId, publicKey, signature: z.string().min(1).max(512), message: z.string().min(1).max(4096), nonce,
});
export const createRequestResponse = z.strictObject({ requestId: uuid, requestHash: sha256Hex, priceYocto: yocto, contractId: accountId });

export const requestParams = z.strictObject({ id: uuid });
export const paymentRequest = z.strictObject({ txHash });
export const paymentResponse = z.strictObject({ status, position: z.int().min(1).nullable() });

export const progress = z.strictObject({
  phase: z.string().min(1), reviewer: z.string().optional(), pass: z.int().min(1).optional(), percent: z.number().min(0).max(100).optional(),
});

export const requestStatusResponse = z.strictObject({
  status, progress: progress.optional(), position: z.int().min(1).optional(), reportUrl: https.optional(), reportSha256: sha256Hex.optional(),
  incomplete: z.boolean().optional(), attestTx: z.string().min(1).optional(), refundTx: z.string().min(1).optional(),
  timeline: z.array(z.strictObject({ event: z.string().min(1), at: timestamp })).optional(), createdAt: timestamp,
});

export const progressEvent = z.strictObject({ status, progress: progress.optional(), at: timestamp });

export const listQuery = z.strictObject({ mine: z.literal('1') });
export const requestListResponse = z.strictObject({
  requests: z.array(z.strictObject({ requestId: uuid, repo, status, createdAt: timestamp })),
});

export const loginBody = z.strictObject({ login: z.string().min(1).max(256), password: z.string().min(1).max(256) });
export const sessionResponse = z.strictObject({ account: accountId });

export const dashboardJobBody = z.strictObject({ repo: z.string().min(1).max(300) });
export const dashboardJobResponse = z.strictObject({ requestId: uuid, repo, commitSha, status: z.literal('queued') });

const operatorKind = z.enum(['path', 'github']);
const operatorStatus = z.enum(['queued', 'running', 'done', 'failed']);
export const localJobBody = z.union([
  z.strictObject({ path: z.string().min(1).max(4096) }),
  z.strictObject({ github: z.string().min(1).max(300) }),
]);
export const localJobCreated = z.strictObject({ id: uuid, kind: operatorKind, source: z.string().min(1), status: z.literal('queued') });
export const localJobListResponse = z.strictObject({
  jobs: z.array(z.strictObject({ id: uuid, kind: operatorKind, source: z.string().min(1), status: operatorStatus, createdAt: timestamp })),
});
export const localJobResponse = z.strictObject({
  id: uuid, kind: operatorKind, source: z.string().min(1), ref: z.string().min(1).nullable(), commitSha: commitSha.nullable(),
  status: operatorStatus, error: z.string().min(1).nullable(), createdAt: timestamp, pdfReady: z.boolean(),
});

export const guardQuery = z.strictObject({ account: accountId, network: network.optional() });
export const guardVerdictResponse = z.strictObject({
  verdict: z.enum(['allow', 'warn', 'block']), reasons: z.array(z.string().min(1)), signals: z.record(z.string(), z.unknown()),
  attestation: z.strictObject({
    requestHash: sha256Hex, reportSha256: sha256Hex, reportUri: https, deployed: accountId.nullable().optional(), codeHash: z.string().min(1).max(128).nullable().optional(),
    maxSeverity: z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']),
  }).optional(),
});

// The registry's report_address rules (INTERFACE.md v0.3.0): evidence_uri https + visible ASCII, at most
// 2000 bytes; reason 1-280 characters, not only whitespace, no control characters.
export const guardReportRequest = z.strictObject({
  account: accountId,
  evidenceUrl: z.string().max(2000).regex(/^https:\/\/[!-~]+$/),
  reason: z.string().min(1).max(280).regex(/^[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f][^\u0000-\u001f\u007f]*$/u),
});
export const guardReportResponse = z.strictObject({ queued: z.literal(true), reportId: uuid.optional() });

const guardReportStatus = z.enum(GUARD_REPORT_STATUSES);
export const adminGuardReportQuery = z.strictObject({ status: guardReportStatus.optional() });
export const adminGuardReportListResponse = z.strictObject({
  reports: z.array(z.strictObject({
    reportId: uuid, account: accountId, reporter: accountId, evidenceUrl: https, reason: z.string().min(1),
    status: guardReportStatus, reportTx: z.string().min(1).nullable(), createdAt: timestamp,
  })),
});
export const adminGuardDecisionResponse = z.strictObject({ status: guardReportStatus, reportTx: z.string().min(1).nullable() });

const severity = z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']);

/** packages/schemas/attestation.schema.json */
export const attestation = z.strictObject({
  requestHash: sha256Hex, reportSha256: sha256Hex, reportUri: https.max(2000), deployed: accountId.nullable().optional(),
  codeHash: z.string().min(1).max(128).nullable().optional(), maxSeverity: severity, repo: repo.optional(), commit: commitSha.optional(),
  bindingConfirmed: z.boolean().optional(), blockHeight: z.int().min(0).optional(), blockTimestampMs: z.int().min(0).optional(),
});

export const reportIndexResponse = z.strictObject({
  requestId: uuid, reportUrl: https, reportSha256: sha256Hex, reviewers: z.array(z.string()).optional(), generalReviewUrl: https.optional(),
  attestation: attestation.optional(),
});

export const ledgerResponse = z.strictObject({
  entries: z.array(z.strictObject({
    requestId: uuid, repo, status, priceYocto: yocto, paidYocto: yocto, modelCostUsd: z.number().min(0), reviewers: z.int().min(0),
    refundTx: z.string().min(1).optional(),
  })).max(500),
  totals: z.strictObject({ requests: z.int().min(0), salesYocto: yocto, refundedYocto: yocto, modelCostUsd: z.number().min(0) }),
});

export const healthResponse = z.strictObject({
  ok: z.boolean(), network, queueDepth: z.int().min(0), workers: z.int().min(0),
  chain: z.strictObject({ rpc: z.boolean(), contract: z.boolean() }),
});
export const readyResponse = z.strictObject({ ok: z.boolean(), db: z.boolean(), queue: z.boolean(), migrations: z.boolean() });

export const adminRefundResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('refunded'), refundTx: z.string().min(1).nullable() }),
  z.strictObject({ status: z.literal('refund_queued') }),
]);
