// report.html above the evidence: hero, notice, finding totals, the surface map and the findings list.
import { esc, findingCard, findingsToolbar } from './report-cards.mjs';
import { SURFACE_NAMES } from './generate-html-report-context.mjs';
import { incompleteLabelOf } from './generate-html-report-evidence.mjs';

const SHORT_SURFACE = { S1: 'Identity & access', S2: 'Input & injection', S3: 'Logic & value', S4: 'Secrets & config', S5: 'Dependencies', S6: 'Client & web' };

export const sectionTitle = (id, title, side = '') => `<div class="section-heading"><h2><span class="section-num">${id}</span>${title}</h2>${side ? `<span class="meta-label">${esc(side)}</span>` : ''}</div>`;

export function hero({ targetName, meta, accepted, expected, complete, reviewComplete }, modelPage = false) {
  const statusLabel = complete ? 'Outputs validated' : reviewComplete ? 'Verification incomplete' : 'Incomplete review';
  return `<header class="hero"><div><div class="eyebrow">${modelPage ? 'Reviewer output / 03' : 'Source assessment / 01'}</div><h1>${modelPage ? 'MODEL <span>REPORT.</span>' : 'AUDIT <span>REPORT.</span>'}</h1><p class="target">${esc(targetName)}</p><div class="source">${esc([meta.mode === 'remote' ? 'GITHUB' : 'SOURCE', meta.commit && `REF ${meta.commit}`, meta.surface && `SCOPE ${meta.surface}`].filter(Boolean).join(' / '))}</div></div>
    <div class="hero-status"><span class="eyebrow">${statusLabel}</span><strong>${accepted} / ${expected} assignments</strong><p>${reviewComplete ? 'Review outputs accepted. Claims remain unverified.' : 'Review coverage gaps remain. See evidence & scope.'}</p><div class="progress" aria-hidden="true">${Array.from({ length: expected }, (_, i) => `<i${i < accepted ? ' class="done"' : ''}></i>`).join('')}</div></div></header>`;
}

export function notice(ctx) {
  const { complete, reviewComplete } = ctx;
  return `<div class="notice"><b>${complete ? 'UNVERIFIED CLAIMS' : incompleteLabelOf(ctx)}</b><span>Model assertions, not a safety certificate. ${complete ? 'Zero findings does not prove safety.' : reviewComplete ? 'Review outputs are complete, but the report could not be finished; see the errors.' : 'Missing reviews are not passes.'}</span><a href="report.html#validation">View limitations ↗</a></div>`;
}

function stats({ counts }) {
  return `<section class="stats" aria-label="Finding totals">
    ${[
    ['red', 'High severity', counts.high, 'Critical + high model claims', '01'],
    ['orange', 'Medium severity', counts.medium, 'Medium model claims', '02'],
    ['blue', 'Low + info', counts.low + counts.info, 'Lower severity model claims', '03'],
    ['green', 'Model agreement', counts.modelAgreement, 'Matching claims · unverified', '04'],
  ].map(([tone, label, number, detail, index]) => `<div class="stat ${tone}"><div class="stat-label">${label}<span>${index}</span></div><div class="stat-number">${number}</div><small>${detail}</small></div>`).join('')}
  </section>`;
}

function surfaceTile(id, label, { surfaces, health }) {
  const s = surfaces[id];
  const assignments = (health.expected || []).filter((name) => String(name).includes(`-${id.toLowerCase()}-`));
  const valid = assignments.filter((name) => (health.accepted || []).includes(name)).length;
  const missing = assignments.length > valid;
  const coverage = !assignments.length ? 'Outside scope' : missing ? 'Review incomplete' : 'Outputs received';
  return `<button type="button" class="surface" data-surface-filter="${id}" aria-pressed="false" aria-label="Filter ${id}: ${esc(label)}, ${s.total} findings. ${coverage}"><div><div class="surface-code">${id} / ${String(Object.keys(SURFACE_NAMES).indexOf(id) + 1).padStart(2, '0')}</div><div class="surface-name">${esc(SHORT_SURFACE[id])}</div></div><span class="surface-total">${s.total}</span><div class="surface-bottom">${s.total ? `<span><span class="red">${s.high}H</span> / <span class="orange">${s.medium}M</span> / <span class="blue">${s.low + s.info}L</span></span>` : '<span class="no-claims">No claims</span>'}<span class="${missing ? 'coverage-gap' : 'no-claims'}">${!assignments.length ? 'Out of scope' : missing ? 'Incomplete' : `${valid}/${assignments.length} received`}</span></div></button>`;
}

