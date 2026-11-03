// RecordedGitHubAdapter: the live adapter's mapping code fed by recorded REST bodies on disk
// (GITHUB_FIXTURES_DIR, default test/fixtures/github). `<dir>/repos/<owner>/<repo>.json` answers
// GET /repos/<owner>/<repo>; `<dir>/repos/<owner>/<repo>/commits/<ref>.json` answers the commit
// lookup; a missing file is a 404. Tests and local demos only: refused when NODE_ENV=production.
import fs from 'node:fs';
import path from 'node:path';
import { LiveGitHubAdapter } from '../live/live-github.ts';
import type { GitHubPort, RepoInfo } from '../port.ts';

const API = 'https://api.github.invalid';

export function recordedFetch(dir: string): typeof fetch {
  const root = path.resolve(dir);
  return async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}.json`);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(fs.readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

export class RecordedGitHubAdapter implements GitHubPort {
  readonly kind = 'recorded';
  readonly #inner: LiveGitHubAdapter;

  constructor(dir: string) {
    this.#inner = new LiveGitHubAdapter({ apiUrl: API, token: null, timeoutMs: 1000, fetch: recordedFetch(dir) });
  }

  getRepo(repo: string): Promise<RepoInfo | null> {
    return this.#inner.getRepo(repo);
  }

  resolveRef(repo: string, ref: string): Promise<string | null> {
    return this.#inner.resolveRef(repo, ref);
  }
}
