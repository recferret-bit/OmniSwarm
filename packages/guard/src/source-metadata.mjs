// @ts-check
// NEP-330 contract_source_metadata. The method is self-reported: a match means the
// deployed contract says it was built from the attested repo and commit. It does not
// prove the bytes were rebuilt. Proof is a NearBlocks or SourceScan verification.

/** @typedef {{ link: string | null, rev: string | null, fetchedAt: string }} SourceMetadata */
/** @typedef {{ repo: string, commit: string }} ReviewRef */

const SNAPSHOT = /^git\+(\S+?)\?rev=([0-9a-f]{40})$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `git+<url>?rev=<sha>` → the url and the 40-character revision.
 * @param {unknown} snapshot
 * @returns {{ url: string, rev: string } | null}
 */
export function parseSnapshot(snapshot) {
  if (typeof snapshot !== 'string') return null;
  const match = SNAPSHOT.exec(snapshot);
  if (!match) return null;
  return { url: match[1], rev: match[2] };
}

/**
 * `https://github.com/owner/repo` (optional `git+` and `.git`) → `owner/repo`.
 * @param {unknown} link
 * @returns {string | null}
 */
export function repoOfLink(link) {
  if (typeof link !== 'string' || link.length === 0) return null;
  let url = link.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
  const query = url.indexOf('?');
  if (query !== -1) url = url.slice(0, query);
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(url);
  return match ? match[1] : null;
}

/**
 * @param {unknown} raw  NEP-330 JSON, a normalized `{link, rev, fetchedAt}`, or null
 * @param {() => number} now
 * @returns {SourceMetadata | null}
 */
export function interpretSourceMetadata(raw, now) {
  if (raw == null) return null;
  if (!isObject(raw)) throw new TypeError('contract_source_metadata is not an object');
  const fetchedAt = new Date(now()).toISOString();
  if ('fetchedAt' in raw && 'rev' in raw && 'link' in raw && !('build_info' in raw)) {
    const link = raw.link === null || typeof raw.link === 'string' ? raw.link : null;
    const rev = raw.rev === null || typeof raw.rev === 'string' ? raw.rev : null;
    const at = typeof raw.fetchedAt === 'string' && raw.fetchedAt.length > 0 ? raw.fetchedAt : fetchedAt;
    return { link, rev, fetchedAt: at };
  }
  const declared = typeof raw.link === 'string' ? raw.link : null;
  const info = isObject(raw.build_info) ? raw.build_info : null;
  const snapshot = info && typeof info.source_code_snapshot === 'string' ? info.source_code_snapshot : '';
  const parsed = parseSnapshot(snapshot);
  if (!declared && !parsed) return null;
  const snapshotRepo = parsed ? repoOfLink(parsed.url) : null;
  const declaredRepo = repoOfLink(declared);
  const conflict = Boolean(parsed && declaredRepo && snapshotRepo && declaredRepo !== snapshotRepo);
  return {
    link: declared ?? (parsed ? parsed.url : null),
    rev: conflict || !parsed ? null : parsed.rev,
    fetchedAt,
  };
}

/**
 * True when the metadata names the attested GitHub repo and the same commit.
 * @param {SourceMetadata | null} meta
 * @param {ReviewRef | null | undefined} review
 */
export function sourceAgrees(meta, review) {
  if (!meta || !review) return false;
  if (typeof meta.rev !== 'string' || meta.rev.length === 0 || meta.rev !== review.commit) return false;
  const repo = repoOfLink(meta.link);
  return repo !== null && repo === review.repo;
}

/**
 * @param {SourceMetadata | null} meta
 * @param {ReviewRef | null | undefined} review
 * @returns {'match' | 'mismatch' | 'absent'}
 */
export function sourceMetadataKind(meta, review) {
  if (meta == null) return 'absent';
  return sourceAgrees(meta, review) ? 'match' : 'mismatch';
}
