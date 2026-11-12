// Structured incompletion diagnostics: classifies every incomplete audit signal (arguing/debate timeouts
// and caps, reviewer session timeouts, usage limits, provider/auth errors, budget ceilings, cross-check
// gaps, sandbox verification gaps, and stage failures) into human-readable reason + security impact notes.
import fs from 'node:fs';
import path from 'node:path';
import { readReportJson } from './report-files.mjs';
import { reviewersOfMeta } from './reviewer-registry.mjs';

const SURFACE_LABELS = {
  s1: 'S1 (Auth & Trust Boundaries)',
  s2: 'S2 (Input & Serialization)',
  s3: 'S3 (Business Logic & State)',
  s4: 'S4 (External Calls & Custody)',
  s5: 'S5 (Runtime & Dependencies)',
  s6: 'S6 (Build, CI & Secrets)',
};

const REPORT_DIR_PLACEHOLDER = '<report-dir>';

function safeJson(root, rel) {
  if (!root) return null;
  try { return readReportJson(root, rel); } catch { return null; }
}

function readTrace(root) {
  if (!root) return [];
  const file = path.join(root, 'debate', 'trace.jsonl');
  if (!fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function scrubHostPath(text, root) {
  const s = String(text || '');
  if (!root || typeof root !== 'string' || root.length < 2) return s;
  const normalized = path.resolve(root);
  return s.split(normalized).join(REPORT_DIR_PLACEHOLDER).split(root).join(REPORT_DIR_PLACEHOLDER);
}

// Phase names of orchestrator-phases.mjs, as the progress line shows them.
const PHASE_LABEL = Object.freeze({ prepare: 'Preparing sandbox', tests: 'Existing tests', review: 'Review', crosscheck: 'Cross-check', debate: 'Debate', adjudicate: 'Adjudication', 'general-review': 'General review', report: 'Report' });

function surfaceFromJobName(name) {
  const m = /-((?:s[1-6])(?:-[a-z0-9]+)?)$/i.exec(String(name || ''));
  if (!m) return null;
  const code = m[1].slice(0, 2).toLowerCase();
  return SURFACE_LABELS[code] || code.toUpperCase();
}

function reviewerMetaLabel(jobOrAgent, reviewers) {
  const text = String(jobOrAgent || '');
  const found = reviewers.find((r) => text === r.id || text.startsWith(`${r.id}-`));
  if (!found) return text;
  return `${found.id} (${found.vendor}/${found.model})`;
}

// A reviewer that stopped before any review work needs an operator action, not just a re-run. Provider-neutral: the
// key variable of each provider is in packages/schemas/providers.mjs and docs/providers.md.
export const PROVIDER_SETUP_STEPS = Object.freeze({
  live_required: 'Live provider calls are off: set OMNI_LIVE=1 for a real, billed API-provider run.',
  auth_required: 'The reviewer was not authenticated: check its CLI login or its provider key (docs/providers.md lists each key variable).',
  setup_error: 'The reviewer could not start: for an API provider, check that its key variable is set (docs/providers.md).',
});

export function categorizeFailureReason(reason, exitCode) {
  const r = String(reason || '').toLowerCase();
  if (r === 'timeout' || r === 'idle_timeout' || r === 'debate_turn_timeout' || r === 'debate_time' || exitCode === 124) return 'timeout';
  if (r === 'usage_limit' || r === 'rate_limit') return 'usage_limit';
  if (r === 'budget' || r === 'cost' || r === 'cost_ceiling' || r === 'budget_exhausted' || r === 'tool_budget') return 'budget_exhausted';
  if (['provider_error', 'auth_required', 'provider_policy', 'mcp_unavailable', 'model_mismatch', 'model_changed', 'process_error', 'transport_lost', 'turn_incomplete', 'permission_denied', 'session_identity_rejected'].includes(r)) {
    return 'provider_error';
  }
  if (r === 'sandbox_unavailable') return 'sandbox_verification';
  if (r === 'cancelled' || exitCode === 130) return 'timeout';
  return 'provider_error';
}

export function stage1DefersDebates(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.debatesCompleted === true) return false;
  if (meta.stage1DefersDebates === true) return true;
  if (meta.pipelineMode !== 'stage-1' && meta.pipelineMode !== 'step-by-step') return false;
  const exits = meta.crosscheckExits && typeof meta.crosscheckExits === 'object' ? Object.keys(meta.crosscheckExits) : [];
  return exits.length === 0;
}

function classifyDebateMissingReason(reason, exitCode) {
  const r = String(reason || '').toLowerCase();
  if (r === 'debate_turn_timeout' || r === 'debate_time' || r === 'timeout' || exitCode === 124) return 'timeout';
  if (r === 'cancelled' || exitCode === 130) return 'cancelled';
  if (r === 'debate_threshold' || r === 'speaker_threshold') return 'threshold';
  if (r === 'budget' || r === 'cost' || r === 'cost_ceiling' || r === 'tool_budget' || r === 'budget_exhausted') return 'budget';
  return 'failed';
}

export function buildIncompletionNotes(first, second = {}) {
  const opts = typeof first === 'string' ? (second || {}) : (first || {});
  const root = typeof first === 'string' ? first : (opts.reportDir || opts.out || '');
  const { meta = null, health = null } = opts;
  const m = meta || safeJson(root, 'meta.json') || {};
  const h = health || safeJson(root, 'report-health.json') || {};
  const workers = safeJson(root, 'workers.json');
  const budget = safeJson(root, 'harness/budget-health.json');
  const clustersDoc = safeJson(root, 'debate/clusters.json');
  const adjudicationRows = safeJson(root, 'debate/adjudication.json');
  const trace = readTrace(root);
  const reviewers = reviewersOfMeta(m);
  const notes = [];
  const seenKeys = new Set();

  const add = (note) => {
    const clean = {
      ...note,
      reason: scrubHostPath(note.reason, root),
      impact: scrubHostPath(note.impact, root),
      ...(note.nextStep ? { nextStep: scrubHostPath(note.nextStep, root) } : {}),
    };
    const multiInstance = clean.code === 'verification_coverage_gap' || clean.code === 'health_contract_error';
    const key = multiInstance
      ? `${clean.category}:${clean.code}:${clean.source}:${clean.reason}`
      : `${clean.category}:${clean.code}:${clean.source}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    notes.push(clean);
  };

  const jobs = Array.isArray(workers?.jobs) ? workers.jobs : [];
  const jobByName = new Map(jobs.filter((j) => j?.name).map((j) => [j.name, j]));

  // 1. Worker / surface pass failures (timeouts, usage limits, budget/cost_ceiling, provider errors)
  const workerExits = m.workerExits && typeof m.workerExits === 'object' ? m.workerExits : {};
  const stageList = Array.isArray(m.stageFailures) ? m.stageFailures.map(String) : [];
  // A session that never started (no exit, still pending, no recorded failure) did not fail at the provider: the run
  // stopped before the review phase reached it. They get one note below instead of one provider_error each.
  const notStarted = [];
  for (const [jobName, exitCode] of Object.entries(workerExits)) {
    if (exitCode === 0) continue;
    const job = jobByName.get(jobName);
    if (exitCode == null && job?.state === 'pending' && !job.failure?.reason) { notStarted.push(jobName); continue; }
    const reasonCode = job?.failure?.reason || (exitCode === 130 && m.stageFailures?.includes('sandbox_unavailable') ? 'sandbox_unavailable' : exitCode === 124 ? 'timeout' : 'nonzero_exit');
    const category = categorizeFailureReason(reasonCode, exitCode);
    const surface = surfaceFromJobName(jobName) || 'assigned review scope';
    const label = reviewerMetaLabel(jobName, reviewers);
    const hasValidReport = Array.isArray(h.accepted) && h.accepted.includes(jobName);
    const reasonText = category === 'timeout'
      ? `Reviewer session ${label} timed out or was interrupted (${reasonCode}, exit ${exitCode}) on ${surface}.`
      : category === 'usage_limit'
        ? `Reviewer session ${label} hit a provider usage or rate limit (${reasonCode}) on ${surface}.`
        : category === 'budget_exhausted'
          ? `Reviewer session ${label} stopped at a budget or spend ceiling (${reasonCode}, exit ${exitCode}) on ${surface}.`
          : `Reviewer session ${label} failed (${reasonCode}, exit ${exitCode}) on ${surface}.`;
    const impactText = hasValidReport
      ? `An earlier pass output for ${jobName} was retained, but the final pass did not finish cleanly; deeper follow-up checks on ${surface} may be incomplete.`
      : `${surface} lacks validated findings from ${label}. Multi-vendor corroboration on ${surface} is reduced, leaving potential single-model blind spots.`;
    const nextStepText = category === 'budget_exhausted'
      ? `Raise --max-cost-usd or --tool-budget and re-run failed sessions with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER}.`
      : PROVIDER_SETUP_STEPS[reasonCode]
        ? `${PROVIDER_SETUP_STEPS[reasonCode]} Then re-run failed sessions with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER}.`
        : `Re-run failed sessions with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER} or inspect ${surface} manually.`;
    add({
      category,
      code: `worker_${reasonCode}`,
      source: jobName,
      reason: reasonText,
      impact: impactText,
      nextStep: nextStepText,
    });
  }

  if (notStarted.length) {
    const cancelledIn = stageList.map((s) => /^run_cancelled:(.+)$/.exec(s)?.[1]).find(Boolean);
    const sandboxDown = stageList.some((s) => s === 'sandbox_unavailable' || s.startsWith('sandbox_or_orchestrator:'));
    const why = cancelledIn
      ? `the run was cancelled during the ${PHASE_LABEL[cancelledIn] || cancelledIn} phase`
      : sandboxDown ? 'the review sandbox failed before the review phase reached them' : 'the run stopped before the review phase reached them';
    const ids = [...new Set(notStarted.map((name) => reviewers.find((r) => name.startsWith(`${r.id}-`))?.id || name))];
    add({
      category: 'stage_failure',
      code: cancelledIn ? 'review_not_started_cancelled' : 'review_not_started',
      source: 'review',
      reason: `${notStarted.length} reviewer session(s) never started because ${why} (reviewers: ${ids.join(', ')}). No provider was called for them.`,
      impact: 'No surface was reviewed by these sessions, so the report holds no findings from them; zero findings here is not a clean result.',
      nextStep: cancelledIn ? 'Start a new run when ready.' : 'Fix the stage failure listed below, then start a new run.',
    });
  }

  // Missing expected auditor reports not already covered by workerExits
  if (Array.isArray(h.expected) && Array.isArray(h.accepted)) {
    for (const expectedName of h.expected) {
      if (h.accepted.includes(expectedName) || notes.some((n) => n.source === expectedName)) continue;
      if (Object.hasOwn(workerExits, expectedName) && workerExits[expectedName] !== 0) continue;
      const surface = surfaceFromJobName(expectedName) || 'assigned review scope';
      add({
        category: 'provider_error',
        code: 'missing_auditor_output',
        source: expectedName,
        reason: `Expected auditor report ${expectedName} is missing or failed contract validation.`,
        impact: `${surface} has no accepted report from ${reviewerMetaLabel(expectedName, reviewers)}; zero findings on that assignment is not evidence of safety.`,
        nextStep: `Resume or restart the missing reviewer assignment (--restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER}) before treating ${surface} as covered.`,
      });
    }
  }

  // 2. Budget & cost stops (real verification-health.mjs budgetHealth() shape: { state, budgetStops, errors }, plus legacy fields)
  if (budget && typeof budget === 'object') {
    const budgetStops = Array.isArray(budget.budgetStops) ? budget.budgetStops : [];
    const costStopSources = [
      ...budgetStops.filter((r) => r && r.stop === 'cost').map((r) => r.job || r.reviewer).filter(Boolean),
      ...(Array.isArray(budget.costStopped) ? budget.costStopped : []),
    ];
    const uniqueCostStops = [...new Set(costStopSources)];
    if (uniqueCostStops.length > 0) {
      add({
        category: 'budget_exhausted',
        code: 'max_cost_usd_reached',
        source: uniqueCostStops.join(', '),
        reason: `Run hit the configured --max-cost-usd spend ceiling during: ${uniqueCostStops.join(', ')}.`,
        impact: 'Subsequent tool calls and passes for cost-stopped reviewers were halted early; uninspected files beyond the retained pass remain unreviewed.',
        nextStep: 'Raise --max-cost-usd or narrow scope (--scope web2|web3|infra) to complete deep inspection.',
      });
    }

    const restoredSources = [
      ...budgetStops.filter((r) => r && r.stop === 'budget' && (r.restored || !r.submitted)).map((r) => r.job || r.reviewer).filter(Boolean),
      ...(Array.isArray(budget.budgetRestored) ? budget.budgetRestored : []),
    ];
    const uniqueRestored = [...new Set(restoredSources)];
    if (uniqueRestored.length > 0) {
      add({
        category: 'budget_exhausted',
        code: 'budget_restored_prior_pass',
        source: uniqueRestored.join(', '),
        reason: `Later pass exhausted tool budget before submitting on ${uniqueRestored.join(', ')}; prior validated pass output was restored.`,
        impact: 'Findings from the earlier pass are preserved, but additional files explored in the unfinished pass were not committed.',
        nextStep: 'Review coverage disclosures or increase --tool-budget if deeper multi-pass exploration is needed.',
      });
    }

    if (Array.isArray(budget.errors)) {
      for (const rawErr of budget.errors) {
        const text = String(rawErr || '').trim();
        if (!text) continue;
        const mErr = /^([^:]+):\s*budget_exhausted_without_submission$/i.exec(text);
        const reviewerId = mErr ? mErr[1].trim() : 'budget';
        const label = reviewerMetaLabel(reviewerId, reviewers);
        add({
          category: 'budget_exhausted',
          code: 'budget_exhausted_without_submission',
          source: reviewerId,
          reason: `Reviewer ${label} exhausted its tool or spend budget before committing any validated submission.`,
          impact: `Assigned review scope for ${label} has no validated findings committed across any pass; unreviewed code paths remain uncovered.`,
          nextStep: `Increase --tool-budget or --max-cost-usd and re-run with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER}.`,
        });
      }
    }

    if (Array.isArray(budget.incompleteJobs)) {
      for (const item of budget.incompleteJobs) {
        const jobName = typeof item === 'string' ? item : item?.job || 'unknown-job';
        const stop = typeof item === 'object' && item?.stop ? item.stop : 'budget';
        const surface = surfaceFromJobName(jobName) || 'assigned surface';
        add({
          category: stop === 'timeout' ? 'timeout' : 'budget_exhausted',
          code: `pass_${stop}_unsubmitted`,
          source: jobName,
          reason: `Pass for ${jobName} stopped (${stop}) without committing a validated report.`,
          impact: `${surface} did not receive a completed pass submission from ${jobName}, reducing inspection depth.`,
          nextStep: `Increase --tool-budget or re-run with --resume-from ${REPORT_DIR_PLACEHOLDER} to let the reviewer commit its report.`,
        });
      }
    }
  }

  // 3. Cross-check gaps (only when debates/crosscheck were not intentionally skipped by stage-1/step-by-step)
  if (!stage1DefersDebates(m)) {
    const ccExits = m.crosscheckExits && typeof m.crosscheckExits === 'object' ? m.crosscheckExits : {};
    for (const [agent, code] of Object.entries(ccExits)) {
      if (code === 0) continue;
      const reasonCode = m.providerFailures?.[agent] || (code === 124 ? 'timeout' : 'crosscheck_failed');
      const category = reasonCode === 'timeout' ? 'timeout' : reasonCode === 'usage_limit' ? 'usage_limit' : 'crosscheck_gap';
      add({
        category,
        code: `crosscheck_${reasonCode}`,
        source: `crosscheck-${agent}`,
        reason: `Peer cross-check by ${reviewerMetaLabel(agent, reviewers)} failed (${reasonCode}, exit ${code}).`,
        impact: 'Peer claims from other vendors lacked independent cross-check verdicts from this reviewer, weakening pre-debate false-positive filtering.',
        nextStep: `Run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1 or resume cross-check to challenge single-source claims.`,
      });
    }
    for (const err of Array.isArray(h.errors) ? h.errors : []) {
      if (/cross-check/i.test(err) && !notes.some((n) => n.category === 'crosscheck_gap' || n.source.startsWith('crosscheck-'))) {
        add({
          category: 'crosscheck_gap',
          code: 'crosscheck_incomplete',
          source: 'crosscheck',
          reason: err,
          impact: 'Cross-vendor verification of single-model findings is incomplete; unreviewed claims remain at assertion level.',
          nextStep: `Run adversarial debate rounds (./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1) or re-run cross-check to validate peer claims.`,
        });
      }
    }
  }

  // 4. Arguing / Debate rounds timeouts, unanswered turns, skipped clusters, caps, and judge unavailability
  // Real debate-rounds.mjs writes: { phase: 'debate', template: 'challenge'|'devil-advocate'|'defend'|'rebut', clusterId, round, anonId, stop: 'missing', reason }
  const missingTurns = trace.filter(
    (t) => (t?.phase === 'debate' && t?.stop === 'missing') || t?.event === 'turn_unanswered',
  );
  if (missingTurns.length > 0) {
    const bucketed = { timeout: [], cancelled: [], threshold: [], budget: [], failed: [] };
    for (const turn of missingTurns) {
      bucketed[classifyDebateMissingReason(turn.reason, turn.code)].push(turn);
    }

    if (bucketed.timeout.length > 0) {
      const clusters = [...new Set(bucketed.timeout.map((t) => t.clusterId).filter(Boolean))];
      add({
        category: 'timeout',
        code: 'debate_turn_timeout',
        source: clusters.slice(0, 8).join(', ') || 'debate',
        reason: `${bucketed.timeout.length} adversarial debate turn(s) timed out (${[...new Set(bucketed.timeout.map((t) => t.reason || 'timeout'))].join(', ')}) across cluster(s): ${clusters.join(', ') || 'unknown'}.`,
        impact: 'Clusters with timed-out challenge/defense/rebuttal turns lacked full adversarial back-and-forth; verdicts rely on partial transcripts or deterministic citation fallback.',
        nextStep: `Run another targeted debate round (./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1) with a higher turnMs budget if needed.`,
      });
    }

    if (bucketed.cancelled.length > 0) {
      const clusters = [...new Set(bucketed.cancelled.map((t) => t.clusterId).filter(Boolean))];
      add({
        category: 'timeout',
        code: 'debate_turn_cancelled',
        source: clusters.slice(0, 8).join(', ') || 'debate',
        reason: `${bucketed.cancelled.length} adversarial debate turn(s) were cancelled before completion across cluster(s): ${clusters.join(', ') || 'unknown'}.`,
        impact: 'Interrupted debate turns left contested findings without full cross-examination.',
        nextStep: `Resume debating remaining clusters via ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
      });
    }

    if (bucketed.threshold.length > 0) {
      const clusters = [...new Set(bucketed.threshold.map((t) => t.clusterId).filter(Boolean))];
      const reasons = [...new Set(bucketed.threshold.map((t) => t.reason).filter(Boolean))];
      const primaryCode = reasons.length === 1 ? reasons[0] : 'debate_threshold';
      add({
        category: 'debate_arguing',
        code: primaryCode,
        source: clusters.slice(0, 8).join(', ') || 'debate',
        reason: `${bucketed.threshold.length} debate turn(s) were skipped after repeated unanswered turns (${reasons.join(', ')}) across cluster(s): ${clusters.join(', ') || 'unknown'}.`,
        impact: 'Adversarial arguing throttled unresponsive speakers to bound runtime; affected clusters rely on partial arguments or deterministic citation rules.',
        nextStep: `Check provider availability/timeouts and run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1 to finish open clusters.`,
      });
    }

    if (bucketed.budget.length > 0) {
      const clusters = [...new Set(bucketed.budget.map((t) => t.clusterId).filter(Boolean))];
      add({
        category: 'budget_exhausted',
        code: 'debate_turn_budget_exhausted',
        source: clusters.slice(0, 8).join(', ') || 'debate',
        reason: `${bucketed.budget.length} debate turn(s) stopped due to tool or spend budget limits across cluster(s): ${clusters.join(', ') || 'unknown'}.`,
        impact: 'Speakers stopped before submitting full source-cited arguments on affected clusters.',
        nextStep: `Raise --max-cost-usd or debate tool budget and run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
      });
    }

    if (bucketed.failed.length > 0) {
      const clusters = [...new Set(bucketed.failed.map((t) => t.clusterId).filter(Boolean))];
      const reasons = [...new Set(bucketed.failed.map((t) => t.reason || 'invalid_turn'))];
      add({
        category: 'debate_arguing',
        code: 'debate_turn_unanswered',
        source: clusters.slice(0, 8).join(', ') || 'debate',
        reason: `${bucketed.failed.length} adversarial debate turn(s) failed or returned invalid output (${reasons.join(', ')}) across cluster(s): ${clusters.join(', ') || 'unknown'}.`,
        impact: 'Clusters with missing or schema-invalid speaker turns lacked complete adversarial scrutiny; verdicts rely on remaining verified citations.',
        nextStep: `Run another targeted debate round (./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1) to retry unanswered clusters.`,
      });
    }
  }

  // Real adjudication traces & debate/adjudication.json rows:
  // - debate-judge.mjs: row.rationale starts with 'judge_unavailable (<detail>); ...'
  // - debate-judge.mjs: trace { phase: 'adjudicate', template: 'judge-retry', clusterId, ..., stop: 'unavailable' }
  // - debate-run.mjs: trace { phase: 'adjudicate', template: 'rules', clusterId, stop, reason: 'judge_threshold'|'cancelled' }
  //   and row.rationale includes '(judge_threshold: judge threshold reached)' or '(cancelled: judge threshold reached)'
  const adjList = Array.isArray(adjudicationRows) ? adjudicationRows : [];
  const adjUnavailableRows = adjList.filter((r) => typeof r?.rationale === 'string' && /^judge_unavailable\b/i.test(r.rationale));
  const traceJudgeRetryMiss = trace.filter(
    (t) => (t?.phase === 'adjudicate' && t?.template === 'judge-retry' && t?.stop === 'unavailable') || t?.event === 'judge_unavailable',
  );
  const judgeUnavailableIds = [...new Set([
    ...adjUnavailableRows.map((r) => r.clusterId).filter(Boolean),
    ...traceJudgeRetryMiss.map((t) => t.clusterId).filter(Boolean),
  ])];
  if (judgeUnavailableIds.length > 0 || adjUnavailableRows.length > 0 || traceJudgeRetryMiss.length > 0 || m.stageFailures?.includes('judge_unavailable')) {
    const details = adjUnavailableRows
      .map((r) => /^judge_unavailable\s*\(([^)]+)\)/i.exec(r.rationale)?.[1])
      .filter(Boolean);
    const allTimedOut = details.length > 0 && details.every((d) => /timeout/i.test(d));
    const countLabel = judgeUnavailableIds.length || adjUnavailableRows.length || traceJudgeRetryMiss.length || 'one or more';
    add({
      category: allTimedOut ? 'timeout' : 'debate_arguing',
      code: 'judge_unavailable',
      source: judgeUnavailableIds.slice(0, 8).join(', ') || 'adjudicate',
      reason: `Orchestrator/alternate judge was unavailable${details.length ? ` (${[...new Set(details)].join(', ')})` : ''} for ${countLabel} cluster judgement(s)${judgeUnavailableIds.length ? ` (${judgeUnavailableIds.join(', ')})` : ''}.`,
      impact: 'Affected clusters were adjudicated by deterministic citation rules instead of frontier model reasoning; nuanced severity adjustments or partial mitigations may not be reflected.',
      nextStep: `Re-run adjudication/debate step (./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1) once the orchestrator provider is healthy.`,
    });
  }

  const adjThresholdRows = adjList.filter((r) => typeof r?.rationale === 'string' && /\bjudge_threshold\b/i.test(r.rationale));
  const traceJudgeThreshold = trace.filter((t) => t?.phase === 'adjudicate' && t?.template === 'rules' && t?.reason === 'judge_threshold');
  const judgeThresholdIds = [...new Set([
    ...adjThresholdRows.map((r) => r.clusterId).filter(Boolean),
    ...traceJudgeThreshold.map((t) => t.clusterId).filter(Boolean),
  ])];
  if (judgeThresholdIds.length > 0 || adjThresholdRows.length > 0 || traceJudgeThreshold.length > 0) {
    add({
      category: 'debate_arguing',
      code: 'judge_threshold',
      source: judgeThresholdIds.slice(0, 8).join(', ') || 'adjudicate',
      reason: `Adjudication stopped calling judge models after repeated consecutive failures (judge_threshold) on ${judgeThresholdIds.length || 'remaining'} cluster(s)${judgeThresholdIds.length ? ` (${judgeThresholdIds.slice(0, 6).join(', ')})` : ''}.`,
      impact: 'Remaining clusters fell back to deterministic citation rules without model adjudication.',
      nextStep: `Restore orchestrator/alternate judge availability and run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
    });
  }

  const adjCancelledRows = adjList.filter((r) => typeof r?.rationale === 'string' && /\bcancelled:\s*judge threshold reached/i.test(r.rationale));
  const traceJudgeCancelled = trace.filter((t) => t?.phase === 'adjudicate' && t?.template === 'rules' && t?.reason === 'cancelled');
  const judgeCancelledIds = [...new Set([
    ...adjCancelledRows.map((r) => r.clusterId).filter(Boolean),
    ...traceJudgeCancelled.map((t) => t.clusterId).filter(Boolean),
  ])];
  if (judgeCancelledIds.length > 0 || adjCancelledRows.length > 0 || traceJudgeCancelled.length > 0) {
    add({
      category: 'timeout',
      code: 'adjudicate_cancelled',
      source: judgeCancelledIds.slice(0, 8).join(', ') || 'adjudicate',
      reason: `Adjudication was cancelled before judging ${judgeCancelledIds.length || 'remaining'} cluster(s)${judgeCancelledIds.length ? ` (${judgeCancelledIds.slice(0, 6).join(', ')})` : ''}.`,
      impact: 'Cancelled cluster judgements fell back to deterministic citation rules.',
      nextStep: `Resume adjudication via ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
    });
  }

  // Merge cluster coverageGaps from debate/clusters.json with { phase: 'debate', template: 'skip', clusterId, stop } from trace.jsonl
  const clusterGaps = Array.isArray(clustersDoc?.coverageGaps) ? clustersDoc.coverageGaps : [];
  const gapGroups = new Map();
  const pushGap = (reason, clusterId) => {
    if (!reason) return;
    const list = gapGroups.get(reason) || [];
    if (clusterId && !list.includes(clusterId)) list.push(clusterId);
    gapGroups.set(reason, list);
  };
  for (const gap of clusterGaps) pushGap(gap?.reason, gap?.clusterId);
  for (const skip of trace.filter((t) => t?.phase === 'debate' && t?.template === 'skip')) {
    pushGap(skip.stop || skip.reason, skip.clusterId);
  }

  for (const [gapReason, ids] of gapGroups.entries()) {
    if (gapReason === 'debate_cap') {
      add({
        category: 'debate_arguing',
        code: 'debate_cluster_cap',
        source: ids.slice(0, 8).join(', ') || 'debate/clusters.json',
        reason: `${ids.length} lower-priority cluster(s) exceeded debate.maxClusters and were capped (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}).`,
        impact: 'Capped clusters were not argued in adversarial rounds and remain at their Stage 1 triage status without challenger/defender scrutiny.',
        nextStep: 'Increase debate.maxClusters if you need adversarial debate on lower-severity clusters.',
      });
    } else if (gapReason === 'debate_time') {
      add({
        category: 'timeout',
        code: 'debate_phase_timeout',
        source: ids.slice(0, 8).join(', ') || 'debate',
        reason: `Debate speaking phase reached its wall-clock deadline (debate.phaseMs), leaving ${ids.length} cluster(s) unargued (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}).`,
        impact: 'Unargued clusters fell back to deterministic rules without adversarial challenge, increasing false-positive retention risk.',
        nextStep: `Continue debating remaining clusters iteratively via ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
      });
    } else if (gapReason === 'cancelled') {
      add({
        category: 'timeout',
        code: 'debate_phase_cancelled',
        source: ids.slice(0, 8).join(', ') || 'debate',
        reason: `Debate speaking phase was cancelled before hearing ${ids.length || 'remaining'} cluster(s)${ids.length ? ` (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''})` : ''}.`,
        impact: 'Skipped clusters were adjudicated from Stage 1 citations without adversarial challenge.',
        nextStep: `Continue debating remaining clusters via ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1.`,
      });
    } else if (gapReason === 'debate_incomplete' || gapReason === 'debate_threshold' || gapReason === 'speaker_threshold') {
      add({
        category: 'debate_arguing',
        code: gapReason,
        source: ids.slice(0, 8).join(', ') || 'debate',
        reason: `Debate stopped early (${gapReason}) affecting ${ids.length || 'remaining'} cluster(s).`,
        impact: 'Adversarial arguing halted after repeated unanswered turns to prevent wasted runtime; remaining clusters use deterministic citation fallback.',
        nextStep: `Check provider availability/timeouts and run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1 to finish open clusters.`,
      });
    }
  }

  // Fallback general-review trace frame
  const fallbackGr = trace.find((t) => t?.phase === 'general-review' && t?.stop === 'fallback');
  if (fallbackGr) {
    add({
      category: 'stage_failure',
      code: 'general_review_unavailable',
      source: 'general-review',
      reason: `The orchestrator session for the executive general review failed or timed out (${fallbackGr.reason || 'unavailable'}); deterministic summary fallback was written.`,
      impact: 'Cluster findings and citations remain intact, but the executive synthesis was generated by deterministic templates rather than frontier prose.',
      nextStep: 'Inspect cluster cards directly or re-run the step when the orchestrator model is available.',
    });
  }

  // 5. Stage failures in meta.stageFailures (both bare codes and phase_failed:<phase>:<detail> from orchestrator-phases.mjs)
  for (const rawStageFailure of Array.isArray(m.stageFailures) ? m.stageFailures : []) {
    const stageFailure = String(rawStageFailure || '').trim();
    if (!stageFailure || stageFailure === 'judge_unavailable') continue;

    // Skip per-job / per-agent markers already explained in Sections 1 and 3
    const jobFailureMatch = /^auditor_(?:error|incomplete|cancelled|deferred):(.+)$/.exec(stageFailure);
    if (jobFailureMatch) {
      const jobName = jobFailureMatch[1].trim();
      if (notes.some((n) => n.source === jobName)) continue;
      const surface = surfaceFromJobName(jobName) || 'assigned review scope';
      add({
        category: /^auditor_cancelled:/.test(stageFailure) ? 'timeout' : 'provider_error',
        code: stageFailure.split(':')[0],
        source: jobName,
        reason: `Reviewer assignment ${jobName} did not complete cleanly (${stageFailure}).`,
        impact: `${surface} lacks a complete validated pass from ${reviewerMetaLabel(jobName, reviewers)}, reducing multi-model coverage.`,
        nextStep: `Re-run failed sessions with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER} or inspect ${surface} manually.`,
      });
      continue;
    }
    const ccFailureMatch = /^crosscheck_(?:error|incomplete|deferred):(.+)$/.exec(stageFailure);
    if (ccFailureMatch && notes.some((n) => n.source === `crosscheck-${ccFailureMatch[1].trim()}`)) continue;

    const pf = /^phase_failed:([^:]+):([\s\S]+)$/.exec(stageFailure);
    const phaseName = pf ? pf[1].trim() : null;
    const detail = pf ? pf[2].trim() : stageFailure;
    const innerCodeMatch = /^([a-z0-9_]+)(?::\s*([\s\S]+))?$/i.exec(detail);
    const normalizedCode = innerCodeMatch
      ? innerCodeMatch[1]
      : phaseName
        ? `phase_${phaseName.replace(/[^a-z0-9]+/gi, '_')}_failed`
        : stageFailure;

    if (normalizedCode === 'run_cancelled') {
      const label = PHASE_LABEL[detail.split(':')[1]] || detail.split(':')[1] || 'an unknown';
      add({
        category: 'stage_failure',
        code: 'run_cancelled',
        source: 'pipeline',
        reason: `The run was cancelled (Ctrl-C or SIGTERM) during the ${label} phase; every later phase was skipped.`,
        impact: 'Only the phases that finished before the cancel produced output; nothing after them was reviewed.',
        nextStep: 'Start a new run when ready.',
      });
      continue;
    }

    if (normalizedCode === 'judge_unavailable') {
      if (!notes.some((n) => n.code === 'judge_unavailable')) {
        add({
          category: 'debate_arguing',
          code: 'judge_unavailable',
          source: phaseName || 'adjudicate',
          reason: `Adjudication stage reported unavailable judge (${detail}).`,
          impact: 'Affected clusters were adjudicated by deterministic citation rules instead of frontier model reasoning.',
          nextStep: `Re-run adjudication/debate step (./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1) once the orchestrator provider is healthy.`,
        });
      }
      continue;
    }

    if (normalizedCode === 'sandbox_unavailable' || stageFailure === 'sandbox_unavailable') {
      add({
        category: 'sandbox_verification',
        code: 'sandbox_unavailable',
        source: 'docker-sandbox',
        reason: 'The offline Docker review sandbox failed or became unavailable during the run.',
        impact: 'Reviewers could not complete isolated source reads or offline test runs; audit coverage is incomplete and cannot be relied upon.',
        nextStep: 'Verify Docker daemon health and sandbox image (`./bin/audit check-agents`), then re-run.',
      });
    } else if (normalizedCode === 'general_review_unavailable' || phaseName === 'general-review') {
      add({
        category: 'stage_failure',
        code: normalizedCode === 'general_review_unavailable' ? 'general_review_unavailable' : normalizedCode,
        source: 'general-review',
        reason: `The orchestrator session for the executive general review timed out or failed (${detail}); deterministic summary fallback was written.`,
        impact: 'Cluster findings and citations remain intact, but the executive synthesis was generated by deterministic templates rather than frontier prose.',
        nextStep: 'Inspect cluster cards directly or re-run the step when the orchestrator model is available.',
      });
    } else if (normalizedCode.startsWith('debate_') || phaseName === 'debate' || phaseName === 'adjudicate') {
      const pureTime = normalizedCode === 'debate_time' || (/debate_time/i.test(detail) && !/threshold|invalid|unavailable/i.test(detail));
      add({
        category: pureTime ? 'timeout' : 'debate_arguing',
        code: normalizedCode,
        source: phaseName || 'debate',
        reason: `Debate/adjudication stage recorded incomplete execution (${detail}).`,
        impact: 'One or more disputed findings did not complete full multi-round cross-examination or model judgement and fell back to deterministic citation rules.',
        nextStep: `Run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1 to execute an additional debate round.`,
      });
    } else if (phaseName === 'crosscheck' || normalizedCode.startsWith('crosscheck')) {
      add({
        category: /timeout/i.test(detail) ? 'timeout' : 'crosscheck_gap',
        code: normalizedCode,
        source: 'crosscheck',
        reason: `Peer cross-check phase failed (${detail}).`,
        impact: 'Cross-vendor verification of single-model findings is incomplete; unreviewed claims remain at assertion level.',
        nextStep: `Run ./bin/audit debate ${REPORT_DIR_PLACEHOLDER} --rounds 1 or resume cross-check to challenge single-source claims.`,
      });
    } else {
      add({
        category: 'stage_failure',
        code: normalizedCode,
        source: phaseName || 'pipeline',
        reason: `Pipeline stage recorded failure: ${stageFailure}.`,
        impact: 'Output completeness was degraded by a stage failure; review affected surfaces and coverage records carefully.',
        nextStep: 'Check report-health.json and re-run failed stages.',
      });
    }
  }

  // 6. Sandbox / verification gaps (from health.verification.gaps or run-record errors)
  const verificationGaps = Array.isArray(h.verification?.gaps) ? h.verification.gaps : [];
  for (const gap of verificationGaps) {
    add({
      category: 'sandbox_verification',
      code: 'verification_coverage_gap',
      source: 'verification',
      reason: gap,
      impact: 'Static source analysis ran without executing all target test suites offline; runtime behavior of cited code paths was not dynamically exercised.',
      nextStep: 'Run the target project’s native test suite (e.g., forge test / cargo test) in your CI or local dev environment.',
    });
  }

  // 7. Catch-all for any remaining health.errors so an incomplete report NEVER lacks a note
  for (const err of Array.isArray(h.errors) ? h.errors : []) {
    if (verificationGaps.includes(err)) continue;
    if (/One or more review stages failed/i.test(err) && notes.length > 0) continue;
    if (/missing or failed cross-check exit|expected cross-check output/i.test(err) && notes.some((n) => n.source.startsWith('crosscheck'))) continue;
    if (/worker exit is missing or nonzero|missing or invalid outputs/i.test(err)) {
      const prefix = err.split(':')[0]?.trim();
      if (prefix && (notes.some((n) => n.source === prefix) || notStarted.includes(prefix))) continue;
    }
    const budgetSubmissionErr = /^BUDGET:\s*([^:]+):\s*budget_exhausted_without_submission$/i.exec(err);
    if (budgetSubmissionErr) {
      const rev = budgetSubmissionErr[1].trim();
      if (notes.some((n) => n.category === 'budget_exhausted' && (n.source === rev || n.source.startsWith(`${rev}-`)))) continue;
      add({
        category: 'budget_exhausted',
        code: 'budget_exhausted_without_submission',
        source: rev,
        reason: err,
        impact: `Assigned review scope for ${reviewerMetaLabel(rev, reviewers)} has no validated findings committed across any pass.`,
        nextStep: `Increase --tool-budget or --max-cost-usd and re-run with --restart-failed --resume-from ${REPORT_DIR_PLACEHOLDER}.`,
      });
      continue;
    }
    if (/^BUDGET:/i.test(err)) {
      add({
        category: 'budget_exhausted',
        code: 'budget_health_invalid',
        source: 'budget-health',
        reason: err,
        impact: 'Budget tracking metadata is missing or malformed; pass completion and spend bounds could not be verified.',
        nextStep: 'Inspect harness/budget-health.json and re-run the affected audit step.',
      });
      continue;
    }
    add({
      category: /SOURCE_DIGEST_MISMATCH|Sandbox coverage/i.test(err) ? 'sandbox_verification' : 'stage_failure',
      code: /SOURCE_DIGEST_MISMATCH/i.test(err) ? 'source_digest_mismatch' : 'health_contract_error',
      source: 'report-health',
      reason: err,
      impact: 'The report failed one or more integrity or completeness checks; treat zero findings as unverified rather than clean.',
      nextStep: 'Inspect report-health.json errors and re-run the affected audit step.',
    });
  }

  return notes;
}
