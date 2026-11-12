// zod DTOs for every route (W08-01). They are the runtime form of
// packages/schemas/intake-api.schema.json; test/unit/dto.test.ts runs that schema's examples through
// them, and the integration tests validate live responses against the JSON Schema itself.
import { accountProviders } from '@omniswarm/schemas/providers';
import { z } from 'zod';
import { GUARD_REPORT_STATUSES } from '../db/repositories/guard-reports.ts';
import { STATUSES } from '../modules/requests/state.ts';
import { ERROR_CODES } from '../shared/errors.ts';
import { accountId, commitSha, network, nonce, preset, publicKey, repo, sha256Hex, txHash, uuid, yocto } from '../shared/patterns.ts';

const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
const https = z.string().regex(/^https:\/\/[^\s]+$/);
// Stored report links on the local stack are http. The registry still requires https.
const reportLink = z.string().regex(/^https?:\/\/[^\s]+$/);
const status = z.enum(STATUSES);

export const errorResponse = z.strictObject({
  error: z.strictObject({ code: z.enum(ERROR_CODES as [string, ...string[]]), message: z.string().min(1).max(2000), retryable: z.boolean() }),
});

export const challengeRequest = z.strictObject({}).nullish();
export const challengeResponse = z.strictObject({ nonce, expiresAt: timestamp });

export const quoteRequest = z.strictObject({ repoUrl: z.string().min(1).max(300), network, ref: z.string().min(1).max(200).optional() });
export const quoteResponse = z.strictObject({
  normalizedRepo: repo, commitSha, priceYocto: yocto, contractId: accountId, queueDepth: z.int().min(0), preset, etaMinutes: z.int().min(0),
  sizeKb: z.int().min(0).optional(), large: z.boolean().optional(), freeChecks: z.boolean().optional(),
});

export const pipelineMode = z.enum(['full', 'step-by-step', 'stage-1']);

export const pipelineSummary = z.strictObject({
  pipelineMode,
  currentStage: z.enum(['stage-1', 'stage-2-advice', 'stage-3-debate', 'completed']),
  noDebates: z.boolean(),
  roundsCompleted: z.int().min(0),
  canRunMoreRounds: z.boolean(),
  advice: z.strictObject({
    debateNeeded: z.boolean(),
    recommendedDepth: z.enum(['none', 'shallow', 'standard', 'deep']),
    recommendedRounds: z.int().min(0).max(3),
    qualityRating: z.enum(['strong', 'adequate', 'degraded', 'incomplete']),
    summary: z.string().min(1),
  }).optional(),
  incompletionNotes: z.array(z.strictObject({
    category: z.string().min(1),
    code: z.string().min(1),
    source: z.string().min(1),
    reason: z.string().min(1),
    impact: z.string().min(1),
    nextStep: z.string().min(1).optional(),
  })).optional(),
  nextRoundRequestIds: z.array(uuid).optional(),
});

export const createRequestBody = z.strictObject({
  accountId, publicKey, signature: z.string().min(1).max(512), message: z.string().min(1).max(4096), nonce,
  pipelineMode: pipelineMode.optional(),
});
export const createRequestResponse = z.strictObject({ requestId: uuid, requestHash: sha256Hex, priceYocto: yocto, contractId: accountId });

export const requestParams = z.strictObject({ id: uuid });
export const paymentRequest = z.strictObject({ txHash });
export const paymentResponse = z.strictObject({ status, position: z.int().min(1).nullable() });

const count = z.int().min(0);
const phaseName = z.enum(['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report']);
/** intake-api.schema.json#/$defs/progress-detail */
export const progressDetail = z.strictObject({
  state: z.enum(['running', 'finished', 'incomplete', 'failed', 'cancelled']),
  startedAt: timestamp.optional(), updatedAt: timestamp.optional(), elapsedMs: count.optional(),
  phases: z.array(z.strictObject({
    name: phaseName, state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']), startedAt: timestamp.optional(), endedAt: timestamp.optional(),
  })).max(32),
  reviewers: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/), state: z.enum(['pending', 'running', 'done', 'failed']),
    jobsDone: count, jobs: z.int().min(1), passes: z.int().min(1), pass: z.int().min(1).optional(), calls: count.optional(),
    budget: z.int().min(1).optional(), surface: z.string().regex(/^S[1-6]$/).optional(), idleMs: count.optional(),
  })).max(32).optional(),
  sessions: z.array(z.strictObject({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,120}$/), idleMs: count })).max(32).optional(),
  crosscheck: z.strictObject({ done: count, total: count }).optional(),
  debate: z.strictObject({ clusters: count.optional(), heard: count.optional(), judged: count.optional(), toJudge: count.optional() }).optional(),
  themes: z.array(z.strictObject({
    theme: z.enum(['web3', 'apps', 'infra', 'scripts']), status, phase: z.string().min(1).optional(), percent: z.number().min(0).max(100).optional(),
  })).max(32).optional(),
});

export const progress = z.strictObject({
  phase: z.string().min(1), reviewer: z.string().optional(), pass: z.int().min(1).optional(), percent: z.number().min(0).max(100).optional(),
  detail: progressDetail.optional(),
});

export const requestStatusResponse = z.strictObject({
  status, progress: progress.optional(), position: z.int().min(1).optional(), reportUrl: reportLink.optional(), reportSha256: sha256Hex.optional(),
  incomplete: z.boolean().optional(), pipelineMode: pipelineMode.optional(), pipeline: pipelineSummary.optional(),
  attestTx: z.string().min(1).optional(), refundTx: z.string().min(1).optional(),
  failureCause: z.string().min(1).optional(),
  timeline: z.array(z.strictObject({ event: z.string().min(1), at: timestamp })).optional(), createdAt: timestamp,
});

