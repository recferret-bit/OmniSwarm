// The report contract: which outputs a report directory must hold and whether they validate. loadAuditors is the
// one entry; the auditor output shape lives in report-contract-auditor.mjs and the run-record checks in
// report-contract-health.mjs. Report files are read and written through report-files.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { classifyAuditFailure, FAILURE_MESSAGES } from './audit-process.mjs';
import { verificationHealth } from './verification-health.mjs';
import { REVIEW_WORKFLOW } from './review-workflow.mjs';
import { readCanonicalSubmission } from './audit-submission.mjs';
import { isReviewerId, reviewersOfMeta } from './reviewer-registry.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { hostLogRel } from './sandbox-host-paths.mjs';
import { expectedJobNames } from './reviewer-plan-assign.mjs';
import { sha256Json } from './hash-util.mjs';
import { MAX_REPORT_BYTES as MAX_BYTES, readReportJson, readReportText, writeReportFile } from './report-files.mjs';
import { adapterOf, citation, filledText as text, validCrosscheckRow, validateAuditor } from './report-contract-auditor.mjs';
import { reviewerReportErrors, runRecordErrors, sourceReadDigestProblem } from './report-contract-health.mjs';
import { stage1DefersDebates } from './report-incompletion.mjs';

export { readReportJson, readReportText, writeReportFile };
export { adapterOf, citation, validCrosscheckRow, validateAuditor, sourceReadDigestProblem };

const record = (x) => x && typeof x === 'object' && !Array.isArray(x);
// meta.reviewers entries are the parsed spec plus what the run observed: the key fingerprint (first and last
// 4 hex of sha256, never the key) and the model the provider reported serving.
function validPublishedReviewer(entry) {
  if (!record(entry)) return false;
  const { keyFingerprint, servedModel, ...spec } = entry;
  if (keyFingerprint !== undefined && !(typeof keyFingerprint === 'string' && /^[a-f0-9]{8}$/.test(keyFingerprint))) return false;
  if (servedModel !== undefined && !(typeof servedModel === 'string' && servedModel.length > 0 && servedModel.length <= 128)) return false;
  return validate('reviewer-spec#parsed', spec).ok;
}
function normalizeMeta(meta, errors) {
  for (const key of ['name', 'mode', 'source', 'ref', 'commit', 'date']) {
    if (meta[key] != null && (typeof meta[key] !== 'string' || meta[key].length > 2000)) {
      errors.push(`Invalid metadata field: ${key}.`);
      delete meta[key];
    }
  }
  if (meta.date && !Number.isFinite(Date.parse(meta.date))) {
    errors.push('Invalid metadata date.');
    delete meta.date;
  }
  if (!Array.isArray(meta.agents) || !meta.agents.length || !meta.agents.every(isReviewerId) || new Set(meta.agents).size !== meta.agents.length) {
    errors.push('Invalid adapter inventory.');
    meta.agents = [];
  }
  if (meta.models != null && (typeof meta.models !== 'object' || Array.isArray(meta.models) || !Object.entries(meta.models).every(([a, m]) => isReviewerId(a) && typeof m === 'string' && m.length <= 128))) {
    errors.push('Invalid requested-model metadata.');
    meta.models = {};
  }
  // meta.reviewers (W01) must describe exactly the reviewers named in meta.agents; legacy reports have none.
  if (meta.reviewers != null) {
    const ok = Array.isArray(meta.reviewers) && meta.reviewers.length && meta.reviewers.every(validPublishedReviewer)
      && JSON.stringify(meta.reviewers.map((r) => r.id).sort()) === JSON.stringify([...meta.agents].sort());
    if (!ok) { errors.push('Invalid reviewer inventory.'); delete meta.reviewers; }
  }
  if (meta.pipelineMode != null && !['full', 'step-by-step', 'stage-1'].includes(meta.pipelineMode)) {
    errors.push('Invalid pipelineMode metadata.');
    delete meta.pipelineMode;
  }
  if (meta.debatesCompleted != null && typeof meta.debatesCompleted !== 'boolean') {
    errors.push('Invalid debatesCompleted metadata.');
    delete meta.debatesCompleted;
  }
  if (meta.finalized !== true || !Array.isArray(meta.stageFailures) || !meta.stageFailures.every((s) => typeof s === 'string') || !record(meta.crosscheckExits) || !record(meta.workerExits)) {
    errors.push('Missing or invalid finalized stage/exit metadata.');
  }
}

