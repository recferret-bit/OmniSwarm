// LiveGitHubAdapter: GitHub REST v3 with a per-call timeout and conditional requests (ETag). The
// ETag cache is a per-process optimisation only; a cold replica just pays a full request.
import { AppError } from '../../shared/errors.ts';
import type { GitHubPort, RepoInfo } from '../port.ts';

export interface LiveGitHubOptions {
  apiUrl: string;
  token: string | null;
  timeoutMs: number;
  fetch?: typeof fetch;
  cacheSize?: number;
}

type Cached = { etag: string; body: unknown };

export class LiveGitHubAdapter implements GitHubPort {
  readonly kind = 'live';
  readonly #options: LiveGitHubOptions;
  readonly #fetch: typeof fetch;
  readonly #cache = new Map<string, Cached>();

  constructor(options: LiveGitHubOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async getRepo(repo: string): Promise<RepoInfo | null> {
    const body = await this.#get(`/repos/${repo}`) as Record<string, unknown> | null;
    if (!body) return null;
    return {
      fullName: String(body.full_name), private: body.private === true, archived: body.archived === true,
      disabled: body.disabled === true, sizeKb: Number(body.size ?? 0), defaultBranch: String(body.default_branch ?? 'main'),
    };
  }

  async resolveRef(repo: string, ref: string): Promise<string | null> {
    const body = await this.#get(`/repos/${repo}/commits/${encodeURIComponent(ref)}`) as { sha?: unknown } | null;
    return typeof body?.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha) ? body.sha : null;
  }

  async #get(path: string): Promise<unknown> {
    const url = `${this.#options.apiUrl.replace(/\/+$/, '')}${path}`;
    const cached = this.#cache.get(url);
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'omniswarm-intake',
    };
    if (this.#options.token) headers.authorization = `Bearer ${this.#options.token}`;
    if (cached) headers['if-none-match'] = cached.etag;
    let response: Response;
    try {
      response = await this.#fetch(url, { headers, signal: AbortSignal.timeout(this.#options.timeoutMs) });
    } catch (error) {
      throw new AppError('GITHUB_UNAVAILABLE', 'GitHub could not be reached', { cause: error });
    }
    if (response.status === 304 && cached) return cached.body;
    if (response.status === 404 || response.status === 422) return null;
    if (!response.ok) throw new AppError('GITHUB_UNAVAILABLE', `GitHub answered ${response.status}`);
    const body: unknown = await response.json();
    const etag = response.headers.get('etag');
    if (etag) this.#remember(url, { etag, body });
    return body;
  }

  #remember(url: string, entry: Cached): void {
    this.#cache.delete(url);
    this.#cache.set(url, entry);
    const limit = this.#options.cacheSize ?? 500;
    while (this.#cache.size > limit) this.#cache.delete(this.#cache.keys().next().value as string);
  }
}
