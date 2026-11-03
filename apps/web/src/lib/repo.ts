// Repository input accepted by the quote form (W11-11): https://github.com/o/r,
// github.com/o/r or o/r, with an optional @ref. The repo part must match the
// intake's regex; the server normalizes again and is the authority.
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export interface RepoInput {
  repo: string;
  ref?: string;
}

export function parseRepoInput(input: string): RepoInput | null {
  let text = input.trim();
  if (!text || /\s/.test(text)) return null;
  let ref: string | undefined;
  const at = text.lastIndexOf('@');
  if (at > 0) {
    ref = text.slice(at + 1);
    text = text.slice(0, at);
    if (!ref || ref.length > 200) return null;
  }
  text = text.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!REPO.test(text)) return null;
  return ref ? { repo: text, ref } : { repo: text };
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

const ACCOUNT_ID = /^[a-z0-9._-]{2,64}$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID.test(value);
}