function verifyCommittedOutput(root, meta, name, data) {
  // A run that wrote submissions/ is a committed-submission run, whatever its meta says (R-03).
  if (meta.submissionAuthority !== 'mcp_commit' && fs.existsSync(path.join(root, 'submissions'))) throw new Error('submissions exist but meta does not declare mcp_commit authority');
  if (meta.submissionAuthority !== 'mcp_commit') return;
  const identity = readReportJson(root, `harness/identities/${name}.json`);
  const manifest = readReportJson(root, 'source-manifest.json');
  const assignment = readReportJson(root, `harness/assignments/${name}.json`);
  const assignmentDigest = sha256Json(assignment);
  const reviewer = reviewersOfMeta(meta).find((r) => r.id === identity.agent);
  if (!reviewer || identity.model !== reviewer.model || identity.sourceDigest !== manifest.digest || identity.assignmentDigest !== assignmentDigest) throw new Error('Submission source/model/assignment mismatch');
  if (meta.workflow === REVIEW_WORKFLOW && identity.workflow !== REVIEW_WORKFLOW) throw new Error('Submission workflow mismatch');
  const submission = readCanonicalSubmission(root, name, identity);
  if (meta.workflow === REVIEW_WORKFLOW && identity.role === 'auditor' && (data.slice(0, -1).some(row => row.attack.length || row.poc || !text(row.analysis) || !text(row.validation)) || data.at(-1).verified_safe.some(row => !text(row.evidence)))) throw new Error('Source review evidence contract mismatch');
  if (!isDeepStrictEqual(submission.report.payload, data)) throw new Error('Derived report differs from the canonical submission');
}

// The job inventory a report must hold: the same assignment function that launched the jobs (W01-09),
// applied to the report's own reviewers, surface and assign mode. Reports without `assign` were round-robin.
export function expectedAuditors(meta) {
  if (Array.isArray(meta.auditors)) return meta.auditors;
  if (!Array.isArray(meta.agents) || !meta.agents.length || !meta.agents.every(isReviewerId)) return [];
  return expectedJobNames(meta, meta.agents.map((id) => ({ id })));
}

function readMeta(root, errors) {
  try {
    const meta = readReportJson(root, 'meta.json');
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('invalid metadata');
    return meta;
  } catch {
    errors.push('Missing or invalid meta.json; expected reviewers are unknown.');
    return {};
  }
}

function expectedInventory(meta, errors) {
  const expected = expectedAuditors({ ...meta, auditors: undefined });
  if (meta.auditors != null && (!Array.isArray(meta.auditors) || !meta.auditors.every((n) => typeof n === 'string') || JSON.stringify([...meta.auditors].sort()) !== JSON.stringify([...expected].sort()))) {
    errors.push('Declared auditor inventory does not match requested scope.');
  }
  if (!expected.length || !expected.every((n) => typeof n === 'string' && adapterOf(n) && (meta.agents.length === 0 || meta.agents.includes(adapterOf(n)))) || new Set(expected).size !== expected.length) {
    errors.push('Missing or invalid expected auditor inventory.');
    return [];
  }
  return expected;
}

// One-line explanation of a failed job or cross-check from recorded structured reasons (never log text).
function failureExplainer(root, meta) {
  let jobs = [];
  try { const manifest = readReportJson(root, 'workers.json'); if (Array.isArray(manifest?.jobs)) jobs = manifest.jobs; }
  catch { /* older reports may not include process diagnostics */ }
  return (name, crosscheck = false) => {
    const code = crosscheck ? meta.crosscheckExits?.[name] : meta.workerExits?.[name];
    const rel = hostLogRel(crosscheck ? `crosscheck-${name}` : name);
    let hasLog = false;
    try { readReportText(root, rel, 8 * 1024 * 1024); hasLog = true; } catch { /* older runs may have no log */ }
    const observed = code === 130 ? meta.stageFailures?.includes('sandbox_unavailable') ? 'sandbox_unavailable' : 'cancelled' : undefined;
    const recorded = observed || (crosscheck ? meta.providerFailures?.[name] : jobs.find(job => job?.name === name)?.failure?.reason);
    const message = Object.hasOwn(FAILURE_MESSAGES, recorded) ? FAILURE_MESSAGES[recorded] : classifyAuditFailure({ code }).message;
    return `${message}${hasLog ? ` Log: ${rel}.` : ''}`;
  };
}

