// Run-record checks of the report contract: the sandbox coverage record, the digest of the source the bridge
// served (R-02), budget health (W04-15) and the per-reviewer reports (W05). Each returns error strings;
// loadAuditors in report-contract.mjs collects them into report health.
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../packages/schemas/index.mjs';
import { sha256Json } from './hash-util.mjs';
import { readReportJson, readReportText } from './report-files.mjs';

const record = (x) => x && typeof x === 'object' && !Array.isArray(x);

// R-02: the bridge records the digest of the /src tree it served at the first read, and it must equal the sealed
// source manifest. /src is `sandbox-lib copyTree` of the sealed snapshot, and every name copyTree drops the snapshot
// already dropped (report-contract-digest.test.mjs pins that), so a served subset is a different tree, not a benign copy.
// A run that produced reviewer output without any recorded read fails closed.
export function sourceReadDigestProblem(root) {
  let served;
  try { served = readReportJson(root, 'harness/source-read-digest.json', 64 * 1024 * 1024); }
  catch (error) {
    if (error?.code !== 'ENOENT') return 'the recorded digest of the served source is unreadable.';
    return hasReviewerOutput(root) ? 'reviewer output exists but the bridge recorded no digest of the source it served.' : null;
  }
  let manifest;
  try { manifest = readReportJson(root, 'source-manifest.json', 64 * 1024 * 1024); }
  catch { return 'source-manifest.json is missing or invalid, so the served source cannot be checked.'; }
  if (!served || typeof served.digest !== 'string' || !Array.isArray(served.files)) return 'the recorded digest of the served source is malformed.';
  // The file list must hash to the digest it claims before either is compared with the manifest.
  if (sha256Json(served.files) !== served.digest) return 'the recorded digest does not match the file list it was computed from.';
  return served.digest === manifest.digest ? null : 'the source reviewers read differs from the sealed source manifest.';
}

function hasReviewerOutput(root) {
  if (fs.existsSync(path.join(root, 'submissions'))) return true;
  try { return fs.readdirSync(path.join(root, 'auditors')).some((name) => name.endsWith('.json')); }
  catch { return false; }
}

// W04-15: a budget or cost stop that never submitted makes the report INCOMPLETE. The pass loop writes
// harness/budget-health.json; a run with budgets whose record is missing or unreadable is not trusted either.
function budgetHealthErrors(root, meta) {
  let health;
  try { health = readReportJson(root, 'harness/budget-health.json'); }
  catch (error) {
    if (error?.code === 'ENOENT' && !(meta.budgets && meta.submissionAuthority === 'mcp_commit' && fs.existsSync(path.join(root, 'submissions')))) return [];
    return ['BUDGET: harness/budget-health.json is missing or unreadable.'];
  }
  if (!record(health) || !['COMPLETE', 'INCOMPLETE'].includes(health.state) || !Array.isArray(health.errors) || !health.errors.every((e) => typeof e === 'string' && e.length <= 300)) return ['BUDGET: harness/budget-health.json is malformed.'];
  if (health.state === 'INCOMPLETE' && !health.errors.length) return ['BUDGET: budget health is INCOMPLETE without a reason.'];
  return health.errors.map((e) => `BUDGET: ${e}`);
}

// The sandbox's record of its checks (builds, installs, scanners) is tool evidence for the Tools block. A missing
// or invalid record is shown there; it does not make the report incomplete.
export function sandboxRecordProblem(root) {
  try {
    const sandbox = readReportText(root, 'harness/sandbox.md');
    if (!/^# Sandbox/m.test(sandbox) || !/^\| .+ \| (ran|failed|impossible) \| .+ \|$/m.test(sandbox)) throw new Error('invalid coverage record');
    return null;
  } catch { return 'Sandbox record (harness/sandbox.md) is missing or invalid, so which checks the sandbox ran is unknown.'; }
}

export function runRecordErrors(root, meta) {
  const errors = [];
  if (meta.sandboxHardening === 1) {
    const problem = sourceReadDigestProblem(root);
    if (problem) errors.push(`SOURCE_DIGEST_MISMATCH: ${problem}`);
  }
  return [...errors, ...budgetHealthErrors(root, meta)];
}

// reviewers/**/report.json (W05) must match the reviewer-report schema when present.
export function reviewerReportErrors(root) {
  if (!fs.existsSync(path.join(root, 'reviewers'))) return [];
  const errors = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === 'report.json') {
        const rel = path.relative(root, full);
        const check = validate('reviewer-report', readReportJson(root, rel));
        if (!check.ok) errors.push(`${rel}: ${check.errors[0]}`);
      }
    }
  };
  try { walk(path.join(root, 'reviewers')); } catch (error) { errors.push(`reviewers/: ${error.message}`); }
  return errors;
}
