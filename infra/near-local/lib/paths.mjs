// Paths for the gitignored local sandbox. Nothing here is a secret.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, '../../..');
export const NEAR_ROOT = path.join(ROOT, 'infra/compose/.local/near');
export const NEAR_HOME = path.join(NEAR_ROOT, 'home');
export const KEYS_DIR = path.join(NEAR_ROOT, 'keys');
export const ACCOUNTS_FILE = path.join(NEAR_ROOT, 'accounts.json');
export const VALIDATOR_KEY = path.join(NEAR_HOME, 'validator_key.json');
export const WASM = path.join(ROOT, 'contracts/review-registry/res/review_registry.wasm');
export const NEAR_LOCAL_SH = path.join(ROOT, 'infra/near-local/near-local.sh');

/** Repo-relative key path stored in accounts.json. `name` is the file stem. */
export function keyFileRel(name) {
  return `infra/compose/.local/near/keys/${name}.json`;
}

export function keyFile(name) {
  return path.join(KEYS_DIR, `${name}.json`);
}