function loadAuditorReports(root, meta, expected, explain, errors) {
  const reports = [];
  for (const name of expected) {
    try {
      const data = validateAuditor(readReportJson(root, `auditors/${name}.json`), name);
      verifyCommittedOutput(root, meta, name, data);
      // Require both declared outputs, without interpreting markdown as evidence.
      const stat = fs.lstatSync(path.join(root, 'auditors', `${name}.md`));
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error('missing or invalid markdown output');
      if (meta.workerExits?.[name] !== 0) errors.push(`${name}: worker exit is missing or nonzero. ${explain(name)} The committed report passed validation, so its findings are kept; rerun with --resume-from <this report> to get a clean turn without repeating the audit.`);
      reports.push({ name, data });
    } catch (err) {
      errors.push(`${name}: missing or invalid outputs (${err.code || 'contract validation failed'}). ${explain(name)}`);
    }
  }
  try {
    const extra = fs.readdirSync(path.join(root, 'auditors')).filter((n) => n.endsWith('.json') && !n.startsWith('crosscheck-') && !expected.includes(n.slice(0, -5)));
    if (extra.length) errors.push(`unexpected auditor ${extra.map((name) => name.replace(/\.json$/, '')).join(', ')}`);
  } catch { errors.push('Auditor directory is missing.'); }
  return reports;
}

// Every reviewer with peer claims owes a validated cross-check; a cross-check with nothing assigned is unexpected.
// Peers follow the orchestrator's rule (crosscheck.mjs peerClaims): another reviewer AND another vendor.
function crosscheckAssignments(root, meta, reports, explain, errors) {
  if (stage1DefersDebates(meta)) return {};
  const assignments = {};
  const reviewers = reviewersOfMeta(meta);
  const vendorOf = (id) => reviewers.find((r) => r.id === id)?.vendor ?? null;
  for (const adapter of meta.agents) {
    const own = vendorOf(adapter);
    const isPeer = (name) => adapterOf(name) !== adapter && (!own || vendorOf(adapterOf(name)) !== own);
    const ids = reports.flatMap((r) => isPeer(r.name) ? r.data.slice(0, -1).map((_, i) => `${r.name}#${i}`) : []);
    if (!ids.length) continue;
    assignments[adapter] = ids;
    if (meta.crosscheckExits?.[adapter] !== 0) errors.push(`${adapter}: missing or failed cross-check exit. ${explain(adapter, true)}`);
    try { verifyCommittedOutput(root, meta, `crosscheck-${adapter}`, readReportJson(root, `auditors/crosscheck-${adapter}.json`)); }
    catch { errors.push(`${adapter}: expected cross-check output is missing or invalid.`); }
  }
  for (const adapter of Object.keys(record(meta.crosscheckExits) ? meta.crosscheckExits : {})) {
    if (!assignments[adapter]) errors.push('Unexpected cross-check worker was excluded.');
  }
  return assignments;
}

export function loadAuditors(root, options = {}) {
  const errors = [];
  const meta = options?.meta && typeof options.meta === 'object' && !Array.isArray(options.meta)
    ? structuredClone(options.meta)
    : readMeta(root, errors);
  normalizeMeta(meta, errors);
  const expected = expectedInventory(meta, errors);
  const explain = failureExplainer(root, meta);
  errors.push(...runRecordErrors(root, meta));
  const reports = loadAuditorReports(root, meta, expected, explain, errors);
  if (Array.isArray(meta.stageFailures) && meta.stageFailures.length) errors.push('One or more review stages failed.');
  errors.push(...reviewerReportErrors(root));
  const assignments = crosscheckAssignments(root, meta, reports, explain, errors);
  const verification = meta.workflow === REVIEW_WORKFLOW ? verificationHealth(root, rel => readReportJson(root, rel, 40 * 1024 * 1024)) : null;
  const reviewState = errors.length ? 'incomplete' : 'validated_outputs';
  if (verification) errors.push(...verification.gaps);
  return {
    meta, reports, assignments,
    health: { state: errors.length ? 'incomplete' : 'validated_outputs', reviewState, verification, expected, accepted: reports.map((r) => r.name), errors, provenance: 'unverified', executionEvidence: 'not_collected' },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = loadAuditors(path.resolve(process.argv[2] || ''));
  const complete = result.health.state !== 'incomplete';
  process.stdout.write(`${complete ? 'COMPLETE' : 'INCOMPLETE'}\n`);
  if (!complete) process.stderr.write(`${result.health.errors.join('\n')}\n`);
  process.exit(complete ? 0 : 2);
}
