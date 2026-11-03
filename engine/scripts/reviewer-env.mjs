// Environment handed to one reviewer process, and the fingerprint recorded in place of a key.
// ORCHESTRATION section 1.1: the process gets the base session variables plus its own allow-list.
// The bridge and the sandbox get the base set only; a key never rides along with them.
import path from 'node:path';
import { sha256Hex } from './hash-util.mjs';
import { sessionEnvironment } from './provider-cli.mjs';

const CONTROL = ['OMNI_HTTP_REPLAY', 'OMNI_HTTP_RECORD', 'OMNI_LIVE', 'OMNI_API_TIMEOUT_MS', 'OMNI_DEMO'];
// The reviewer process runs with its session workspace as cwd, so a relative fixture directory is
// resolved against the operator's cwd here, before it crosses into the child.
const DIRECTORIES = new Set(['OMNI_HTTP_REPLAY', 'OMNI_HTTP_RECORD']);

export function reviewerProcessEnv(source = process.env, allow = [], cwd = process.cwd()) {
  const env = sessionEnvironment(source);
  for (const name of [...allow, ...CONTROL]) {
    if (typeof source[name] !== 'string' || !source[name]) continue;
    env[name] = DIRECTORIES.has(name) ? path.resolve(cwd, source[name]) : source[name];
  }
  return env;
}

export function bridgeProcessEnv(source = process.env) {
  return sessionEnvironment(source);
}

// First 4 and last 4 hex characters of sha256(key). Empty when the operator did not set the key.
export function keyFingerprint(secret) {
  if (typeof secret !== 'string' || !secret) return null;
  const hex = sha256Hex(secret);
  return `${hex.slice(0, 4)}${hex.slice(-4)}`;
}

// `keyEnv` is the operator variable that holds this reviewer's key (families.fingerprintEnv), or null.
export function withKeyFingerprint(reviewer, keyEnv, env = process.env) {
  const fingerprint = typeof keyEnv === 'string' && keyEnv ? keyFingerprint(env[keyEnv]) : null;
  return fingerprint ? { ...reviewer, keyFingerprint: fingerprint } : reviewer;
}
