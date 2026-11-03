// One sha256 for the engine. sha256Json hashes JSON.stringify(value) exactly (no key sorting), which is how
// manifests, assignments and evidence files have always been digested; the canonical (sorted-key) report
// hash lives in packages/schemas.
import crypto from 'node:crypto';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value) {
  return sha256Hex(JSON.stringify(value));
}
