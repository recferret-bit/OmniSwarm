// Step 2 of the iterative audit pipeline: Frontier Orchestrator Quality & Debate Advice.
// Evaluates Stage 1 multi-agent findings, highlights coverage gaps and issues, decides whether adversarial
// debates are needed at all, and recommends how deep debates should go (0..3 rounds + priority clusters).
import fs from 'node:fs';
import path from 'node:path';
import { boundedCall } from './debate-clock.mjs';
import { readInbox } from './debate-inbox.mjs';
import { DEBATE_TOOL_BUDGET } from './debate-bridge.mjs';
import { formatReviewerSpec, reviewersOfMeta } from './reviewer-registry.mjs';
import { buildIncompletionNotes } from './report-incompletion.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { readJsonOr, writeJson, writeText } from './report-util-files.mjs';
import { DEFAULTS } from './run-config.mjs';

const DISCLAIMER = 'Model agreement and passing checks do not certify security.';
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderStageAdviceBrief({ clusters = [], incompletionNotes = [], reviewers = [], failedSurfaces = [], budget = DEBATE_TOOL_BUDGET } = {}) {
  const clusterLines = clusters.length
    ? clusters.map((c) => `- ${c.id} [${c.status}] (${c.severity}, ${c.surface}): ${c.primaryTitle} — vendors: ${(c.vendors || []).join(', ') || 'single'}; citationsOk: ${Boolean(c.citationsOk)}`)
    : ['- No Stage 1 finding clusters were filed.'];
  const gapLines = [
    ...(failedSurfaces.length ? [`- Failed surfaces: ${failedSurfaces.join(', ')}`] : []),
    ...incompletionNotes.map((n) => `- [${n.category}] ${n.source}: ${n.reason} (Impact: ${n.impact})`),
  ];
  return [
    '# stage-advice', '',
    '## Objective',
    'Evaluate the quality and completeness of the Stage 1 multi-agent review (no debates yet). Point out concrete coverage gaps and quality issues, advise whether adversarial debates are needed at all, and recommend debate depth (0 rounds / none, 1 round / shallow, 2 rounds / standard, or 3 rounds / deep) plus the focus cluster IDs.', '',
    '## Stage 1 summary',
    `Reviewers: ${reviewers.length} (${new Set(reviewers.map((r) => r.vendor)).size} vendor(s)).`,
    'Clusters:', ...clusterLines, '',
    ...(gapLines.length ? ['## Recorded gaps & incompletion notes', ...gapLines, ''] : []),
    '## Output schema',
    'Call submit_stage_advice once with qualityRating, qualitySummary, coverageGaps, issues, debateNeeded, recommendedDepth, recommendedRounds, focusClusterIds, rationale, and nextSteps.', '',
    '## Tools and sources',
    'Use read_file, search_code, list_files or get_audit_context only if you need to inspect a cited line before advising on debate depth.', '',
    '## Boundaries',
    `Name only known Stage 1 cluster IDs in focusClusterIds. Do not certify the target as secure or safe to deploy. Budget: ${budget} tool calls.`, '',
  ].join('\n');
}

export function bridgeStageAdvice(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ clusters, incompletionNotes, reviewers, failedSurfaces, signal }) => {
    const name = `${reviewer.id}-stage-advice`;
    const inboxFile = path.join(ctx.output, 'debate', 'inbox', `${name}.json`);
    const sessionDir = path.join(ctx.output, 'sessions', name);
    const ts = Date.now();
    if (fs.existsSync(inboxFile)) {
      const archiveInboxDir = path.join(ctx.output, 'evidence', `archive-advice-${ts}`);
      fs.mkdirSync(archiveInboxDir, { recursive: true, mode: 0o700 });
      fs.renameSync(inboxFile, path.join(archiveInboxDir, `${name}.json`));
    }
    if (fs.existsSync(sessionDir)) {
      const archiveSessionsDir = path.join(ctx.output, 'sessions', `_archive-advice-${ts}`);
      fs.mkdirSync(archiveSessionsDir, { recursive: true, mode: 0o700 });
      fs.renameSync(sessionDir, path.join(archiveSessionsDir, name));
    }
    const files = [...new Set(clusters.flatMap((c) => (c.anchors || []).map((a) => a.file)).filter(Boolean))].sort();
    const assignment = {
      kind: 'stage-advice',
      clusterIds: clusters.map((c) => c.id),
      files,
      orchestrator: formatReviewerSpec(reviewer),
      budget,
    };
    const prompt = renderStageAdviceBrief({ clusters, incompletionNotes, reviewers, failedSurfaces, budget });
    try {
      const logFile = path.join(ctx.output, 'harness', 'host', `agent-${name}.log`);
      const res = await ctx.execute({ name, agent: reviewer.id, role: 'orchestrator', prompt, assignment, logFile, signal });
      if (res?.code !== 0) return { unavailable: res?.failure?.reason || 'session_failed' };
      const body = readInbox(ctx.output, name, 'stage-advice');
      return body || { unavailable: 'nothing_committed' };
    } catch (err) {
      return { unavailable: err?.reason || err?.code || 'session_failed' };
    }
  };
}

