// Password-dashboard reviews. They become ordinary request rows and reach the worker only through
// markPaid, and only while the chain adapter is mock. The NEAR payment path is unchanged.
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
import { checkRepo } from '../quote/quote.service.ts';
import { parseGitHubInput } from '../quote/repo-url.ts';
import { panelPresetName } from '../../worker/panel.ts';
import { normalizeScopes, type ReviewScope } from '../../worker/themes.ts';
import { providerStatus } from '../providers/secrets.ts';

export interface DashboardDeps { config: Config; pool: Pool; clock: Clock; chain: ChainPort; github: GitHubPort; boss: PgBoss }

export function assertDashboardChain(config: { chain: { adapter: string } }): void {
  if (config.chain.adapter !== 'mock') fail('FORBIDDEN', 'Dashboard jobs use the mock chain until NEAR sign-in is connected');
}

function reportFile(config: Config, id: string): string {
  const root = path.resolve(config.storage.reportsRoot);
  const file = path.resolve(root, id, 'report.pdf');
  if (path.dirname(file) !== path.resolve(root, id)) fail('NOT_FOUND', 'Report not found');
  return file;
}

export async function createDashboardJob(deps: DashboardDeps, account: string, repoInput: string, models: readonly string[] = [], scopes: readonly string[] = []) {
  assertDashboardChain(deps.config);
  const keys = providerStatus(deps.config.providerSecretsFile ?? '');
  if (!keys.zai.set || !keys.openrouter.set) fail('PRESET_NOT_ALLOWED', 'Set the Z.AI and OpenRouter keys on the admin page before queueing a review');
  const preset = panelPresetName(models);
  const scope: ReviewScope = normalizeScopes(scopes);
  const parsed = parseGitHubInput(repoInput);
  const depth = await queueDepth(deps.pool);
  if (depth >= deps.config.intake.maxQueue) fail('QUEUE_FULL', 'The review queue is full; try again later');
  const checked = await checkRepo({ config: deps.config, db: deps.pool, github: deps.github }, parsed.repo, parsed.ref);
  const now = deps.clock.now();
  await assertAccountCapacity(deps.pool, deps.config, account, now);
  const id = crypto.randomUUID();
  const requestHash = crypto.createHash('sha256').update(`dashboard:${account}:${checked.repo}:${checked.commitSha}:${id}`).digest('hex');
  await insertRequest(deps.pool, {
    id, account, repo: checked.repo, commitSha: checked.commitSha, network: deps.config.intake.network,
    preset, deployed: null, requestHash, priceYocto: '0', now, scope,
  });
  const { payRequestReview } = await import('../../chain/mock/mock-ledger.ts');
  const txHash = await payRequestReview(deps.pool, {
    signer: account, receiver: deps.config.intake.contractId, requestHash, depositYocto: '0',
  });
  const row = await findRequest(deps.pool, id);
  if (!row) fail('INTERNAL', 'Request was not stored');
  await markPaid(deps, row, { txHash, amountYocto: 0n, actor: 'api', event: 'payment_verified' });
  return { requestId: id, repo: checked.repo, commitSha: checked.commitSha, status: 'queued' as const };
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
