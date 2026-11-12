#!/usr/bin/env node
/**
 * debate-step-cli.mjs
 *
 * Step-by-step and iterative pipeline controller for an audit report directory:
 *   finalize <report-dir>                 Write Stage 1 / Round N artifacts + pipeline-progress.json, refresh HTML
 *   advise   [<report-dir>] [options]     Run Step 2 Frontier Orchestrator quality & debate advice
 *   debate   [<report-dir>] [options]     Run Step 3 iterative debate round(s) (default: 1 round per call)
 *   step     [<report-dir>] [options]     Advance to next pipeline stage (Step 2 Advice -> Step 3 Debate Round)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReportJson, writeReportFile } from './report-files.mjs';
import { newestReportDir, readJsonOr } from './report-util-files.mjs';
import { renderReport } from './generate-html-report.mjs';
import { adviceFallbackNote, runStageAdvice } from './orchestrator-advice.mjs';
import {
  archiveJudgeInboxForNextRound,
  loadDebateState,
  persistHarnessEvidence,
  restoreHarnessEvidence,
  saveDebateState,
  storeStage1Evidence,
  syncPipelineProgress,
  writeDebateRoundArtifacts,
  writeStage1Artifacts,
} from './orchestrator-pipeline.mjs';
import { debatePlan, offlinePlan } from './debate-plan.mjs';
import { adjudicateStage, debateStage, generalReviewStage, missingAnswersError } from './debate-run.mjs';
import { generalReviewMarkdown } from './debate-general-review.mjs';
import { families } from './reviewer-families.mjs';
import { formatReviewerSpec, parseReviewerSpec, reviewersOfMeta } from './reviewer-registry.mjs';
import { ORCHESTRATOR_ORDER, recommendedOrchestrator, selectSurfaces } from './reviewer-plan.mjs';
import { isFixtureTarget, SCRIPTED_JUDGE_REFUSAL } from './debate-fixtures.mjs';
import { demoReportVerdict } from './audit-demo-verdict.mjs';
import { CONFIG_NAME, ROOT, resolveRunConfig } from './run-config.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { digestTree } from './bridge-tools-common.mjs';
import { startOneShotDocker } from './orchestrator-sandbox.mjs';
import { createExecute } from './orchestrator-session.mjs';
import { crosscheckPhase } from './orchestrator-review.mjs';
import { runReviewSession } from './agent-session.mjs';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';
import { publishReviewers } from './reviewer-publish.mjs';
import { loadAuditors } from './report-contract.mjs';
import { buildIncompletionNotes } from './report-incompletion.mjs';

const DEMO_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-fixture');

function parseGitHubSlug(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let rest = raw.trim();
  if (rest.startsWith('https://github.com/')) rest = rest.slice('https://github.com/'.length);
  else if (rest.startsWith('http://github.com/')) rest = rest.slice('http://github.com/'.length);
  else if (rest.startsWith('git@github.com:')) rest = rest.slice('git@github.com:'.length);
  else if (rest.startsWith('ssh://git@github.com/')) rest = rest.slice('ssh://git@github.com/'.length);
  else if (rest.startsWith('github.com/')) rest = rest.slice('github.com/'.length);
  else if (rest.startsWith('-') || rest.includes('://') || rest.includes('::') || !rest.includes('/')) return null;
  rest = rest.split(/[?#]/, 1)[0].replace(/\.git$/, '');
  const [owner, repo] = rest.split('/');
  if (!owner || !repo) return null;
  const cleanRepo = repo.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(owner) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(cleanRepo)) return null;
  return `${owner}/${cleanRepo}`;
}

function cloneRemoteTarget(slug, ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-step-target-'));
  const dest = path.join(tmp, 'repo');
  const url = `https://github.com/${slug}.git`;
  const gitBase = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never'];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const safeRef = typeof ref === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) ? ref : '';
  let ok = false;
  if (!safeRef) {
    ok = spawnSync('git', [...gitBase, 'clone', '--quiet', '--depth', '1', '--no-tags', '--', url, dest], { env, stdio: 'ignore', timeout: 120_000 }).status === 0;
  } else if (spawnSync('git', [...gitBase, 'clone', '--quiet', '--depth', '1', '--no-tags', '--branch', safeRef, '--', url, dest], { env, stdio: 'ignore', timeout: 120_000 }).status === 0) {
    ok = true;
  } else {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const init = spawnSync('git', [...gitBase, '-C', dest, 'init', '--quiet'], { env, stdio: 'ignore', timeout: 15_000 });
    const add = init.status === 0 ? spawnSync('git', [...gitBase, '-C', dest, 'remote', 'add', 'origin', url], { env, stdio: 'ignore', timeout: 15_000 }) : init;
    const fetchRes = add.status === 0 ? spawnSync('git', [...gitBase, '-C', dest, 'fetch', '--quiet', '--depth', '1', 'origin', safeRef], { env, stdio: 'ignore', timeout: 120_000 }) : add;
    const checkout = fetchRes.status === 0 ? spawnSync('git', [...gitBase, '-C', dest, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { env, stdio: 'ignore', timeout: 30_000 }) : fetchRes;
    ok = checkout.status === 0;
  }
  if (!ok) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  return { targetDir: dest, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function resolveTargetDir(reportDir, explicitTarget, meta) {
  const hostTarget = readJsonOr(reportDir, 'harness/host/target.json', null)?.target;
  const candidates = [explicitTarget, hostTarget, meta?.source, meta?.demo ? DEMO_FIXTURE : ''].filter(Boolean);
  for (const candidate of candidates) {
    if (String(candidate).includes('://')) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  }
  return null;
}

function acquireTargetDir(reportDir, explicitTarget, meta) {
  const localDir = resolveTargetDir(reportDir, explicitTarget, meta);
  if (localDir) return { targetDir: localDir, cleanup: () => {} };
  if (meta?.mode === 'remote' && meta?.source) {
    const slug = parseGitHubSlug(meta.source);
    if (slug) {
      const cloned = cloneRemoteTarget(slug, meta.commit || meta.ref || '');
      if (cloned) return cloned;
    }
  }
  return { targetDir: null, cleanup: () => {} };
}

function restorePublishedHarnessIfNeeded(reportDir, meta) {
  restoreHarnessEvidence(reportDir, meta);
}

function assertManifestMatches(reportDir, targetDir) {
  const manifest = readJsonOr(reportDir, 'source-manifest.json', null);
  if (!manifest) return;
  const isSnapshotManifest = manifest.scope === 'read_only_text_source' || Array.isArray(manifest.omissions) || Boolean(manifest.formatVersion);
  if (isSnapshotManifest) {
    const snap = createSnapshot(targetDir, { exclude: [path.resolve(reportDir)] });
    try {
      if (snap.manifest.digest !== manifest.digest) {
        throw new Error(`source_digest_mismatch: ${targetDir} no longer matches source-manifest.json (${manifest.digest.slice(0, 12)})`);
      }
    } finally {
      disposeSnapshot(snap);
    }
    return;
  }
  const seen = digestTree(fs.realpathSync(targetDir));
  if (seen.digest !== manifest.digest) {
    throw new Error(`source_digest_mismatch: ${targetDir} no longer matches source-manifest.json (${manifest.digest.slice(0, 12)})`);
  }
}

function isReviewerUsable(reviewer, env, presetOpts = {}) {
  if (!reviewer || reviewer.family === 'scripted') return false;
  if (presetOpts.execute || presetOpts.offline) return true;
  const verdict = families.check(reviewer);
  if (!verdict.ok) return false;
  const family = families.get(reviewer.family);
  if (typeof family?.available === 'function' && !family.available(reviewer, env)) return false;
  return true;
}

function autoSelectOrchestrator(reportDir, meta, env, presetOpts, allowScriptedAuto) {
  const order = allowScriptedAuto ? ORCHESTRATOR_ORDER : ORCHESTRATOR_ORDER.filter((s) => !s.startsWith('scripted:'));
  const rec = recommendedOrchestrator({ env, order }).reviewer;
  if (rec) return rec;
  const runReviewers = loadRunReviewers(reportDir, meta).filter((r) => r.family !== 'scripted');
  const usable = runReviewers.find((r) => isReviewerUsable(r, env, presetOpts));
  return usable || null;
}

function loadOptionalRunConfig(meta, presetOpts = {}, env = process.env) {
  const preset = presetOpts.preset || meta?.preset || undefined;
  const envCfg = env?.OMNI_RUN_CONFIG || '';
  const rootCfg = path.join(ROOT, CONFIG_NAME);
  const configFile = presetOpts.configFile || envCfg || (fs.existsSync(rootCfg) ? rootCfg : undefined);
  if (!preset && !configFile) return null;
  try {
    return resolveRunConfig({
      flags: { ...(preset ? { preset } : {}) },
      ...(configFile ? { explicitConfig: configFile } : {}),
    });
  } catch {
    return null;
  }
}

export function resolveStepOrchestrator(reportDir, meta, explicitSpec, env = process.env, presetOpts = {}, targetDir = null) {
  const allowScriptedAuto = Boolean(meta?.demo) || Boolean(targetDir && isFixtureTarget(targetDir));
  if (explicitSpec) {
    if (explicitSpec === 'recommended') return autoSelectOrchestrator(reportDir, meta, env, presetOpts, allowScriptedAuto);
    return parseReviewerSpec(explicitSpec);
  }
  const reviewersFile = readJsonOr(reportDir, 'harness/reviewers.json', null);
  const raw = reviewersFile?.orchestrator ?? meta?.orchestrator ?? null;
  if (!raw && (presetOpts.preset || presetOpts.configFile || env?.OMNI_RUN_CONFIG)) {
    const cfg = loadOptionalRunConfig(meta, presetOpts, env);
    if (cfg?.orchestrator && cfg.orchestrator !== 'recommended') {
      return typeof cfg.orchestrator === 'string' ? parseReviewerSpec(cfg.orchestrator) : cfg.orchestrator;
    }
  }
  if (!raw || raw === 'recommended') return autoSelectOrchestrator(reportDir, meta, env, presetOpts, allowScriptedAuto);
  if (typeof raw === 'object' && raw.requested === 'recommended') {
    if (raw.resolved && (!String(raw.resolved).startsWith('scripted:') || allowScriptedAuto)) {
      return parseReviewerSpec(raw.resolved);
    }
    return autoSelectOrchestrator(reportDir, meta, env, presetOpts, allowScriptedAuto);
  }
  if (typeof raw === 'string') return parseReviewerSpec(raw);
  if (typeof raw === 'object' && raw.resolved) return parseReviewerSpec(raw.resolved);
  if (typeof raw === 'object' && raw.family && raw.provider && raw.model) return raw;
  return autoSelectOrchestrator(reportDir, meta, env, presetOpts, allowScriptedAuto);
}

function loadRunReviewers(reportDir, meta) {
  const reviewersFile = readJsonOr(reportDir, 'harness/reviewers.json', null);
  const rows = reviewersFile?.reviewers || meta?.reviewers || null;
  if (Array.isArray(rows) && rows.length) {
    return rows.map((r) => (r.spec ? parseReviewerSpec(r.spec) : parseReviewerSpec(formatReviewerSpec(r))));
  }
  return reviewersOfMeta({ agents: meta?.agents, models: meta?.models });
}

function ensureJudgeInReviewersFile(reportDir, orchestrator, alternateJudge, env = process.env) {
  const file = readJsonOr(reportDir, 'harness/reviewers.json', null);
  if (!file) return;
  const judges = [orchestrator, alternateJudge].filter((j) => j && typeof j === 'object' && j.family !== 'scripted');
  if (!judges.length) return;
  const published = publishReviewers(judges, env);
  const existing = Array.isArray(file.judges) ? file.judges : [];
  const merged = [...existing];
  for (const row of published) {
    if (!merged.some((e) => e.id === row.id)) merged.push(row);
  }
  writeReportFile(reportDir, 'harness/reviewers.json', `${JSON.stringify({ ...file, judges: merged }, null, 2)}\n`);
}

function completedRoundsOnDisk(reportDir) {
  let max = 0;
  const existingProgress = readJsonOr(reportDir, 'pipeline-progress.json', null);
  if (typeof existingProgress?.debate?.roundsCompleted === 'number') {
    max = Math.max(max, existingProgress.debate.roundsCompleted);
  }
  const roundsSummaryDir = path.join(reportDir, 'debate', 'rounds');
  if (fs.existsSync(roundsSummaryDir)) {
    for (const entry of fs.readdirSync(roundsSummaryDir)) {
      const m = entry.match(/^round-(\d+)\.json$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  for (const r of [1, 2, 3]) {
    const dir = path.join(reportDir, 'debate', `round-${r}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.json'))) max = Math.max(max, r);
  }
  const iterRoot = path.join(reportDir, 'debate', 'iterations');
  if (fs.existsSync(iterRoot)) {
    for (const entry of fs.readdirSync(iterRoot)) {
      const m = entry.match(/^round-(\d+)$/);
      if (m && fs.readdirSync(path.join(iterRoot, entry)).some((f) => f.endsWith('.json'))) max = Math.max(max, Number(m[1]));
    }
  }
  const saved = loadDebateState(reportDir);
  if (typeof saved?.roundsCompleted === 'number') max = Math.max(max, saved.roundsCompleted);
  if (saved?.turns?.length) {
    for (const t of saved.turns) max = Math.max(max, Number(t.round) || 0);
  }
  const general = readJsonOr(reportDir, 'general-review.json', null);
  if (max === 0 && fs.existsSync(path.join(reportDir, 'debate', 'adjudication.json'))) {
    max = Math.max(1, Number(general?.methodology?.debateRounds) || 1);
  }
  return max;
}

export async function finalizePipelineArtifacts(reportDir, options = {}) {
  const dir = path.resolve(reportDir);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) throw new Error(`No meta.json in ${dir}`);
  const meta = readReportJson(dir, 'meta.json');
  const targetDir = resolveTargetDir(dir, options.target, meta);
  const maxClusters = meta?.budgets?.debate?.maxClusters || 25;

  let evidence = readJsonOr(dir, 'evidence/index.json', null);
  if (!evidence && targetDir) {
    evidence = storeStage1Evidence(dir, targetDir, maxClusters);
  }

  if (!fs.existsSync(path.join(dir, 'findings-and-scores.json')) || !fs.existsSync(path.join(dir, 'report-health.json'))) {
    await renderReport(dir);
  }

  const findings = readReportJson(dir, 'findings-and-scores.json');
  const health = readReportJson(dir, 'report-health.json');
  const advice = readJsonOr(dir, 'orchestrator-advice.json', null);
  const debatesCompleted = fs.existsSync(path.join(dir, 'debate', 'adjudication.json'));
  const pipelineMode = meta.pipelineMode || options.pipelineMode || 'full';

  if (!fs.existsSync(path.join(dir, 'audit_stage_1.json')) && !debatesCompleted) {
    writeStage1Artifacts({ out: dir, meta, findings, health, advice, evidence });
  }

  if (debatesCompleted) {
    const adjudication = readJsonOr(dir, 'debate/adjudication.json', []);
    const generalReview = readJsonOr(dir, 'general-review.json', null);
    const completed = completedRoundsOnDisk(dir);
    for (let r = 1; r <= completed; r += 1) {
      let roundEntry = null;
      if (!fs.existsSync(path.join(dir, `audit_round_${r}.json`))) {
        roundEntry = writeDebateRoundArtifacts(dir, r, { rows: adjudication, meta, findings, health, generalReview });
      } else {
        const existingRound = readJsonOr(dir, `audit_round_${r}.json`, null);
        if (existingRound) {
          roundEntry = {
            round: r,
            turnsCount: existingRound.turnsCount ?? 0,
            unansweredTurns: existingRound.unansweredTurns ?? 0,
            disputedCount: existingRound.disputedCount ?? 0,
            artifacts: [`debate/rounds/round-${r}.json`, `audit_round_${r}.json`, `audit_round_${r}.md`, `audit_round_${r}.html`],
            completedAt: existingRound.completedAt || new Date().toISOString(),
          };
        }
      }
      if (roundEntry) syncPipelineProgress(dir, { pipelineMode, roundEntry });
    }
  }

  const progress = syncPipelineProgress({ out: dir, pipelineMode, meta, health, advice });
  await renderReport(dir);
  if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
  return progress;
}

export async function runAdviseStep(reportDir, options = {}) {
  const dir = path.resolve(reportDir);
  const meta = readReportJson(dir, 'meta.json');
  restorePublishedHarnessIfNeeded(dir, meta);
  const acquired = acquireTargetDir(dir, options.target, meta);
  const { targetDir } = acquired;
  if (!targetDir) {
    acquired.cleanup();
    throw new Error(`Target repository directory is required (--repo <path>); ${meta.source || 'source'} is not on disk`);
  }
  try {
    assertManifestMatches(dir, targetDir);

    const maxClusters = meta?.budgets?.debate?.maxClusters || 25;
    const preHealth = await renderReport(dir);
    const evidence = storeStage1Evidence(dir, targetDir, maxClusters);
    const orchestrator = resolveStepOrchestrator(dir, meta, options.orchestratorSpec, options.env, options, targetDir);
    if (orchestrator?.family === 'scripted' && !isFixtureTarget(targetDir)) {
      throw new Error(`${SCRIPTED_JUDGE_REFUSAL}: scripted:judge runs only on OmniSwarm fixtures`);
    }

    let session = null;
    let execute = options.execute || null;
    const stageFailures = [];
    const needDocker = orchestrator && orchestrator.family !== 'scripted' && !execute && options.offline !== true;
    const startSandbox = options.startSandbox || startOneShotDocker;
    const review = options.review || runReviewSession;

    try {
      if (needDocker) {
        ensureJudgeInReviewersFile(dir, orchestrator, null, options.env);
        const reviewers = loadRunReviewers(dir, meta);
        const sealed = createSnapshot(targetDir, { exclude: [dir] });
        try {
          session = await startSandbox({ target: sealed.snapshot, out: dir, preserveHarness: true, skipPrep: true });
        } finally {
          disposeSnapshot(sealed);
        }
        const cancellation = new AbortController();
        const runCfg = loadOptionalRunConfig(meta, options, options.env);
        const run = {
          request: { target: targetDir, out: dir, orchestrator },
          output: dir,
          sourceDigest: sealedDigest(dir, targetDir),
          reviewers,
          judges: [orchestrator],
          reviewerById: new Map([orchestrator, ...reviewers].map((r) => [r.id, r])),
          budgets: meta.budgets || runCfg?.budgets || { passes: 1, toolBudget: 40, debate: { toolBudget: 12 } },
          prices: options.prices || runCfg?.prices || null,
          dockerBin: resolveDockerBin(),
          review,
          cancellation,
          signal: cancellation.signal,
          session,
          budgetRows: [],
          costCeilings: new Set(),
          progress: { activity() {}, sessionEnd() {}, counter() {} },
        };
        execute = createExecute(run);
      }

      const advice = await runStageAdvice({
        out: dir,
        target: targetDir,
        orchestrator,
        execute,
        budgets: meta.budgets || null,
        stageFailures,
        maxClusters,
        meta,
        health: preHealth,
      });

      const health = await renderReport(dir);
      const findings = readReportJson(dir, 'findings-and-scores.json');
      if (!fs.existsSync(path.join(dir, 'debate', 'adjudication.json'))) {
        writeStage1Artifacts({ out: dir, meta, findings, health, advice, evidence });
      }
      const progress = syncPipelineProgress({ out: dir, pipelineMode: meta.pipelineMode || 'step-by-step', meta, health, advice });
      await renderReport(dir);
      if (!fs.existsSync(path.join(dir, 'debate', 'adjudication.json'))) {
        writeStage1Artifacts({ out: dir, meta, findings, health, advice, evidence });
      }
      if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
      return { action: 'advise', advice, progress };
    } finally {
      if (session) await session.stop();
    }
  } finally {
    acquired.cleanup();
  }
}

function sealedDigest(reportDir, targetDir) {
  const manifest = readJsonOr(reportDir, 'source-manifest.json', null);
  if (manifest?.digest) return manifest.digest;
  const snap = createSnapshot(targetDir, { exclude: [reportDir] });
  try { return snap.manifest.digest; } finally { disposeSnapshot(snap); }
}

function isDebateRoundStageFailure(code) {
  const s = String(code || '');
  if (s.startsWith('phase_failed:debate:') || s.startsWith('phase_failed:adjudicate:') || s.startsWith('phase_failed:general-review:')) return true;
  if (s === 'general_review_unavailable' || s === 'judge_unavailable' || s.startsWith('debate_')) return true;
  return false;
}

export async function runDebateStep(reportDir, options = {}) {
  const dir = path.resolve(reportDir);
  const addRounds = options.rounds === undefined ? 1 : Number(options.rounds);
  if (!Number.isInteger(addRounds) || addRounds < 1 || addRounds > 5) {
    throw new Error('--rounds must be an integer between 1 and 5 per step');
  }
  const meta = readReportJson(dir, 'meta.json');
  restorePublishedHarnessIfNeeded(dir, meta);
  const acquired = acquireTargetDir(dir, options.target, meta);
  const { targetDir } = acquired;
  if (!targetDir) {
    acquired.cleanup();
    throw new Error(`Target repository directory is required (--repo <path>); ${meta.source || 'source'} is not on disk`);
  }
  try {
    assertManifestMatches(dir, targetDir);

    const concurrency = Math.max(1, Math.min(8, Number(options.concurrency ?? meta.concurrency ?? 3) || 3));
    const orchestrator = resolveStepOrchestrator(dir, meta, options.orchestratorSpec, options.env, options, targetDir);
    if (!orchestrator) throw new Error('no_orchestrator_available: pass --orchestrator <spec> to run debate rounds');
    if (orchestrator.family === 'scripted' && !isFixtureTarget(targetDir)) {
      throw new Error(`${SCRIPTED_JUDGE_REFUSAL}: scripted:judge runs only on OmniSwarm fixtures`);
    }

    const reviewers = loadRunReviewers(dir, meta);
    const reviewersFile = readJsonOr(dir, 'harness/reviewers.json', null);
    const alternateRaw = reviewersFile?.alternateJudge || null;
    const alternateJudge = alternateRaw ? (typeof alternateRaw === 'string' ? parseReviewerSpec(alternateRaw) : alternateRaw) : null;

    const maxClusters = meta?.budgets?.debate?.maxClusters || 25;
    if (!fs.existsSync(path.join(dir, 'evidence', 'clusters.json'))) {
      storeStage1Evidence(dir, targetDir, maxClusters);
    }
    const evidenceClusters = readJsonOr(dir, 'evidence/clusters.json', null);
    let state = loadDebateState(dir);
    const priorCompleted = completedRoundsOnDisk(dir);
    const startRound = priorCompleted + 1;
    const endRound = priorCompleted + addRounds;
    if (endRound > 20) throw new Error('debate_rounds_limit: maximum 20 cumulative debate rounds reached');

    // Ensure Stage 1 snapshot exists before mutating findings-and-scores with debate adjudication
    if (!fs.existsSync(path.join(dir, 'audit_stage_1.json')) && priorCompleted === 0) {
      const preHealth = await renderReport(dir);
      const preFindings = readReportJson(dir, 'findings-and-scores.json');
      const preAdvice = readJsonOr(dir, 'orchestrator-advice.json', null);
      const preEvidence = readJsonOr(dir, 'evidence/index.json', null);
      writeStage1Artifacts({ out: dir, meta: { ...meta, debatesCompleted: false }, findings: preFindings, health: preHealth, advice: preAdvice, evidence: preEvidence });
    }

    const allScripted = orchestrator.family === 'scripted' && reviewers.every((r) => r.family === 'scripted');
    const scope = selectSurfaces(meta.surface || 'all', meta.scope || 'full').map((s) => s.code);
    let session = null;
    let liveCtx = null;

    try {
      if (!allScripted && !options.offline) {
        ensureJudgeInReviewersFile(dir, orchestrator, alternateJudge, options.env);
        for (const sub of ['sessions', 'harness/host', 'harness/identities', 'harness/assignments']) {
          fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 });
        }
        const needCrosscheck = priorCompleted === 0 && !fs.existsSync(path.join(dir, 'crosscheck'));
        const existingTestsCatalog = readJsonOr(dir, 'harness/existing-tests.json', null);
        const crosscheckNeedsTests = needCrosscheck && Array.isArray(existingTestsCatalog?.tests) && existingTestsCatalog.tests.length > 0;
        const startSandbox = options.startSandbox || startOneShotDocker;
        const review = options.review || runReviewSession;
        const sealed = createSnapshot(targetDir, { exclude: [dir] });
        try {
          session = await startSandbox({
            target: sealed.snapshot,
            out: dir,
            preserveHarness: true,
            skipPrep: !crosscheckNeedsTests,
          });
        } finally {
          disposeSnapshot(sealed);
        }
        const workerManifest = readJsonOr(dir, 'workers.json', { jobs: [] });
        const jobs = Array.isArray(workerManifest.jobs) ? workerManifest.jobs : [];
        const cancellation = new AbortController();
        const judges = [orchestrator, alternateJudge].filter((j) => j && typeof j === 'object' && j.family !== 'scripted');
        const runCfg = loadOptionalRunConfig(meta, options, options.env);
        const run = {
          initialMeta: meta,
          request: {
            target: targetDir,
            out: dir,
            name: meta.name || path.basename(targetDir),
            ref: meta.ref || null,
            commit: meta.commit || null,
            agents: reviewers.map((r) => r.id),
            orchestrator,
            alternateJudge,
            concurrency,
          },
          output: dir,
          sourceDigest: sealedDigest(dir, targetDir),
          surfaceArg: meta.surface || 'all',
          reviewers,
          judges,
          jobs,
          reviewerById: new Map([...judges, ...reviewers].map((r) => [r.id, r])),
          budgets: meta.budgets || runCfg?.budgets || { passes: 2, toolBudget: 40, debate: { rounds: endRound, toolBudget: 12, maxClusters, turnMs: 180000, phaseMs: 900000 } },
          prices: options.prices || runCfg?.prices || null,
          concurrency,
          dockerBin: resolveDockerBin(),
          review,
          cancellation,
          signal: cancellation.signal,
          session,
          stageFailures: [...(meta.stageFailures || [])],
          providerFailures: { ...(meta.providerFailures || {}) },
          crosscheckExits: { ...(meta.crosscheckExits || {}) },
          workerExits: { ...(meta.workerExits || {}) },
          budgetRows: [],
          costCeilings: new Set(),
          progress: { activity() {}, sessionEnd() {}, counter() {}, refresh() {} },
          saveWorkers: () => {},
        };
        run.execute = options.execute || createExecute(run);
        if (needCrosscheck) {
          await crosscheckPhase(run);
          if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
        }
        liveCtx = run;
      }

      const roundOutputs = [];
      for (let r = startRound; r <= endRound; r += 1) {
        if (r > 1) archiveJudgeInboxForNextRound(dir, r - 1);
        const cleanPriorState = state ? { ...state, trace: (state.trace || []).filter((t) => t?.phase === 'debate') } : null;
        let plan;
        if (allScripted || options.offline) {
          const manifest = readJsonOr(dir, 'source-manifest.json', null);
          plan = offlinePlan({
            out: dir,
            sourceRoot: targetDir,
            rounds: r,
            startRound: r,
            priorState: cleanPriorState,
            prebuiltClusters: evidenceClusters,
            concurrency,
            scope,
            manifest,
            maxClusters,
          });
        } else {
          const roundCtx = {
            ...liveCtx,
            startRound: r,
            priorState: cleanPriorState,
            prebuiltClusters: evidenceClusters,
            budgets: {
              ...(liveCtx.budgets || {}),
              debate: { ...(liveCtx.budgets?.debate || {}), rounds: r, maxClusters },
            },
          };
          plan = debatePlan(roundCtx, options.env);
        }

        state = await debateStage(plan);
        state = await adjudicateStage(plan, state);

        const baseFailures = (liveCtx ? liveCtx.stageFailures : (meta.stageFailures || [])).filter((f) => !isDebateRoundStageFailure(f));
        const roundStageFailures = [...baseFailures];
        const currentMissing = (state.missing || []).filter((g) => g.round == null || g.round >= startRound);
        if (currentMissing.length > 0) {
          roundStageFailures.push(`phase_failed:adjudicate:${missingAnswersError(currentMissing).message}`);
        }

        const makeUpdatedMeta = (failures) => ({
          ...meta,
          date: new Date().toISOString(),
          finalized: true,
          pipelineMode: meta.pipelineMode || 'step-by-step',
          concurrency,
          debatesCompleted: true,
          stageFailures: failures,
          ...(liveCtx ? {
            providerFailures: liveCtx.providerFailures,
            crosscheckExits: liveCtx.crosscheckExits,
          } : {}),
        });

        let updatedMeta = makeUpdatedMeta(roundStageFailures);
        const { health: preGenHealth } = loadAuditors(dir, { meta: updatedMeta });
        plan.incompletionNotes = buildIncompletionNotes(dir, { meta: updatedMeta, health: preGenHealth });

        let generalReviewFailed = false;
        try {
          await generalReviewStage(plan, state);
        } catch (err) {
          generalReviewFailed = true;
          roundStageFailures.push(`phase_failed:general-review:${err?.message || String(err)}`);
        }

        if (liveCtx) liveCtx.stageFailures = [...roundStageFailures];
        updatedMeta = makeUpdatedMeta(roundStageFailures);
        const { health: postGenHealth } = loadAuditors(dir, { meta: updatedMeta });
        const notes = buildIncompletionNotes(dir, { meta: updatedMeta, health: postGenHealth });

        if (generalReviewFailed || JSON.stringify(notes) !== JSON.stringify(plan.incompletionNotes)) {
          const existingGeneral = readJsonOr(dir, 'general-review.json', null);
          if (existingGeneral) {
            const patchedGeneral = { ...existingGeneral, incompletionNotes: notes };
            writeReportFile(dir, 'general-review.json', `${JSON.stringify(patchedGeneral, null, 2)}\n`);
            writeReportFile(dir, 'general-review.md', generalReviewMarkdown(patchedGeneral));
          }
        }

        writeReportFile(dir, 'meta.json', `${JSON.stringify(updatedMeta, null, 2)}\n`);
        saveDebateState(dir, state, r);
        if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
        const health = await renderReport(dir);
        if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
        const findings = readReportJson(dir, 'findings-and-scores.json');
        const adjudication = readJsonOr(dir, 'debate/adjudication.json', []);
        const generalReview = readJsonOr(dir, 'general-review.json', null);
        const artifact = writeDebateRoundArtifacts(dir, r, { state, rows: adjudication, incompletionNotes: notes, meta: updatedMeta, findings, health, generalReview });
        syncPipelineProgress(dir, { pipelineMode: updatedMeta.pipelineMode, roundEntry: artifact });
        roundOutputs.push(artifact);
      }

      const finalHealth = await renderReport(dir);
      if (fs.existsSync(path.join(dir, 'evidence'))) persistHarnessEvidence(dir);
      const finalMeta = readReportJson(dir, 'meta.json');
      const progress = syncPipelineProgress({ out: dir, pipelineMode: finalMeta.pipelineMode || 'step-by-step', meta: finalMeta, health: finalHealth });
      let incomplete = Array.isArray(finalMeta.stageFailures) && finalMeta.stageFailures.length > 0;
      if (!incomplete) {
        if (finalMeta.demo === true) {
          if (finalHealth.reviewState !== 'validated_outputs') {
            incomplete = true;
          } else if (fs.existsSync(path.join(dir, 'harness', 'existing-tests.json'))) {
            incomplete = demoReportVerdict(dir, targetDir).code !== 0;
          }
        } else if (finalHealth.state === 'incomplete') {
          incomplete = true;
        }
      }
      return { action: 'debate', completedRounds: endRound, roundsAdded: addRounds, roundOutputs, progress, incomplete };
    } finally {
      if (session) await session.stop();
    }
  } finally {
    acquired.cleanup();
  }
}

export async function runNextStep(reportDir, options = {}) {
  const dir = path.resolve(reportDir);
  if (!fs.existsSync(path.join(dir, 'orchestrator-advice.json'))) {
    return runAdviseStep(dir, options);
  }
  return runDebateStep(dir, options);
}

function parseCliArgs(argv) {
  const opts = { positional: [] };
  const take = (i) => {
    if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === '--repo' || arg === '--target' || arg === '--path' || arg === '-r') { opts.target = take(i); i += 2; continue; }
    if (arg === '--rounds') { opts.rounds = Number(take(i)); i += 2; continue; }
    if (arg === '--orchestrator') { opts.orchestratorSpec = take(i); i += 2; continue; }
    if (arg === '--concurrency') { opts.concurrency = Number(take(i)); i += 2; continue; }
    if (arg === '--pipeline') { opts.pipelineMode = take(i); i += 2; continue; }
    if (arg === '--preset') { opts.preset = take(i); i += 2; continue; }
    if (arg === '--config') { opts.configFile = take(i); i += 2; continue; }
    if (arg === '--step-by-step') { opts.pipelineMode = 'step-by-step'; i += 1; continue; }
    if (arg === '--no-debate') { opts.pipelineMode = 'stage-1'; i += 1; continue; }
    if (arg === '--offline' || arg === '--no-docker') { opts.offline = true; i += 1; continue; }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    opts.positional.push(arg);
    i += 1;
  }
  return opts;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['finalize', 'advise', 'debate', 'step'].includes(cmd)) {
    process.stderr.write('usage: debate-step-cli.mjs <finalize|advise|debate|step> [<report-dir>] [--rounds <1-5>] [--repo <dir>] [--orchestrator <spec>] [--concurrency <1-8>]\n');
    process.exit(2);
  }
  const opts = parseCliArgs(rest);
  const reportDir = opts.positional[0] || newestReportDir('auditors');
  if (!reportDir) {
    process.stderr.write('No report directory given and none found under reports/\n');
    process.exit(2);
  }

  if (cmd === 'finalize') {
    const progress = await finalizePipelineArtifacts(reportDir, opts);
    process.stdout.write(`Pipeline state (${progress.currentStage}) saved to ${path.join(reportDir, 'pipeline-progress.json')}\n`);
    return;
  }
  if (cmd === 'advise') {
    const res = await runAdviseStep(reportDir, opts);
    const da = res.advice?.debateAdvice || {};
    process.stdout.write(`Step 2 Frontier Orchestrator Advice saved to ${path.join(reportDir, 'orchestrator-advice.json')} (debateNeeded=${da.debateNeeded}, recommendedRounds=${da.recommendedRounds})\n`);
    const note = adviceFallbackNote(res.advice);
    if (note) process.stderr.write(`${note}\n`);
    return;
  }
  if (cmd === 'debate') {
    const res = await runDebateStep(reportDir, opts);
    process.stdout.write(`Step 3 Debate completed up to round ${res.completedRounds} (+${res.roundsAdded} round(s)); artifacts saved in ${reportDir}\n`);
    if (res.incomplete) process.exitCode = 2;
    return;
  }
  if (cmd === 'step') {
    const res = await runNextStep(reportDir, opts);
    if (res.action === 'advise') {
      const da = res.advice?.debateAdvice || {};
      process.stdout.write(`Step 2 Frontier Orchestrator Advice completed (debateNeeded=${da.debateNeeded}, recommendedRounds=${da.recommendedRounds}); run 'audit step' or 'audit debate' next if desired.\n`);
      const note = adviceFallbackNote(res.advice);
      if (note) process.stderr.write(`${note}\n`);
    } else {
      process.stdout.write(`Step 3 Debate round ${res.completedRounds} completed; artifacts saved in ${reportDir}\n`);
      if (res.incomplete) process.exitCode = 2;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(2);
  });
}