export function rulesStageAdvice({
  clusters = [],
  incompletionNotes = [],
  reviewers = [],
  orchestratorSpec = 'rules',
  fallbackReason = null,
  reportDirHint = '<report-dir>',
} = {}) {
  const agreed = clusters.filter((c) => c.status === 'AGREED');
  const queued = clusters.filter((c) => c.status === 'QUEUED');
  const capped = clusters.filter((c) => c.status === 'CAPPED');
  const highQueued = queued.filter((c) => ['critical', 'high'].includes(c.severity));
  const badCitations = clusters.filter((c) => c.citationsOk === false);
  const vendorCount = new Set(reviewers.map((r) => r.vendor && r.vendor !== 'scripted' ? r.vendor : r.id)).size;

  const severeIncompletion = incompletionNotes.some((n) => ['timeout', 'provider_error', 'usage_limit', 'sandbox_verification', 'stage_failure'].includes(n.category) && n.code !== 'verification_coverage_gap');
  const rating = severeIncompletion
    ? 'incomplete'
    : (incompletionNotes.length > 0 || vendorCount < 2 || badCitations.length > 0)
      ? 'degraded'
      : queued.length > 0
        ? 'adequate'
        : 'strong';

  const coverageGaps = [];
  for (const note of incompletionNotes) {
    coverageGaps.push(`[${note.category}] ${note.reason}`);
  }
  if (vendorCount < 2) {
    coverageGaps.push('Only one reviewer/vendor participated in Stage 1; cross-vendor corroboration is absent.');
  }
  if (capped.length > 0) {
    coverageGaps.push(`${capped.length} lower-priority cluster(s) exceed debate.maxClusters (${capped.map((c) => c.id).slice(0, 5).join(', ')}).`);
  }

  const issues = [];
  if (queued.length > 0) {
    issues.push(`${queued.length} cluster(s) lack multi-vendor agreement (${highQueued.length} critical/high) and remain unchallenged Stage 1 assertions.`);
  }
  if (badCitations.length > 0) {
    issues.push(`${badCitations.length} cluster(s) have unverified or non-matching source line quotes (${badCitations.map((c) => c.id).join(', ')}).`);
  }

  const canDebate = queued.length > 0 && vendorCount >= 2;
  let recommendedRounds = 0;
  let recommendedDepth = 'none';
  if (canDebate) {
    if (highQueued.some((c) => c.severity === 'critical') || highQueued.length >= 2 || badCitations.length > 0) {
      recommendedRounds = 3;
      recommendedDepth = 'deep';
    } else if (highQueued.length === 1 || queued.length >= 2) {
      recommendedRounds = 2;
      recommendedDepth = 'standard';
    } else {
      recommendedRounds = 1;
      recommendedDepth = 'shallow';
    }
  }

  const focusClusterIds = canDebate
    ? [...queued]
      .sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || a.id.localeCompare(b.id, 'en', { numeric: true }))
      .slice(0, 10)
      .map((c) => c.id)
    : [];

  const summary = clusters.length === 0
    ? `Stage 1 produced 0 finding clusters across ${reviewers.length} reviewer(s)${incompletionNotes.length ? ` with ${incompletionNotes.length} incompletion note(s)` : ''}.`
    : `Stage 1 clustered ${clusters.length} finding(s): ${agreed.length} multi-vendor AGREED, ${queued.length} single-source/contested QUEUED${capped.length ? `, ${capped.length} CAPPED` : ''}.${incompletionNotes.length ? ` ${incompletionNotes.length} incompletion/coverage issue(s) recorded.` : ''}`;

  const rationale = !queued.length
    ? (clusters.length
      ? 'All Stage 1 clusters already achieved independent multi-vendor agreement on verified source lines; adversarial debate rounds are not needed.'
      : 'No Stage 1 clusters are queued for adversarial debate. Address any coverage gaps before assuming clean surfaces.')
    : vendorCount < 2
      ? 'Stage 1 has uncorroborated claims, but fewer than two independent reviewers are configured, so adversarial peer debate cannot challenge them until another reviewer is added.'
      : `${queued.length} cluster(s) (${highQueued.length} critical/high) lack cross-vendor consensus. Running ${recommendedRounds} ${recommendedDepth} debate round(s) will test ${focusClusterIds.slice(0, 4).join(', ')} with cited challenges and author defenses.`;

  const nextSteps = [];
  if (severeIncompletion) {
    nextSteps.push(`Resolve incomplete Stage 1 passes first (see incompletion notes or run --restart-failed --resume-from ${reportDirHint}).`);
  }
  if (canDebate) {
    nextSteps.push(`Run ${recommendedRounds} adversarial debate round(s): ./bin/audit debate ${reportDirHint} --rounds ${recommendedRounds} (or step 1 round at a time with --rounds 1).`);
  } else if (queued.length > 0 && vendorCount < 2) {
    nextSteps.push('Add a second reviewer from a different model vendor before running debate rounds, or inspect Stage 1 citations manually.');
  } else {
    nextSteps.push('No debate rounds needed — inspect Stage 1 artifacts (audit_stage_1.html / report.html) and verify fixes directly.');
  }

  return {
    stage: 'stage-2-advice',
    quality: { rating, summary, coverageGaps: coverageGaps.slice(0, 64), issues: issues.slice(0, 64) },
    debateAdvice: {
      debateNeeded: canDebate,
      recommendedDepth,
      recommendedRounds,
      focusClusterIds,
      rationale,
    },
    nextSteps,
    generatedBy: {
      mode: 'rules_fallback',
      orchestrator: orchestratorSpec,
      ...(fallbackReason ? { fallbackReason: String(fallbackReason).slice(0, 500) } : {}),
    },
    disclaimer: DISCLAIMER,
  };
}

