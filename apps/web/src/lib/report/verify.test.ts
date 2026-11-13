import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareHash, loadReport, reportFiles, verifyReport } from './verify';

const SAMPLE = path.resolve(__dirname, '../../../public/sample');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(SAMPLE, name), 'utf8')) as unknown;
const files = { findingsUrl: 'https://reports.test/1/findings-and-scores.json', generalUrl: 'https://reports.test/1/general-review.json' };
const fetcher = async (url: string) => new Response(JSON.stringify(read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json')));
const recorded = (read('report-hash.json') as { reportSha256: string }).reportSha256;
const tampered = async (url: string) => {
  const doc = read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json') as Record<string, unknown>;
  return new Response(JSON.stringify(url.endsWith('general-review.json') ? { ...doc, riskPosture: 'low-risk' } : doc));
};

describe('report verification', () => {
  it('derives the canonical files from the report index', () => {
    expect(reportFiles({ reportUrl: 'https://reports.example/abc/report.html' })).toEqual({
      findingsUrl: 'https://reports.example/abc/findings-and-scores.json', generalUrl: 'https://reports.example/abc/general-review.json',
    });
  });

  it('matches when the recomputed digest equals the served reportSha256', async () => {
    const result = await verifyReport(files, recorded, { fetcher });
    expect(result.state).toBe('match');
    expect(result.computed).toBe(recorded);
  });

  it('turns red when a served file changed after the hash was published', async () => {
    const result = await verifyReport(files, recorded, { fetcher: tampered });
    expect(result.state).toBe('mismatch');
    expect(result.computed).not.toBe(recorded);
  });

  it('reports that there is nothing to compare when no hash was served', async () => {
    const result = compareHash(await loadReport(files, fetcher), undefined);
    expect(result.state).toBe('unhashed');
    expect(compareHash(await loadReport(files, fetcher), '').state).toBe('unhashed');
  });

  it('fails when a report file cannot be fetched', async () => {
    await expect(verifyReport(files, recorded, { fetcher: async () => new Response('nope', { status: 404 }) })).rejects.toThrow(/404/);
  });
});
