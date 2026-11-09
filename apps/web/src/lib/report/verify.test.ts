import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Attestation } from '../api/schema.gen';
import { getAttestation, parseAttestation, type OnChainAttestation } from '../near/rpc';
import { useMockApi } from '@/test/msw';
import { updateState } from '@/mocks/db';
import { compareAttestation, loadReport, reportFiles, verifyReport, type Verification } from './verify';

const SAMPLE = path.resolve(__dirname, '../../../public/sample');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(SAMPLE, name), 'utf8')) as unknown;
const files = { findingsUrl: 'https://reports.test/1/findings-and-scores.json', generalUrl: 'https://reports.test/1/general-review.json' };
const fetcher = async (url: string) => new Response(JSON.stringify(read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json')));
const recorded = read('attestation.json') as OnChainAttestation;
const tampered = async (url: string) => {
  const doc = read(url.endsWith('general-review.json') ? 'general-review.json' : 'findings-and-scores.json') as Record<string, unknown>;
  return new Response(JSON.stringify(url.endsWith('general-review.json') ? { ...doc, riskPosture: 'low-risk' } : doc));
};
const fromApi: Attestation = {
  requestHash: recorded.request_hash,
  reportSha256: recorded.report_sha256,
  reportUri: recorded.report_uri,
  deployed: recorded.deployed,
  codeHash: recorded.code_hash,
  maxSeverity: recorded.max_severity,
  repo: recorded.repo,
  commit: recorded.commit,
  bindingConfirmed: recorded.binding_confirmed,
  blockHeight: recorded.block_height,
  blockTimestampMs: recorded.block_timestamp_ms,
};
const rpcDown = async (): Promise<OnChainAttestation | null> => { throw new Error('provider unreachable'); };

function sourced(result: Verification): Verification & { state: 'match' | 'mismatch' } {
  if (result.state === 'unattested') throw new Error('expected an attestation');
  return result;
}

describe('report verification', () => {
  it('derives the canonical files from the report index', () => {
    expect(reportFiles({ reportUrl: 'https://reports.example/abc/report.html' })).toEqual({
      findingsUrl: 'https://reports.example/abc/findings-and-scores.json', generalUrl: 'https://reports.example/abc/general-review.json',
    });
  });

  it('matches when the recomputed digest equals the attested report_sha256', async () => {
    const result = sourced(await verifyReport(files, recorded.request_hash, { fetcher, attestationOf: async () => recorded }));
    expect(result.state).toBe('match');
    expect(result.source).toBe('rpc');
    expect(result.label).toBeUndefined();
    expect(result.computed).toBe(recorded.report_sha256);
  });

  it('turns red when a served file changes after attestation, and reports a missing attestation', async () => {
    const mismatch = sourced(await verifyReport(files, recorded.request_hash, { fetcher: tampered, attestationOf: async () => recorded }));
    expect(mismatch.state).toBe('mismatch');
    expect(mismatch.source).toBe('rpc');
    expect(mismatch.label).toBeUndefined();
    const missing = compareAttestation(await loadReport(files, fetcher), null);
    expect(missing.state).toBe('unattested');
    expect(missing).not.toHaveProperty('source');
  });

  it('matches from the API attestation when the RPC provider is unreachable', async () => {
    const result = sourced(await verifyReport(files, recorded.request_hash, { fetcher, attestationOf: rpcDown, apiAttestation: fromApi }));
    expect(result.state).toBe('match');
    expect(result.source).toBe('api');
    expect(result.label).toBe('via API, not independent');
    expect(result.attestation.report_sha256).toBe(recorded.report_sha256);
  });

  it('is a mismatch for the API fallback when the served hash differs', async () => {
    const result = sourced(await verifyReport(files, recorded.request_hash, { fetcher: tampered, attestationOf: rpcDown, apiAttestation: fromApi }));
    expect(result.state).toBe('mismatch');
    expect(result.source).toBe('api');
    expect(result.label).toBe('via API, not independent');
  });

  it('does not replace a successful empty RPC read, and still throws when no API attestation was supplied', async () => {
    const empty = await verifyReport(files, recorded.request_hash, { fetcher, attestationOf: async () => null, apiAttestation: fromApi });
    expect(empty.state).toBe('unattested');
    await expect(verifyReport(files, recorded.request_hash, { fetcher, attestationOf: rpcDown })).rejects.toThrow(/provider unreachable/);
  });
});

describe('get_attestation RPC view', () => {
  useMockApi();

  it('reads the attestation through near-api-js JsonRpcProvider at finality final', async () => {
    updateState((state) => { state.attestations[recorded.request_hash] = recorded; });
    await expect(getAttestation(recorded.request_hash)).resolves.toEqual(recorded);
    await expect(getAttestation('cd'.repeat(32))).resolves.toBeNull();
  });

  it('matches with source rpc when the provider answers get_attestation', async () => {
    updateState((state) => { state.attestations[recorded.request_hash] = recorded; });
    const result = sourced(await verifyReport(files, recorded.request_hash, { fetcher, apiAttestation: fromApi }));
    expect(result.state).toBe('match');
    expect(result.source).toBe('rpc');
    expect(result.label).toBeUndefined();
    expect(result.computed).toBe(recorded.report_sha256);
  });

  it('rejects a pre-v0.2 attestation without binding_confirmed and block_timestamp_ms', () => {
    const { binding_confirmed: _b, block_timestamp_ms: _t, ...legacy } = recorded;
    expect(() => parseAttestation(legacy)).toThrow(/unexpected shape/);
  });
});
