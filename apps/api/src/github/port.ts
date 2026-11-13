// GitHub as the review checks need it: repository facts and a ref resolved to a commit SHA.
// Adapters: `live` (REST API) and `recorded` (fixture files, tests only).

export interface RepoInfo {
  fullName: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  sizeKb: number;
  defaultBranch: string;
}

export interface GitHubPort {
  readonly kind: 'live' | 'recorded';
  /** null when the repository does not exist or is not visible without a token. */
  getRepo(repo: string): Promise<RepoInfo | null>;
  /** The 40-hex commit SHA a branch, tag or SHA names; null when it does not resolve. */
  resolveRef(repo: string, ref: string): Promise<string | null>;
}
