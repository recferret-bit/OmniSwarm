// GitHubPort: the live adapter's mapping with an injected fetch (ETag, timeouts, errors), the recorded
// adapter over test/fixtures/github, and, only with OMNI_LIVE=1, the real API on two public repos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveGitHubAdapter } from '../../src/github/live/live-github.ts';
import { RecordedGitHubAdapter } from '../../src/github/recorded/recorded-github.ts';
import { AppError } from '../../src/shared/errors.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

const REPO = { full_name: 'near/near-sdk-rs', private: false, archived: false, disabled: false, size: 12000, default_branch: 'master' };

test('live adapter: maps the repo, sends the token, revalidates with ETag', async () => {
  const seen: Array<Record<string, string>> = [];
  let served = 0;
  const fetchStub: typeof fetch = async (_url, init) => {
    seen.push(init?.headers as Record<string, string>);
    served++;
    if (served > 1) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(REPO), { status: 200, headers: { etag: '"v1"' } });
  };
  const github = new LiveGitHubAdapter({ apiUrl: 'https://api.github.test', token: 'tkn', timeoutMs: 1000, fetch: fetchStub });
  const first = await github.getRepo('near/near-sdk-rs');
  const second = await github.getRepo('near/near-sdk-rs');
  assert.deepEqual(first, { fullName: 'near/near-sdk-rs', private: false, archived: false, disabled: false, sizeKb: 12000, defaultBranch: 'master' });
  assert.deepEqual(second, first, 'a 304 answers from the cache');
  assert.equal(seen[0]?.authorization, 'Bearer tkn');
  assert.equal(seen[1]?.['if-none-match'], '"v1"');
});

test('live adapter: 404 is null, 5xx/403 and timeouts are GITHUB_UNAVAILABLE', async () => {
  const answer = (status: number): typeof fetch => async () => new Response('{}', { status });
  assert.equal(await new LiveGitHubAdapter({ apiUrl: 'https://x', token: null, timeoutMs: 100, fetch: answer(404) }).getRepo('a/b'), null);
  for (const status of [403, 500]) {
    await assert.rejects(new LiveGitHubAdapter({ apiUrl: 'https://x', token: null, timeoutMs: 100, fetch: answer(status) }).getRepo('a/b'),
      (error: unknown) => error instanceof AppError && error.code === 'GITHUB_UNAVAILABLE');
  }
  const slow: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(new LiveGitHubAdapter({ apiUrl: 'https://x', token: null, timeoutMs: 50, fetch: slow }).resolveRef('a/b', 'main'),
    (error: unknown) => error instanceof AppError && error.code === 'GITHUB_UNAVAILABLE');
});

test('recorded adapter maps public, private, archived, too-large and unknown refs', async () => {
  const github = new RecordedGitHubAdapter(`${APP_ROOT}/test/fixtures/github`);
  assert.equal((await github.getRepo('near/near-sdk-rs'))?.private, false);
  assert.equal((await github.getRepo('private/hidden'))?.private, true);
  assert.equal((await github.getRepo('archived/old'))?.archived, true);
  assert.ok(((await github.getRepo('huge/repo'))?.sizeKb ?? 0) > 204800);
  assert.equal(await github.getRepo('torvalds/linux'), null);
  assert.match(await github.resolveRef('near/near-sdk-rs', 'master') ?? '', /^[0-9a-f]{40}$/);
  assert.equal(await github.resolveRef('near/near-sdk-rs', 'no-such-branch'), null);
  assert.equal(await github.resolveRef('near/../../etc', 'passwd'), null, 'no path escape from the fixture dir');
});

test('live GitHub on two real public repos (OMNI_LIVE=1 only)', { skip: process.env.OMNI_LIVE === '1' ? false : 'set OMNI_LIVE=1 to call the real GitHub API' }, async () => {
  const github = new LiveGitHubAdapter({ apiUrl: 'https://api.github.com', token: process.env.GITHUB_TOKEN ?? null, timeoutMs: 10_000 });
  for (const repo of ['near/near-sdk-rs', 'near/near-api-js']) {
    const info = await github.getRepo(repo);
    assert.equal(info?.private, false);
    assert.match(await github.resolveRef(repo, info?.defaultBranch ?? 'master') ?? '', /^[0-9a-f]{40}$/);
  }
});
