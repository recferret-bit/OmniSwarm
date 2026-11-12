// Dashboard reviews. Each runs as preset `account-<provider>` on the signed-in account's own provider key
// and saved models; the operator holds no provider key for them. They become ordinary request rows and reach the worker
// only through markPaid. The account is never charged: the mock ledger is paid 0 yocto, and on the local
// sandbox network the seeded bob dev key (not the account) signs request_review for the configured price so
// the registry contract's flow runs end to end. Other NEAR networks stay refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChainPort } from '../../chain/port.ts';
import type { Config } from '../../config/load.ts';
import type { Pool } from '../../db/pool.ts';
import { findRequest, insertRequest, queueDepth } from '../../db/repositories/requests.ts';
import type { GitHubPort } from '../../github/port.ts';
import type { PgBoss } from '../../queue/boss.ts';
import type { Clock } from '../../shared/clock.ts';
import { fail } from '../../shared/errors.ts';
import { assertAccountCapacity } from '../requests/create-request.service.ts';
import { markPaid } from '../payments/payment.service.ts';
import { checkRepo, priceFor } from '../quote/quote.service.ts';
import { parseGitHubInput } from '../quote/repo-url.ts';
import { accountPresetProvider, accountProviders } from '@omniswarm/schemas/providers';
import { normalizeScopes, type ReviewScope } from '../../worker/themes.ts';
import { accountPreset } from '../providers/account-keys.ts';
import { requestReviewOnSandbox } from './sandbox-payer.ts';

export interface DashboardDeps { config: Config; pool: Pool; clock: Clock; chain: ChainPort; github: GitHubPort; boss: PgBoss }

export function assertDashboardChain(config: { chain: { adapter: string }; intake?: { network?: string } }): void {
  if (config.chain.adapter === 'mock') return;
  if (config.chain.adapter === 'near' && config.intake?.network === 'sandbox') return;
  fail('FORBIDDEN', 'Dashboard jobs use the mock chain until NEAR sign-in is connected');
}

function reportFile(config: Config, id: string): string {
  const root = path.resolve(config.storage.reportsRoot);
  const file = path.resolve(root, id, 'report.pdf');
  if (path.dirname(file) !== path.resolve(root, id)) fail('NOT_FOUND', 'Report not found');
  return file;
}

export interface DashboardJobInput {
  repo: string;
  scopes?: readonly string[];
  /** An account-key provider id; defaults to the first one in the catalog (today `nearai`). */
  source?: string;
  pipelineMode?: 'full' | 'step-by-step' | 'stage-1';
}

export async function createDashboardJob(deps: DashboardDeps, account: string, input: DashboardJobInput) {
  assertDashboardChain(deps.config);
  const source = input.source ?? accountProviders()[0]?.id;
  if (!source) fail('PRESET_NOT_ALLOWED', 'No provider takes account keys');
  const pipelineMode = input.pipelineMode ?? 'full';
  const repoInput = input.repo;
  // The account's own provider key and models: refused until the account saved both.
  const { preset, models: accountModels } = await accountPreset(deps, account, source);
  const scope: ReviewScope = normalizeScopes(input.scopes ?? []);
  const parsed = parseGitHubInput(repoInput);
  const depth = await queueDepth(deps.pool);
  if (depth >= deps.config.intake.maxQueue) fail('QUEUE_FULL', 'The review queue is full; try again later');
  const checked = await checkRepo({ config: deps.config, db: deps.pool, github: deps.github }, parsed.repo, parsed.ref);
  const now = deps.clock.now();
  await assertAccountCapacity(deps.pool, deps.config, account, now);
  const id = crypto.randomUUID();
  const requestHash = crypto.createHash('sha256').update(`dashboard:${account}:${checked.repo}:${checked.commitSha}:${id}`).digest('hex');
  const onSandbox = deps.config.chain.adapter === 'near' && deps.config.intake.network === 'sandbox';
  const priceYocto = onSandbox ? priceFor(deps.config, 'sandbox') : '0';
  await insertRequest(deps.pool, {
    id, account, repo: checked.repo, commitSha: checked.commitSha, network: deps.config.intake.network,
    preset, deployed: null, requestHash, priceYocto, now, scope, models: accountModels, pipelineMode,
  });
  let txHash: string;
  if (onSandbox) {
    const paid = await requestReviewOnSandbox({
      network: deps.config.intake.network,
      rpcUrls: deps.config.chain.rpcUrls,
      contractId: deps.config.intake.contractId,
      requestHash,
      depositYocto: priceYocto,
    });
    txHash = paid.txHash;
  } else {
    const { payRequestReview } = await import('../../chain/mock/mock-ledger.ts');
    txHash = await payRequestReview(deps.pool, {
      signer: account, receiver: deps.config.intake.contractId, requestHash, depositYocto: '0',
    });
  }
  const row = await findRequest(deps.pool, id);
  if (!row) fail('INTERNAL', 'Request was not stored');
  await markPaid(deps, row, { txHash, amountYocto: BigInt(priceYocto), actor: 'api', event: 'payment_verified' });
  return { requestId: id, repo: checked.repo, commitSha: checked.commitSha, status: 'queued' as const };
}

