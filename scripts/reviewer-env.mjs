// Environment handed to one reviewer process, and the fingerprint recorded in place of a key.
// ORCHESTRATION section 1.1: the process gets the base session variables plus its own allow-list.
// The bridge and the sandbox get the base set only; a key never rides along with them.
import crypto from 'node:crypto';
import { sessionEnvironment } from './provider-cli.mjs';

const CONTROL = ['OMNI_HTTP_REPLAY', 'OMNI_HTTP_RECORD', 'OMNI_LIVE', 'OMNI_API_TIMEOUT_MS', 'OMNI_DEMO'];

export function reviewerProcessEnv(source = process.env, allow = []) {
  const env = sessionEnvironment(source);
  for (const name of [...allow, ...CONTROL]) {
    if (typeof source[name] === 'string' && source[name]) env[name] = source[name];
  }
  return env;
}

export function bridgeProcessEnv(source = process.env) {
  return sessionEnvironment(source);
}

// First 4 and last 4 hex characters of sha256(key). Empty when the operator did not set the key.
export function keyFingerprint(secret) {
  if (typeof secret !== 'string' || !secret) return null;
  const hex = crypto.createHash('sha256').update(secret).digest('hex');
  return `${hex.slice(0, 4)}${hex.slice(-4)}`;
}

// `allow` is the family's env allow-list. The fingerprint is taken from the first key-shaped name.
export function withKeyFingerprint(reviewer, allow, env = process.env) {
  const name = (allow || []).find((entry) => /(?:_API_KEY|_AUTH_TOKEN)$/.test(entry));
  const fingerprint = name ? keyFingerprint(env[name]) : null;
  return fingerprint ? { ...reviewer, keyFingerprint: fingerprint } : reviewer;
}
