import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAttestation, type OnChainAttestation } from '../near/rpc';
import { useMockApi } from '@/test/msw';
import { updateState } from '@/mocks/db';
import { compareAttestation, loadReport, reportFiles, verifyReport } from './verify';

const SAMPLE = path.resolve(__dirname, '../../../public/sample');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(SAMPLE, name), 'utf8')) as unknown;
const files = { findingsUrl: 'https://reports.test/1/findings-and-scores.json', generalUrl: 'https://reports.test/1/general-review.json' };
const fetcher = async (url: string) => new Response(JSON.stringify(read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json')));
const recorded = read('attestation.json') as OnChainAttestation;

describe('report verification', () => {
  it('derives the canonical files from the report index', () => {
    expect(reportFiles({ reportUrl: 'https://reports.example/abc/report.html' })).toEqual({
      findingsUrl: 'https://reports.example/abc/findings-and-scores.json', generalUrl: 'https://reports.example/abc/general-review.json',
    });
  });

  it('matches when the recomputed digest equals the attested report_sha256', async () => {
    const result = await verifyReport(files, recorded.request_hash, { fetcher, attestationOf: async () => recorded });
    expect(result.state).toBe('match');
    expect(result.computed).toBe(recorded.report_sha256);
  });

  it('turns red when a served file changes after attestation, and reports a missing attestation', async () => {
    const tampered = async (url: string) => {
      const doc = read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json') as Record<string, unknown>;
      return new Response(JSON.stringify(url.endsWith('general-review.json') ? { ...doc, riskPosture: 'low-risk' } : doc));
    };
    expect((await verifyReport(files, recorded.request_hash, { fetcher: tampered, attestationOf: async () => recorded })).state).toBe('mismatch');
    expect(compareAttestation(await loadReport(files, fetcher), null).state).toBe('unattested');
  });
});

describe('get_attestation RPC view', () => {
  useMockApi();

  it('reads the attestation through near-api-js JsonRpcProvider at finality final', async () => {
    updateState((state) => { state.attestations[recorded.request_hash] = recorded; });
    await expect(getAttestation(recorded.request_hash)).resolves.toEqual(recorded);
    await expect(getAttestation('cd'.repeat(32))).resolves.toBeNull();
  });
});
