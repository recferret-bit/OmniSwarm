import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReportHash, readSampleHash } from './sample-hash';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sample hash fetch', () => {
  it('accepts only a 64-character hex digest', () => {
    expect(isReportHash('ab'.repeat(32))).toBe(true);
    expect(isReportHash('')).toBe(false);
    expect(isReportHash('ab'.repeat(31))).toBe(false);
    expect(isReportHash(`${'g'.repeat(64)}`)).toBe(false);
    expect(isReportHash('AB'.repeat(32))).toBe(false);
  });

  it('returns an empty string when the file is missing or the digest is not hex', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, json: async () => ({}) }));
    expect(await readSampleHash()).toBe('');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ report_sha256: 'not-a-hash' }) }));
    expect(await readSampleHash()).toBe('');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await readSampleHash()).toBe('');
  });
});
