// https://github.com/<owner>/<repo>[.git][/] with an optional /tree/<ref> or @<ref>. Nothing else:
// no ssh, no other hosts, no query strings, no path tricks.
import { fail } from '../../shared/errors.ts';

const URL_SHAPE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:\/tree\/([A-Za-z0-9._/-]{1,200}?)|@([A-Za-z0-9._/-]{1,200}?))?\/?$/;

export interface RepoRef { repo: string; ref: string | null }

export function normalizeRepoUrl(repoUrl: string): RepoRef {
  const match = URL_SHAPE.exec(repoUrl.trim());
  if (!match) fail('REPO_INVALID', 'Repo URL must be https://github.com/<owner>/<repo>');
  const [, owner, name, treeRef, atRef] = match;
  const ref = treeRef ?? atRef ?? null;
  if (owner?.startsWith('-') || name === '.' || name === '..' || ref?.split('/').some((part) => part === '..' || part === '')) {
    fail('REPO_INVALID', 'Repo URL must be https://github.com/<owner>/<repo>');
  }
  return { repo: `${owner}/${name}`, ref };
}
