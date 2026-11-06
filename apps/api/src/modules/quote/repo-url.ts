// https://github.com/<owner>/<repo>[.git][/] with an optional /tree/<ref> or @<ref>. Nothing else:
// no ssh, no other hosts, no query strings, no path tricks.
import { fail } from '../../shared/errors.ts';
import { repo as repoSchema } from '../../shared/patterns.ts';

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

const OWNER_AT = /^([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})(?:@([A-Za-z0-9._/-]{1,200}))?$/;
const OWNER_TREE = /^([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/tree\/([A-Za-z0-9._/-]{1,200})$/;

function badRef(ref: string): boolean {
  return ref.split('/').some((part) => part === '..' || part === '' || part.startsWith('-'));
}

/** `owner/name`, `owner/name@ref`, `owner/name/tree/ref`, or a github.com URL (`normalizeRepoUrl`). */
export function parseGitHubInput(input: string): RepoRef {
  const trimmed = input.trim();
  if (trimmed.includes('://')) return normalizeRepoUrl(trimmed);
  const tree = OWNER_TREE.exec(trimmed);
  if (tree?.[1] && tree[2] && repoSchema.safeParse(tree[1]).success) {
    if (badRef(tree[2])) fail('REPO_INVALID', 'Repo must be owner/name or a https://github.com URL');
    return { repo: tree[1], ref: tree[2] };
  }
  const at = OWNER_AT.exec(trimmed);
  const repo = at?.[1];
  if (!repo || !repoSchema.safeParse(repo).success || (at?.[2] !== undefined && badRef(at[2]))) {
    fail('REPO_INVALID', 'Repo must be owner/name or a https://github.com URL');
  }
  return { repo, ref: at?.[2] ?? null };
}
