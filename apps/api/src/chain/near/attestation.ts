// The registry's Attestation JSON (contracts/review-registry/INTERFACE.md, v0.2) and its port form.
import type { ChainAttestation, Severity } from '../port.ts';

export interface ContractAttestation {
  request_hash: string; repo: string; commit: string; report_sha256: string; report_uri: string;
  deployed: string | null; code_hash: string | null; max_severity: Severity; block_height: number;
  block_timestamp_ms?: number; binding_confirmed?: boolean;
}

export function fromContractAttestation(row: ContractAttestation): ChainAttestation {
  return {
    requestHash: row.request_hash, repo: row.repo, commit: row.commit, reportSha256: row.report_sha256, reportUri: row.report_uri,
    deployed: row.deployed ?? null, codeHash: row.code_hash ?? null, maxSeverity: row.max_severity, blockHeight: Number(row.block_height),
    blockTimestampMs: typeof row.block_timestamp_ms === 'number' ? row.block_timestamp_ms : null, bindingConfirmed: row.binding_confirmed === true,
  };
}

export function toContractAttestation(attestation: ChainAttestation): ContractAttestation & { binding_confirmed: boolean } {
  return {
    request_hash: attestation.requestHash, repo: attestation.repo, commit: attestation.commit, report_sha256: attestation.reportSha256,
    report_uri: attestation.reportUri, deployed: attestation.deployed, code_hash: attestation.codeHash, max_severity: attestation.maxSeverity,
    block_height: attestation.blockHeight, binding_confirmed: attestation.bindingConfirmed,
    ...(attestation.blockTimestampMs !== null ? { block_timestamp_ms: attestation.blockTimestampMs } : {}),
  };
}
