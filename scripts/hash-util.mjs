// One sha256 for the engine. sha256Json hashes JSON.stringify(value), which is how manifests,
// assignments and evidence files have always been digested; it is not a canonical (key-sorted) form.
import crypto from 'node:crypto';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value) {
  return sha256Hex(JSON.stringify(value));
}
