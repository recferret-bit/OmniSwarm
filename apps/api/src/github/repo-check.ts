// The GitHub and list checks for one repo at one ref: allow/deny lists, public and not archived, size cap,
// and the commit SHA the engine will review.
import type { Config } from '../config/load.ts';
import { fail } from '../shared/errors.ts';
import type { GitHubPort } from './port.ts';

export interface RepoCheckDeps { config: Config; github: GitHubPort }

/** GitHub's size field above this is refused. Above the split threshold the review is split by theme. */
export const HARD_REPO_KB = 5_000_000;

function listed(list: string[], repo: string): boolean {
  const lower = repo.toLowerCase();
  const owner = lower.split('/')[0];
  return list.some((entry) => entry.toLowerCase() === lower || entry.toLowerCase() === `${owner}/*`);
}

export async function checkRepo(deps: RepoCheckDeps, repo: string, ref: string | null): Promise<{ repo: string; commitSha: string; sizeKb: number }> {
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