export const progressEvent = z.strictObject({ status, progress: progress.optional(), at: timestamp });

export const listQuery = z.strictObject({ mine: z.literal('1') });
export const requestListResponse = z.strictObject({
  requests: z.array(z.strictObject({ requestId: uuid, repo, status, createdAt: timestamp, theme: z.string().min(1).optional(), progress: progress.optional() })),
});

export const loginBody = z.strictObject({ login: z.string().min(1).max(256), password: z.string().min(1).max(256) });
export const socialLoginBody = z.strictObject({
  provider: z.enum(['google', 'x']),
  token: z.string().min(1).max(4000),
});
export const nearLoginBody = z.strictObject({
  accountId,
  publicKey: z.string().min(1).max(128),
  signature: z.string().min(1).max(200),
  nonce: z.string().min(1).max(128),
});
export const sessionResponse = z.strictObject({
  account: accountId,
  label: z.string().min(1).max(128).optional(),
  provider: z.enum(['password', 'near', 'google', 'x']).optional(),
});

export const dashboardJobBody = z.strictObject({
  repo: z.string().min(1).max(300),
  scopes: z.array(z.enum(['full', 'web2', 'web3'])).max(3).optional(),
  pipelineMode: pipelineMode.optional(),
  concurrency: z.int().min(1).max(8).optional(),
  /**
   * The provider whose key the signed-in account saved (catalog entries that take account keys; today only
   * `nearai`, the default). The review runs as preset `account-<provider>` on that key and the saved models.
   */
  source: z.enum(accountProviders().map((provider) => provider.id) as [string, ...string[]]).optional(),
});
export const dashboardJobResponse = z.strictObject({ requestId: uuid, repo, commitSha, status: z.literal('queued') });
export const debateStepBody = z.strictObject({ rounds: z.int().min(1).max(5).optional() }).nullish();

const operatorKind = z.enum(['path', 'github']);
const operatorStatus = z.enum(['queued', 'running', 'done', 'failed']);
export const localJobBody = z.union([
  z.strictObject({ path: z.string().min(1).max(4096), pipelineMode: pipelineMode.optional(), concurrency: z.int().min(1).max(8).optional() }),
  z.strictObject({ github: z.string().min(1).max(300), pipelineMode: pipelineMode.optional(), concurrency: z.int().min(1).max(8).optional() }),
]);
export const localJobCreated = z.strictObject({ id: uuid, kind: operatorKind, source: z.string().min(1), status: z.literal('queued') });
export const localJobListResponse = z.strictObject({
  jobs: z.array(z.strictObject({ id: uuid, kind: operatorKind, source: z.string().min(1), status: operatorStatus, createdAt: timestamp })),
});
export const localJobResponse = z.strictObject({
  id: uuid, kind: operatorKind, source: z.string().min(1), ref: z.string().min(1).nullable(), commitSha: commitSha.nullable(),
  status: operatorStatus, error: z.string().min(1).nullable(), createdAt: timestamp, pdfReady: z.boolean(),
  progress: progress.optional(), pipelineMode: pipelineMode.optional(), pipeline: pipelineSummary.optional(),
});

export const guardQuery = z.strictObject({ account: accountId, network: network.optional() });
export const guardVerdictResponse = z.strictObject({
  verdict: z.enum(['allow', 'warn', 'block']), reasons: z.array(z.string().min(1)),
  signals: z.object({
    sourceMetadata: z.strictObject({
      link: z.string().nullable(),
      rev: z.string().nullable(),
      fetchedAt: z.string().min(1),
    }).nullable().optional(),
  }).passthrough(),
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

const receiptReviewer = z.strictObject({
  id: z.string().min(1), vendor: z.string().min(1), model: z.string().min(1),
  calls: z.int().min(0), tokens: z.int().min(0), usd: z.number().min(0),
});
const receiptCheck = z.strictObject({
  passed: z.int().min(0), total: z.int().min(0), byStatus: z.record(z.string(), z.int().min(0)),
});
/** packages/schemas/intake-api.schema.json#/$defs/receipt */
export const receipt = z.strictObject({
  paid: z.strictObject({ yocto, tx: z.string().min(1) }),
  reviewers: z.array(receiptReviewer),
  check: receiptCheck,
  attestation: z.strictObject({ tx: z.string().min(1), hash: sha256Hex, match: z.boolean().optional() }).optional(),
  refund: z.strictObject({ tx: z.string().min(1), yocto: yocto.optional() }).optional(),
});

export const reportIndexResponse = z.strictObject({
  requestId: uuid, reportUrl: reportLink.optional(), reportSha256: sha256Hex.optional(), reviewers: z.array(z.string()).optional(),
  generalReviewUrl: reportLink.optional(), stage1Url: reportLink.optional(), adviceUrl: reportLink.optional(),
  pipelineUrl: reportLink.optional(), roundUrls: z.array(reportLink).optional(),
  attestation: attestation.optional(), receipt: receipt.optional(),
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
  chain: z.strictObject({ rpc: z.boolean(), contract: z.boolean(), blockHeight: z.int().min(0).optional() }),
});
export const readyResponse = z.strictObject({ ok: z.boolean(), db: z.boolean(), queue: z.boolean(), migrations: z.boolean() });

export const adminRefundResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('refunded'), refundTx: z.string().min(1).nullable() }),
  z.strictObject({ status: z.literal('refund_queued') }),
]);
