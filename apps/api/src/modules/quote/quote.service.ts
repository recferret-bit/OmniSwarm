// Quote rules (INTAKE section 3 step 3, section 5): network and price, queue depth before any payment,
// allow/deny lists, and the GitHub checks that resolve a ref to the commit the engine will review.
import type { Config } from '../../config/load.ts';
import type { Db } from '../../db/pool.ts';
import { queueDepth } from '../../db/repositories/requests.ts';
import type { GitHubPort } from '../../github/port.ts';
import { readReviewSettings, settingsPath } from '../providers/settings.ts';
import { fail } from '../../shared/errors.ts';
import { normalizeRepoUrl } from './repo-url.ts';

export interface QuoteDeps { config: Config; db: Db; github: GitHubPort }

/** GitHub's size field above this is refused. Between the configured cap and this, the review is split by theme. */
export const HARD_REPO_KB = 5_000_000;

export interface Quote {
  normalizedRepo: string; commitSha: string; priceYocto: string; contractId: string;
  queueDepth: number; preset: string; etaMinutes: number; sizeKb: number; large: boolean; freeChecks: boolean;
}

/** The price for the deployment's network, or NETWORK_DISABLED (OD-08: mainnet is off unless priced).
 *  Sandbox is not special here: it matches only when the deployment network is sandbox and a price is set. */
export function priceFor(config: Config, network: string): string {
  if (network !== config.intake.network || config.intake.priceYocto === null) {
    fail('NETWORK_DISABLED', `This service takes ${config.intake.network} requests only`);
  }
  return config.intake.priceYocto;
}

function listed(list: string[], repo: string): boolean {
  const lower = repo.toLowerCase();
  const owner = lower.split('/')[0];
  return list.some((entry) => entry.toLowerCase() === lower || entry.toLowerCase() === `${owner}/*`);
}

/** GitHub and list checks for one repo at one ref. Returns the canonical name and the commit SHA. */
export async function checkRepo(deps: QuoteDeps, repo: string, ref: string | null): Promise<{ repo: string; commitSha: string; sizeKb: number }> {
  const { allowlist, denylist } = deps.config.intake;
  if (listed(denylist, repo) || (allowlist.length > 0 && !listed(allowlist, repo))) fail('REPO_DENIED', 'This repository is not accepted');
  const info = await deps.github.getRepo(repo);
  if (!info) fail('REPO_NOT_FOUND', 'Repository was not found');
  if (info.private) fail('REPO_PRIVATE', 'Private repositories are not reviewed');
  if (info.archived || info.disabled) fail('REPO_ARCHIVED', 'Archived repositories are not reviewed');
  if (info.sizeKb > HARD_REPO_KB) fail('REPO_TOO_LARGE', 'Repository is over the size cap');
  const commitSha = await deps.github.resolveRef(repo, ref ?? info.defaultBranch);
  if (!commitSha) fail('REF_NOT_FOUND', 'The ref does not resolve to a commit');
  const canonical = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(info.fullName) ? info.fullName : repo;
  return { repo: canonical, commitSha, sizeKb: info.sizeKb };
}

export async function quote(deps: QuoteDeps, input: { repoUrl: string; network: string; ref?: string | undefined }): Promise<Quote> {
  const priceYocto = priceFor(deps.config, input.network);
  const depth = await queueDepth(deps.db);
  if (depth >= deps.config.intake.maxQueue) fail('QUEUE_FULL', 'The review queue is full; try again later');
  const parsed = normalizeRepoUrl(input.repoUrl);
  const checked = await checkRepo(deps, parsed.repo, input.ref ?? parsed.ref);
  return {
    normalizedRepo: checked.repo, commitSha: checked.commitSha, priceYocto, contractId: deps.config.intake.contractId,
    queueDepth: depth, preset: deps.config.intake.hostedPreset, etaMinutes: (depth + 1) * deps.config.intake.etaMinutesPerJob,
    sizeKb: checked.sizeKb, large: checked.sizeKb > deps.config.intake.maxRepoKb,
    freeChecks: readReviewSettings(settingsPath(deps.config.providerSecretsFile)).freeChecks,
  };
}
