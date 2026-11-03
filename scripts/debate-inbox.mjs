// Hash-first commits for debate turns, judgements and the general review. The bridge handler writes one file
// per session identity; the debate phase reads it back and checks the hash. A second submit is refused.
import { sha256Hex } from './hash-util.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../packages/schemas/canonical-json.mjs';
import { readReportJson } from './report-contract.mjs';
import { writeJson } from './report-util-files.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,160}$/;
const hashOf = (body) => sha256Hex(canonicalJson(body));
const inboxRel = (name) => {
  if (!NAME.test(String(name))) throw new Error('invalid debate inbox name');
  return `debate/inbox/${name}.json`;
};

export function commitInbox(root, name, kind, body) {
  const rel = inboxRel(name);
  if (fs.existsSync(path.join(root, rel))) {
    const error = new Error('duplicate_submit: this assignment already has a committed answer');
    error.code = 'duplicate_submit';
    throw error;
  }
  const hash = hashOf(body);
  writeJson(root, rel, { version: 1, name, kind, hash, body, committedAt: new Date().toISOString() });
  return hash;
}

// Returns the committed body, or null when nothing was committed. A tampered file throws.
export function readInbox(root, name, kind) {
  const rel = inboxRel(name);
  if (!fs.existsSync(path.join(root, rel))) return null;
  const entry = readReportJson(root, rel);
  if (entry?.kind !== kind || entry.name !== name || entry.hash !== hashOf(entry.body)) throw new Error(`debate inbox ${name} does not match its hash`);
  return entry.body;
}
