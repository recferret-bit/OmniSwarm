import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sha256Hex } from './hash-util.mjs';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { validateAuditor, validCrosscheckRow } from './report-contract-auditor.mjs';
import { REVIEWER_ID_PATTERN, isReviewerId, validModelId } from './reviewer-registry.mjs';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const fingerprint = value => sha256Hex(JSON.stringify(stable(value)));
// Session names per role. Auditors and cross-checkers commit a canonical submission; debaters and the
// orchestrator commit a debate inbox entry (debate-inbox.mjs) under the same identity rules.
const ROLE_NAME = {
  auditor: (id) => `${id}-s[1-6]-(?:auth|input|logic|config|deps|client)`,
  crosscheck: (id) => `crosscheck-${id}`,
  debater: (id) => `${id}-debate-cluster-[1-9][0-9]{0,3}-r[1-3]`,
  orchestrator: (id) => `${id}-(?:judge-cluster-[1-9][0-9]{0,3}|general-review)`,
};
const SUBMISSION_ROLES = new Set(['auditor', 'crosscheck']);
const anyName = new RegExp(`^(?:${Object.values(ROLE_NAME).map((name) => name(REVIEWER_ID_PATTERN)).join('|')})$`);

export function validateSubmissionIdentity(identity, key) {
  if (typeof key !== 'string' || !anyName.test(key) || !identity || !Object.hasOwn(ROLE_NAME, identity.role) || !/^[a-f0-9]{64}$/.test(identity.sourceDigest) || !/^[a-f0-9]{64}$/.test(identity.assignmentDigest) || !validModelId(identity.model) || !isReviewerId(identity.agent) || identity.name !== key) throw new Error('Invalid submission identity');
  // The name must be this role's name for this reviewer (a debater cannot hold a judge or auditor name).
  // isReviewerId above limits the id to [a-z0-9-], so it is safe inside the pattern.
  if (!new RegExp(`^${ROLE_NAME[identity.role](identity.agent)}$`).test(key)) throw new Error('Submission reviewer mismatch');
  return identity;
}

export function commitSubmission(root, key, identity, payload, summary = '') {
  validateSubmissionIdentity(identity, key);
  if (!SUBMISSION_ROLES.has(identity.role)) throw new Error(`The ${identity.role} role commits through the debate inbox, not a canonical submission`);
  if (identity.role === 'auditor') validateAuditor(payload, key);
  else if (!Array.isArray(payload) || !payload.every(validCrosscheckRow)) throw new Error('Invalid canonical peer report');
  if (typeof summary !== 'string' || Buffer.byteLength(summary) > 2 * 1024 * 1024) throw new Error('Invalid report summary');
  const report = { payload, summary };
  const hash = fingerprint(report);
  fs.mkdirSync(path.join(root, 'submissions'), { recursive: true, mode: 0o700 });
  const file = `submissions/${key}.json`;
  if (fs.existsSync(path.join(root, file))) {
    const previous = readCanonicalSubmission(root, key, identity);
    if (previous.hash !== hash) throw new Error('A different report is already committed for this assignment. Do not replace a committed report with a second result.');
    return previous;
  }
  const submission = { version: 1, identity, hash, report, committedAt: new Date().toISOString() };
  const temporary = `submissions/${key}.next.json`;
  writeReportFile(root, temporary, JSON.stringify(submission, null, 2) + '\n');
  fs.renameSync(path.join(root, temporary), path.join(root, file));
  return submission;
}

export function readCanonicalSubmission(root, key, identity) {
  validateSubmissionIdentity(identity, key);
  const value = readReportJson(root, `submissions/${key}.json`, 4 * 1024 * 1024);
  if (value.version !== 1 || !isDeepStrictEqual(value.identity, identity) || value.hash !== fingerprint(value.report)) throw new Error('Canonical submission identity or hash mismatch');
  if (identity.role === 'auditor') validateAuditor(value.report.payload, key);
  else if (!Array.isArray(value.report.payload) || !value.report.payload.every(validCrosscheckRow)) throw new Error('Invalid canonical peer report');
  return value;
}

export function deriveSubmission(root, submission, renderMarkdown) {
  const { identity, report } = submission;
  fs.mkdirSync(path.join(root, 'auditors'), { recursive: true, mode: 0o700 });
  writeReportFile(root, `auditors/${identity.name}.json`, JSON.stringify(report.payload, null, 2) + '\n');
  if (identity.role === 'auditor') {
    const findings = report.payload.slice(0, -1);
    const controls = report.payload.at(-1).verified_safe;
    // Counts and finding details always come from the structured submission.
    const markdown = renderMarkdown(identity.name, findings[0]?.surface || identity.surface, findings, controls);
    writeReportFile(root, `auditors/${identity.name}.md`, markdown + (report.summary ? `\n## Reviewer scope and coverage notes\n\n${report.summary}\n` : ''));
  }
}
