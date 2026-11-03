// Shape of one auditor's committed output: the job name, the findings plus the final control assertions,
// and a cross-check row. report-contract.mjs re-exports these; the bridge and the submission store use them
// directly so they do not depend on the whole report contract.
import path from 'node:path';
import { REVIEWER_ID_PATTERN } from './reviewer-registry.mjs';

const LEVELS = new Set(['critical', 'high', 'medium', 'low', 'info']);
const CONFIDENCE = new Set(['confirmed', 'probable']);
const SLUGS = ['auth', 'input', 'logic', 'config', 'deps', 'client'];
// "<reviewer-id>-sN-<slug>"; the reviewer id may contain hyphens. Legacy reports use the adapter name as id.
const NAME = new RegExp(`^(${REVIEWER_ID_PATTERN})-(s[1-6])-(${SLUGS.join('|')})$`);

// Reviewer id that authored a job name (null when the name is not a job name).
export function adapterOf(name) {
  const match = NAME.exec(String(name));
  return match && SLUGS[Number(match[2].slice(1)) - 1] === match[3] ? match[1] : null;
}

// A non-empty string of at most 20 000 characters.
export const filledText = (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 20_000;
const strings = (x, allowEmpty = false) => Array.isArray(x) && x.length <= 100 && (allowEmpty || x.length > 0) && x.every(filledText);
export const citation = (p) => typeof p === 'string' && p.length <= 1000 && /^[^:\n]+:[1-9]\d*$/.test(p) && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..');

export function validCrosscheckRow(row) {
  return row && typeof row.id === 'string' && ['upheld', 'partial', 'refuted'].includes(row.verdict)
    && typeof row.reason === 'string' && row.reason.trim().length > 0 && row.reason.length <= 20_000
    && Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.length <= 100 && row.evidence.every(citation)
    && (row.severity == null || (typeof row.severity === 'string' && LEVELS.has(row.severity)));
}

export function validateAuditor(data, name) {
  const match = NAME.exec(String(name));
  if (!match) throw new Error('unknown auditor identity');
  const [, , surface, slug] = match;
  if (SLUGS[Number(surface.slice(1)) - 1] !== slug) throw new Error('auditor surface mismatch');
  if (!Array.isArray(data) || !data.length || data.length > 1000) throw new Error('expected findings plus a final control-assertions object');
  for (const row of data.slice(0, -1)) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.verified_safe) throw new Error('invalid finding object');
    if (!filledText(row.title) || !LEVELS.has(row.severity) || !CONFIDENCE.has(row.confidence)) throw new Error('invalid finding title, severity or confidence');
    if (row.surface !== surface.toUpperCase()) throw new Error('finding surface mismatch');
    if (!strings(row.location) || !row.location.every(citation)) throw new Error('expected relative file:line citations');
    if (!filledText(row.impact) || typeof row.preconditions !== 'string' || row.preconditions.length > 20_000 || !strings(row.attack, true)) throw new Error('invalid finding evidence fields');
    if (typeof row.poc !== 'string' || row.poc.length > 20_000 || !filledText(row.fix)) throw new Error('invalid finding remediation fields');
  }
  const final = data.at(-1);
  if (!final || !Array.isArray(final.verified_safe) || final.verified_safe.length > 1000 || final.title) throw new Error('missing final control assertions');
  for (const row of final.verified_safe) {
    if (!row || !filledText(row.control) || !filledText(row.how_attacked) || typeof row.holds !== 'boolean') throw new Error('invalid control assertion');
  }
  return data;
}