export function pipelinePanel(ctx) {
  const { pipelineProgress: prog, orchestratorAdvice: advice, meta, health, stepArtifacts } = ctx;
  const completedRounds = Number(prog?.debate?.roundsCompleted ?? prog?.debate?.completedRounds ?? 0);
  const isStage1 = completedRounds === 0 && (health?.stage === 'stage-1-no-debates' || Boolean(prog?.stage1?.noDebates));
  const hasPipeline = Boolean(prog || advice || meta?.pipelineMode || isStage1);
  if (!hasPipeline) return '';

  const stageBadge = isStage1
    ? '<span class="pill orange">STAGE 1 — NO DEBATES</span>'
    : completedRounds > 0
      ? `<span class="pill green">STAGE 3 — DEBATE ROUND ${completedRounds}</span>`
      : `<span class="pill blue">PIPELINE · ${esc(String(prog?.pipelineMode || meta?.pipelineMode || 'full').toUpperCase())}</span>`;

  const links = [
    stepArtifacts?.stage1Html && `<a href="${esc(stepArtifacts.stage1Html)}">Stage 1 Report (No Debates)</a>`,
    stepArtifacts?.adviceHtml && `<a href="${esc(stepArtifacts.adviceHtml)}">Step 2 Orchestrator Advice</a>`,
    ...(stepArtifacts?.rounds || []).map((r) => `<a href="${esc(r.html)}">Debate Round ${r.round}</a>`),
    stepArtifacts?.progressJson && `<a href="${esc(stepArtifacts.progressJson)}">pipeline-progress.json</a>`,
  ].filter(Boolean);

  let adviceHtml = '';
  if (advice) {
    const advisorId = advice.generatedBy?.orchestrator || advice.orchestratorId || 'orchestrator';
    const qualityRating = String(advice.quality?.rating || advice.qualityRating || 'assessed').toUpperCase();
    const qualitySummary = advice.quality?.summary || advice.qualitySummary || '';
    const debateNeeded = advice.debateAdvice ? Boolean(advice.debateAdvice.debateNeeded) : Boolean(advice.debateNeeded);
    const recDepth = advice.debateAdvice?.recommendedDepth || advice.recommendedDepth || 'standard';
    const recRounds = Number(advice.debateAdvice?.recommendedRounds ?? advice.recommendedRounds ?? 0);
    const rationale = advice.debateAdvice?.rationale || advice.debateRationale || '';
    const focusIds = Array.isArray(advice.debateAdvice?.focusClusterIds) ? advice.debateAdvice.focusClusterIds : [];
    const rawGaps = Array.isArray(advice.quality?.coverageGaps) ? advice.quality.coverageGaps : Array.isArray(advice.gaps) ? advice.gaps : [];
    const rawIssues = Array.isArray(advice.quality?.issues) ? advice.quality.issues : Array.isArray(advice.issues) ? advice.issues : [];
    const gapsText = rawGaps.map((g) => (typeof g === 'string' ? esc(g) : `${esc(g.area || 'gap')} (${esc(g.severity || 'info')}): ${esc(g.detail || g.reason || '')}`)).join(' · ');
    const issuesText = rawIssues.map((it) => (typeof it === 'string' ? esc(it) : `${esc(it.category || 'issue')}: ${esc(it.detail || it.reason || '')}${it.impact ? ` — impact: ${esc(it.impact)}` : ''}`)).join(' · ');
    const nextSteps = Array.isArray(advice.nextSteps) ? advice.nextSteps : [];

    adviceHtml = `<div class="prose"><p><strong>Frontier orchestrator quality advice (${esc(advisorId)} · ${esc(qualityRating)}):</strong> ${esc(qualitySummary)}</p>
      <p><span class="pill ${debateNeeded ? 'orange' : 'green'}">${debateNeeded ? `DEBATES RECOMMENDED · ${esc(recDepth)} (${recRounds} round(s))` : 'NO DEBATES NEEDED (0 rounds)'}</span> ${esc(rationale)}</p>
      ${focusIds.length ? `<p class="note"><strong>Priority debate clusters:</strong> ${focusIds.map((id) => `<code>${esc(id)}</code>`).join(', ')}</p>` : ''}
      ${gapsText ? `<p class="note"><strong>Gaps flagged:</strong> ${gapsText}</p>` : ''}
      ${issuesText ? `<p class="note"><strong>Issues flagged:</strong> ${issuesText}</p>` : ''}
      ${nextSteps.length ? `<p class="note"><strong>Recommended next steps:</strong> ${nextSteps.map(esc).join(' · ')}</p>` : ''}</div>`;
  } else if (isStage1) {
    adviceHtml = '<p class="note">Initial multi-agent pass completed with debates intentionally skipped or deferred. Run Step 2 advice or Step 3 debate rounds when ready.</p>';
  }

  return `<section class="panel" id="pipeline-stage" aria-label="Pipeline stage and orchestrator advice">
    <div class="section-heading"><h2>${stageBadge} Iterative Audit Pipeline</h2><span class="meta-label">Mode: ${esc(prog?.pipelineMode || meta?.pipelineMode || 'full')}</span></div>
    ${adviceHtml}
    ${links.length ? `<p class="note"><strong>Step artifacts:</strong> ${links.join(' · ')}</p>` : ''}
  </section>`;
}

export function overviewSections(ctx, v2) {
  const { counts, findings, originalClaims } = ctx;
  const cards = findings.map((f, i) => findingCard(f, i, { originalClaims, v2: v2?.card || null })).join('');
  return `${pipelinePanel(ctx)}${stats(ctx)}
  <section aria-labelledby="surface-heading">${sectionTitle('01', '<span id="surface-heading">Surface map</span>', 'Select a surface to filter')}<div class="surface-grid">
    ${Object.entries(SURFACE_NAMES).map(([id, label]) => surfaceTile(id, label, ctx)).join('')}
  </div></section>
  <section id="findings" aria-label="Findings">${sectionTitle('02', 'Findings', `${counts.total} prioritized model claims`)}
    ${findingsToolbar(counts, v2 ? v2.slot('toolbar') : '')}
    <div id="findings-container">${cards}</div><div class="empty" id="empty-results" hidden>No findings match. Try another filter or search.</div>
  </section>`;
}