export function adviceMarkdown(advice) {
  const d = advice.debateAdvice;
  const q = advice.quality;
  const lines = [
    '# Stage 2 — Frontier Orchestrator Quality & Debate Advice',
    '',
    `- **Stage 1 Quality Rating**: \`${q.rating.toUpperCase()}\``,
    `- **Debates Needed?**: **${d.debateNeeded ? 'YES' : 'NO'}**`,
    `- **Recommended Debate Depth**: \`${d.recommendedDepth}\` (${d.recommendedRounds} round(s))`,
    `- **Advisor**: \`${advice.generatedBy.orchestrator}\` (${advice.generatedBy.mode}${advice.generatedBy.fallbackReason ? `: ${advice.generatedBy.fallbackReason}` : ''})`,
    '',
    '## Quality Summary',
    '',
    q.summary,
    '',
    '## Debate Recommendation & Rationale',
    '',
    d.rationale,
    ...(d.focusClusterIds.length ? ['', `**Priority clusters to debate**: ${d.focusClusterIds.map((id) => `\`${id}\``).join(', ')}`] : []),
    '',
    '## Coverage Gaps',
    '',
    ...(q.coverageGaps.length ? q.coverageGaps.map((g) => `- ${g}`) : ['- No additional coverage gaps flagged.']),
    '',
    '## Stage 1 Issues to Watch',
    '',
    ...(q.issues.length ? q.issues.map((i) => `- ${i}`) : ['- None flagged.']),
    '',
    '## Recommended Next Steps',
    '',
    ...advice.nextSteps.map((s, idx) => `${idx + 1}. ${s}`),
    '',
    DISCLAIMER,
    '',
  ];
  return lines.join('\n');
}

export function adviceHtml(advice) {
  const d = advice.debateAdvice;
  const q = advice.quality;
  const badgeColor = d.debateNeeded ? '#b45309' : '#15803d';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stage 2 — Orchestrator Quality &amp; Debate Advice</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1.25rem; color: #111827; background: #f9fafb; line-height: 1.55; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .pill { display: inline-block; padding: 0.2rem 0.65rem; border-radius: 999px; font-size: 0.82rem; font-weight: 600; color: #fff; background: #374151; }
  .pill-debate { background: ${badgeColor}; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.1rem; margin: 0 0 0.5rem; color: #1f2937; }
  nav { margin-bottom: 1rem; font-size: 0.9rem; }
  nav a { margin-right: 1rem; color: #2563eb; text-decoration: none; }
  ul, ol { margin: 0.4rem 0 0; padding-left: 1.35rem; }
  li { margin-bottom: 0.35rem; }
  .muted { color: #6b7280; font-size: 0.88rem; }
</style>
</head>
<body>
  <nav>
    <a href="audit_stage_1.html">Stage 1 Report (No Debates)</a>
    <a href="report.html">Main Audit Report</a>
    <a href="pipeline-progress.json">Pipeline Progress JSON</a>
  </nav>
  <div class="card">
    <div class="badges">
      <span class="pill">STEP 2 — FRONTIER ADVICE</span>
      <span class="pill">Quality: ${escapeHtml(q.rating.toUpperCase())}</span>
      <span class="pill pill-debate">${d.debateNeeded ? `Debate Recommended: ${escapeHtml(d.recommendedDepth.toUpperCase())} (${d.recommendedRounds} round${d.recommendedRounds === 1 ? '' : 's'})` : 'No Debate Needed (0 rounds)'}</span>
    </div>
    <h1>Orchestrator Quality &amp; Next-Step Advice</h1>
    <p>${escapeHtml(q.summary)}</p>
    <p class="muted">Advisor: <code>${escapeHtml(advice.generatedBy.orchestrator)}</code> (${escapeHtml(advice.generatedBy.mode)}${advice.generatedBy.fallbackReason ? ` — ${escapeHtml(advice.generatedBy.fallbackReason)}` : ''})</p>
  </div>
  <div class="card">
    <h2>Debate Recommendation</h2>
    <p>${escapeHtml(d.rationale)}</p>
    ${d.focusClusterIds.length ? `<p><strong>Focus clusters:</strong> ${d.focusClusterIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}</p>` : ''}
  </div>
  <div class="card">
    <h2>Coverage Gaps &amp; Stage 1 Issues</h2>
    <h3>Coverage Gaps</h3>
    <ul>${q.coverageGaps.length ? q.coverageGaps.map((g) => `<li>${escapeHtml(g)}</li>`).join('') : '<li>No additional coverage gaps flagged.</li>'}</ul>
    <h3 style="margin-top:0.85rem">Quality Issues</h3>
    <ul>${q.issues.length ? q.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('') : '<li>None flagged.</li>'}</ul>
  </div>
  <div class="card">
    <h2>Recommended Next Steps</h2>
    <ol>${advice.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
  </div>
  <p class="muted">${escapeHtml(advice.disclaimer)}</p>
</body>
</html>
`;
}

export function writeAdviceArtifacts(out, advice) {
  const check = validate('orchestrator-advice', advice);
  if (!check.ok) throw new Error(`orchestrator-advice failed schema validation: ${check.errors.join('; ')}`);
  writeJson(out, 'orchestrator-advice.json', advice);
  writeText(out, 'orchestrator-advice.md', adviceMarkdown(advice));
  writeText(out, 'audit_stage_2_advice.html', adviceHtml(advice));
  return ['orchestrator-advice.json', 'orchestrator-advice.md', 'audit_stage_2_advice.html'];
}

export async function runStageAdvice(first, second = {}) {
  const opts = typeof first === 'string' ? second : (first || {});
  const out = typeof first === 'string' ? first : opts.out;
  if (!out || typeof out !== 'string') throw new Error('runStageAdvice requires report directory path `out`');

  const meta = opts.meta || readJsonOr(out, 'meta.json', {}) || {};
  const health = opts.health || readJsonOr(out, 'report-health.json', {}) || {};
  const clusterRows = opts.clusters || readJsonOr(out, 'evidence/clusters.json', null)?.clusters || [];
  const incompletionNotes = opts.incompletionNotes || health.incompletionNotes || buildIncompletionNotes(out, { meta, health });
  const reviewers = opts.reviewers?.length ? opts.reviewers : reviewersOfMeta(meta);
  const orchestrator = opts.orchestrator || null;
  const ctx = opts.ctx || (opts.execute ? { output: out, execute: opts.execute } : null);
  const failedSurfaces = opts.failedSurfaces || [];
  const turnMs = opts.turnMs ?? opts.budgets?.debate?.turnMs ?? DEFAULTS.debate.turnMs;
  const toolBudget = opts.toolBudget ?? opts.budgets?.debate?.toolBudget ?? DEBATE_TOOL_BUDGET;
  const signal = opts.signal || null;

  const specLabel = orchestrator ? (typeof orchestrator === 'string' ? orchestrator : formatReviewerSpec(orchestrator)) : 'rules';

  let advice = null;
  let fallbackReason = null;
  if (ctx?.execute && orchestrator && typeof orchestrator === 'object' && orchestrator.family !== 'scripted') {
    const voice = bridgeStageAdvice(ctx, orchestrator, toolBudget);
    const raw = await boundedCall(turnMs, signal, (turnSignal) => voice({
      clusters: clusterRows,
      incompletionNotes,
      reviewers,
      failedSurfaces,
      signal: turnSignal,
    }));
    if (raw && !raw.unavailable) advice = raw;
    else fallbackReason = raw?.unavailable || 'stage_advice_unavailable';
  } else if (orchestrator?.family === 'scripted') {
    fallbackReason = 'scripted_orchestrator';
  } else if (!orchestrator) {
    fallbackReason = 'no_orchestrator_configured';
  } else {
    fallbackReason = 'offline_rules_advisor';
  }

  if (!advice) {
    advice = rulesStageAdvice({
      clusters: clusterRows,
      incompletionNotes,
      reviewers,
      orchestratorSpec: specLabel,
      fallbackReason,
      reportDirHint: opts.reportDirHint || '<report-dir>',
    });
  }
  writeAdviceArtifacts(out, advice);
  return advice;
}
