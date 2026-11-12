import { describe, expect, it } from 'vitest';
import { buildReviewPost, postLength, X_POST_LIMIT, xIntentUrl } from './x-post';

describe('buildReviewPost', () => {
  it('names the repo, the highest severity and the cross-check counts', () => {
    const text = buildReviewPost({ repo: 'octo/app', maxSeverity: 'high', passed: 3, total: 5 });
    expect(text).toContain('octo/app');
    expect(text).toContain('highest severity: high');
    expect(text).toContain('3 of 5 findings held up under cross-check');
    expect(postLength(text, true)).toBeLessThanOrEqual(X_POST_LIMIT);
  });

  it('says so when the run was incomplete', () => {
    expect(buildReviewPost({ repo: 'octo/app', maxSeverity: 'none', incomplete: true })).toContain('not a clean audit');
  });

  it('works without any data', () => {
    expect(buildReviewPost({})).toMatch(/^OmniSwarm reviewed my repo with a panel/);
  });
});

describe('xIntentUrl', () => {
  it('builds the compose link with the text and the report link encoded', () => {
    const href = xIntentUrl('Hello & goodbye', 'https://omniswarm.example/r/abc');
    const url = new URL(href as string);
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe('Hello & goodbye');
    expect(url.searchParams.get('url')).toBe('https://omniswarm.example/r/abc');
  });

  it('refuses a link that is not https', () => {
    expect(xIntentUrl('x', 'http://omniswarm.localhost/r/abc')).toBeNull();
    expect(xIntentUrl('x', 'javascript:alert(1)')).toBeNull();
    expect(xIntentUrl('x', 'not a url')).toBeNull();
  });

  it('allows a post without a link', () => {
    expect(xIntentUrl('only text')).toBe('https://x.com/intent/post?text=only+text');
  });
});

describe('postLength', () => {
  it('counts a link as 23 characters plus a space', () => {
    expect(postLength('abc', true)).toBe(3 + 24);
    expect(postLength('abc', false)).toBe(3);
  });
});