/**
 * Queues an iterative debate round continuation on a finished request owned by `account`.
 * Creates a linked child request (`parent_id = parent.id`, `debate_rounds = rounds`) so the
 * worker seeds from the parent's Stage 1 / prior round report, runs only the requested debate
 * round(s), and publishes + attests a fresh immutable report.
 */
async function queueContinuationRequest(
  deps: DashboardDeps,
  account: string,
  parentId: string,
  rounds: number,
) {
  assertDashboardChain(deps.config);
  const parent = await findRequest(deps.pool, parentId);
  if (!parent || parent.account !== account) fail('REQUEST_NOT_FOUND', 'Request not found');
  if (parent.status !== 'done') {
    fail('INVALID_TRANSITION', `Request is ${parent.status}; pipeline steps can only continue a finished review`);
  }
  // A follow-up step runs on its parent's preset: the account's own key, or a preset the operator still allows.
  // An older review on a preset that no longer exists (the removed operator-key panel) cannot be continued.
  if (!accountPresetProvider(parent.preset) && !deps.config.intake.allowedPresets.includes(parent.preset)) {
    fail('PRESET_NOT_ALLOWED', 'This review ran on a preset that is no longer offered and cannot be continued');
  }
  const depth = await queueDepth(deps.pool);
  if (depth >= deps.config.intake.maxQueue) fail('QUEUE_FULL', 'The review queue is full; try again later');
  const now = deps.clock.now();
  await assertAccountCapacity(deps.pool, deps.config, account, now);
  const id = crypto.randomUUID();
  const requestHash = crypto.createHash('sha256').update(`debate:${account}:${parent.id}:${rounds}:${id}`).digest('hex');
  const onSandbox = deps.config.chain.adapter === 'near' && deps.config.intake.network === 'sandbox';
  const priceYocto = onSandbox ? priceFor(deps.config, 'sandbox') : '0';
  await insertRequest(deps.pool, {
    id,
    account,
    repo: parent.repo,
    commitSha: parent.commit_sha,
    network: parent.network,
    preset: parent.preset,
    deployed: parent.deployed,
    requestHash,
    priceYocto,
    now,
    scope: parent.scope,
    models: parent.models,
    pipelineMode: 'step-by-step',
    parentId: parent.id,
    debateRounds: rounds,
  });
  let txHash: string;
  if (onSandbox) {
    const paid = await requestReviewOnSandbox({
      network: deps.config.intake.network,
      rpcUrls: deps.config.chain.rpcUrls,
      contractId: deps.config.intake.contractId,
      requestHash,
      depositYocto: priceYocto,
    });
    txHash = paid.txHash;
  } else {
    const { payRequestReview } = await import('../../chain/mock/mock-ledger.ts');
    txHash = await payRequestReview(deps.pool, {
      signer: account, receiver: deps.config.intake.contractId, requestHash, depositYocto: '0',
    });
  }
  const row = await findRequest(deps.pool, id);
  if (!row) fail('INTERNAL', 'Request was not stored');
  await markPaid(deps, row, { txHash, amountYocto: BigInt(priceYocto), actor: 'api', event: 'payment_verified' });
  return { requestId: id, repo: parent.repo, commitSha: parent.commit_sha, status: 'queued' as const };
}

export async function adviseDashboardRequest(
  deps: DashboardDeps,
  account: string,
  parentId: string,
) {
  return queueContinuationRequest(deps, account, parentId, 0);
}

export async function continueDashboardDebate(
  deps: DashboardDeps,
  account: string,
  parentId: string,
  rounds = 1,
) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
    fail('VALIDATION_ERROR', 'Debate rounds per step must be between 1 and 5');
  }
  return queueContinuationRequest(deps, account, parentId, rounds);
}

/** The caller's own finished report, or REQUEST_NOT_FOUND / NOT_FOUND. The id is the only path segment. */
export async function readDashboardReportPdf(deps: DashboardDeps, account: string, id: string): Promise<Buffer> {
  const row = await findRequest(deps.pool, id);
  if (!row || row.account !== account) fail('REQUEST_NOT_FOUND', 'Request not found');
  if (row.status !== 'done') fail('NOT_FOUND', 'Report not found');
  const file = reportFile(deps.config, id);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail('NOT_FOUND', 'Report not found');
  }
  if (!stat.isFile() || stat.size === 0) fail('NOT_FOUND', 'Report not found');
  return fs.readFileSync(file);
}
