// Argument checks from contracts/review-registry/src/validate.rs. A failure is the contract's panic code.
import { ChainRejectedError } from '../errors.ts';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'none'] as const;

/** One request record (about 200 bytes) at NEAR's 10^19 yocto per byte. 1 yocto never covers it; 1 NEAR does. */
export const REQUEST_STORAGE_YOCTO = 200n * 10n ** 19n;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function require(ok: boolean, code: string): void {
  if (!ok) throw new ChainRejectedError(code);
}

export function yocto(value: string): bigint {
  if (!/^[0-9]{1,40}$/.test(value)) throw new ChainRejectedError('ERR_DEPOSIT_LOW');
  return BigInt(value);
}

export function requireHash(value: string): void {
  require(/^[0-9a-f]{64}$/.test(value), 'ERR_HASH_FORMAT');
}

export function requireReportSha256(value: string): void {
  require(/^[0-9a-f]{64}$/.test(value), 'ERR_REPORT_SHA256');
}

export function requireCommit(value: string): void {
  require(/^[0-9a-f]{40}$/.test(value), 'ERR_COMMIT_FORMAT');
}

export function requireRepo(value: string): void {
  const slash = value.indexOf('/');
  const owner = slash === -1 ? '' : value.slice(0, slash);
  const name = slash === -1 ? '' : value.slice(slash + 1);
  const ok = slash > 0 && !name.includes('/')
    && owner.length >= 1 && owner.length <= 39 && /^[A-Za-z0-9-]+$/.test(owner)
    && name.length >= 1 && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name);
  require(ok, 'ERR_REPO_FORMAT');
}

function isHttpsUri(value: string): boolean {
  const rest = value.startsWith('https://') ? value.slice('https://'.length) : '';
  return rest.length > 0 && value.length <= 2000 && /^[!-~]+$/.test(rest);
}

export function requireReportUri(value: string): void {
  require(isHttpsUri(value), 'ERR_REPORT_URI');
}

export function requireEvidenceUri(value: string): void {
  require(isHttpsUri(value), 'ERR_EVIDENCE_URI');
}

export function requireReason(value: string): void {
  const chars = [...value];
  const control = chars.some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
  require(value.trim().length > 0 && chars.length <= 280 && !control, 'ERR_REASON');
}

export function requireSeverity(value: string): void {
  require((SEVERITIES as readonly string[]).includes(value), 'ERR_SEVERITY');
}

export function requireDeployment(deployed: string | null, codeHash: string | null): void {
  if (deployed === null && codeHash === null) return;
  if (deployed === null || codeHash === null) throw new ChainRejectedError('ERR_DEPLOYED_PAIR');
  require(codeHash.length >= 32 && codeHash.length <= 44 && BASE58.test(codeHash), 'ERR_CODE_HASH');
}
