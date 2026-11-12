// Everything the report pages read from a report directory, loaded once. Auditor text is untrusted; the
// renderers escape it. The target (name, source, ref, commit) comes from meta.json, written by orchestrate.sh.
import fs from 'node:fs';
import path from 'node:path';
import { loadAuditors, readReportJson, readReportText } from './report-contract.mjs';
import { claimIndex } from './report-cards.mjs';
import { readJsonOr } from './report-util-files.mjs';

const MAX = 64 * 1024 * 1024;
export const SURFACE_NAMES = {
  S1: 'Identity & Access Control',
  S2: 'Input Handling & Injection',
  S3: 'Business Logic & Value Flows',
  S4: 'Secrets, Config & Infra',
  S5: 'Dependencies & Supply Chain',
  S6: 'Client & Web Surface',
};

function sandboxOf(reportDir) {
  let sandboxMd = '';
  try { sandboxMd = readReportText(reportDir, 'harness/sandbox.md'); } catch { /* disclose unavailable coverage */ }
  const sandboxRows = String(sandboxMd).split('\n').flatMap((line) => {
    const m = line.match(/^\| (.+?) \| (ran|failed|impossible) \| (.*) \|$/);
    return m ? [{ name: m[1], result: m[2], detail: m[3] }] : [];
  });
  return { sandboxMd, sandboxRows };
}

// Assets share the report's trust boundary; display source, never active SVG.
function diagramsOf(reportDir) {
  const assetsDir = path.join(reportDir, 'assets');
  if (!fs.existsSync(assetsDir)) return [];
  return fs.readdirSync(assetsDir).filter((f) => f.endsWith('.svg') && fs.lstatSync(path.join(assetsDir, f)).isFile() && fs.statSync(path.join(assetsDir, f)).size <= 512 * 1024).sort()
    .map((f) => ({ title: f.replace(/\.svg$/, '').replace(/[-_]+/g, ' '), svg: readReportText(reportDir, `assets/${f}`, 512 * 1024) }));
}

function countsOf(findings) {
  return {
    total: findings.length,
    high: findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    info: findings.filter((f) => f.severity === 'info').length,
    modelAgreement: findings.filter((f) => f.status === 'MODEL_AGREEMENT').length,
  };
}

function surfacesOf(findings) {
  return Object.fromEntries(Object.keys(SURFACE_NAMES).map((id) => {
    const rows = findings.filter((f) => String(f.surface).toUpperCase().startsWith(id));
    const levels = { high: 0, medium: 0, low: 0, info: 0 };
    for (const f of rows) {
      const sev = f.severity === 'critical' ? 'high' : f.severity;
      if (Object.hasOwn(levels, sev)) levels[sev] += 1;
    }
    return [id, { total: rows.length, ...levels }];
  }));
}

function stepArtifactsOf(reportDir) {
  const exists = (rel) => fs.existsSync(path.join(reportDir, rel));
  let entries = [];
  try { entries = fs.readdirSync(reportDir); } catch { entries = []; }
  const roundNums = entries
    .map((f) => f.match(/^audit_round_(\d+)\.html$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  return {
    stage1Html: exists('audit_stage_1.html') ? 'audit_stage_1.html' : null,
    stage1Json: exists('audit_stage_1.json') ? 'audit_stage_1.json' : null,
    adviceHtml: exists('audit_stage_2_advice.html') ? 'audit_stage_2_advice.html' : null,
    adviceJson: exists('orchestrator-advice.json') ? 'orchestrator-advice.json' : null,
    progressJson: exists('pipeline-progress.json') ? 'pipeline-progress.json' : null,
    rounds: roundNums.map((round) => ({
      round,
      html: `audit_round_${round}.html`,
      json: exists(`audit_round_${round}.json`) ? `audit_round_${round}.json` : null,
    })),
  };
}

export function loadContext(reportDir) {
  const findings = readReportJson(reportDir, 'findings-and-scores.json', MAX);
  const { meta, reports, health: currentHealth } = loadAuditors(reportDir);
  const health = readJsonOr(reportDir, 'report-health.json', currentHealth, MAX);
  const workerManifest = readJsonOr(reportDir, 'workers.json', {}, MAX);
  const complete = health.state === 'validated_outputs';
  return {
    reportDir, findings, meta, reports, health,
    verifiedSafe: readJsonOr(reportDir, 'verified-safe.json', [], MAX),
    workerJobs: Array.isArray(workerManifest?.jobs) ? workerManifest.jobs.slice(0, 1000).filter((j) => j && typeof j.name === 'string' && typeof j.state === 'string') : [],
    ...sandboxOf(reportDir),
    diagrams: diagramsOf(reportDir),
    targetName: meta.name || path.basename(path.resolve(reportDir)),
    sourceLine: [meta.source, meta.ref && `@ ${meta.ref}`, meta.commit && `(${meta.commit})`].filter(Boolean).join(' '),
    counts: countsOf(findings),
    surfaces: surfacesOf(findings),
    originalClaims: claimIndex(reports),
    accepted: health.accepted?.length || 0,
    expected: health.expected?.length || 0,
    complete,
    reviewComplete: health.reviewState ? health.reviewState === 'validated_outputs' : complete,
    profile: readJsonOr(reportDir, 'harness/stack-profile.json', null, MAX),
    catalog: readJsonOr(reportDir, 'harness/existing-tests.json', { tests: [] }, MAX),
    pipelineProgress: readJsonOr(reportDir, 'pipeline-progress.json', null, MAX),
    orchestratorAdvice: readJsonOr(reportDir, 'orchestrator-advice.json', null, MAX),
    stepArtifacts: stepArtifactsOf(reportDir),
  };
}
