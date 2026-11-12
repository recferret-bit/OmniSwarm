// Step-by-step iterative pipeline artifacts, evidence store (evidence/), per-round snapshots
// (audit_round_<n>.*), Stage 1 (no debates) artifacts (audit_stage_1.*), and pipeline-progress.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadClaims } from './debate-claims.mjs';
import { sourceReader } from './debate-citations.mjs';
import { buildClusters } from './debate-cluster.mjs';
import { buildIncompletionNotes } from './report-incompletion.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { readJsonOr, writeJson, writeText } from './report-util-files.mjs';
import { DEFAULTS } from './run-config.mjs';

const DISCLAIMER = 'Model agreement and passing checks do not certify security.';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ALLOWED_HARNESS_TOP_FILES = new Set([
  'reviewers.json',
  'source-read-digest.json',
  'verification-health.json',
  'budget-health.json',
  'stack-profile.json',
  'existing-tests.json',
  'scanner-results.json',
  'test-artifacts.json',
]);

function isAllowedHarnessTopFile(name) {
  if (ALLOWED_HARNESS_TOP_FILES.has(name)) return true;
  if (/^existing-test-results-[\w-]+\.json$/.test(name)) return true;
  if (/^existing-test-output-[\w-]+-\d+\.json$/.test(name)) return true;
  if (/^scanner-output-[\w-]+-\d+\.json$/.test(name)) return true;
  if (/^prior-[a-z0-9-]+\.json$/.test(name)) return true;
  if (/^[a-z0-9][a-z0-9_-]*\.md$/.test(name)) return true;
  return false;
}

const SAFE_JSON_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/;

// Persist non-secret harness verification, identity, assignment, scanner, existing-test, stack-profile, usage,
// and allow-listed lead files into evidence/harness/ so Cloud published reports (which strip harness/ and sessions/)
// can run continuation steps (advise + debate) with full contract & verification health intact.
// NEVER copies keys, harness/host/, harness/sandbox-run/, sessions/, or *.log files.
export function persistHarnessEvidence(out) {
  const harnessDir = path.join(out, 'harness');
  const persisted = [];
  if (!fs.existsSync(harnessDir)) return persisted;

  const copyRel = (relFromHarness) => {
    const src = path.join(harnessDir, relFromHarness);
    if (!fs.existsSync(src)) return;
    const st = fs.lstatSync(src);
    if (!st.isFile() || st.isSymbolicLink()) return;
    const destRel = `evidence/harness/${relFromHarness.split(path.sep).join('/')}`;
    const dest = path.join(out, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o600);
    persisted.push(destRel);
  };

  for (const entry of fs.readdirSync(harnessDir, { withFileTypes: true })) {
    if (entry.isFile() && !entry.isSymbolicLink() && isAllowedHarnessTopFile(entry.name)) {
      copyRel(entry.name);
    }
  }

  for (const subdir of ['identities', 'assignments']) {
    const subPath = path.join(harnessDir, subdir);
    if (!fs.existsSync(subPath) || !fs.lstatSync(subPath).isDirectory()) continue;
    for (const entry of fs.readdirSync(subPath, { withFileTypes: true })) {
      if (entry.isFile() && !entry.isSymbolicLink() && SAFE_JSON_FILE.test(entry.name)) {
        copyRel(path.join(subdir, entry.name));
      }
    }
  }

  const usageRoot = path.join(harnessDir, 'usage');
  if (fs.existsSync(usageRoot) && fs.lstatSync(usageRoot).isDirectory()) {
    for (const revEntry of fs.readdirSync(usageRoot, { withFileTypes: true })) {
      if (!revEntry.isDirectory() || revEntry.isSymbolicLink() || !/^[a-z0-9][a-z0-9-]*$/.test(revEntry.name)) continue;
      const revDir = path.join(usageRoot, revEntry.name);
      for (const fileEntry of fs.readdirSync(revDir, { withFileTypes: true })) {
        if (fileEntry.isFile() && !fileEntry.isSymbolicLink() && SAFE_JSON_FILE.test(fileEntry.name)) {
          copyRel(path.join('usage', revEntry.name, fileEntry.name));
        }
      }
    }
  }

  persisted.sort();
  const existingIndex = readJsonOr(out, 'evidence/index.json', null);
  if (existingIndex && Array.isArray(existingIndex.files)) {
    const mergedFiles = [...new Set([...existingIndex.files, ...persisted])];
    if (mergedFiles.length !== existingIndex.files.length) {
      writeJson(out, 'evidence/index.json', { ...existingIndex, files: mergedFiles });
    }
  }
  return persisted;
}

export function restoreHarnessEvidence(reportDir, meta = null) {
  const harnessDir = path.join(reportDir, 'harness');
  fs.mkdirSync(harnessDir, { recursive: true, mode: 0o700 });

  const evHarnessDir = path.join(reportDir, 'evidence', 'harness');
  if (fs.existsSync(evHarnessDir) && fs.lstatSync(evHarnessDir).isDirectory()) {
    const walkRestore = (fromDir, relDir = '') => {
      for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const childRel = relDir ? path.join(relDir, entry.name) : entry.name;
        const src = path.join(fromDir, entry.name);
        if (entry.isDirectory()) {
          walkRestore(src, childRel);
        } else if (entry.isFile()) {
          const dst = path.join(harnessDir, childRel);
          if (!fs.existsSync(dst)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
            fs.copyFileSync(src, dst);
            fs.chmodSync(dst, 0o600);
          }
        }
      }
    };
    walkRestore(evHarnessDir);
  }

  const snap = readJsonOr(reportDir, 'evidence/harness-snapshot.json', null);
  if (!fs.existsSync(path.join(harnessDir, 'reviewers.json'))) {
    if (snap?.reviewers) {
      writeJson(reportDir, 'harness/reviewers.json', snap.reviewers);
    } else if (Array.isArray(meta?.reviewers)) {
      writeJson(reportDir, 'harness/reviewers.json', {
        version: 1,
        reviewers: meta.reviewers,
        judges: [],
        orchestrator: meta.orchestrator || null,
        alternateJudge: null,
        assign: meta.assign || 'matrix',
        budgets: meta.budgets || null,
      });
    }
  }
  if (!fs.existsSync(path.join(harnessDir, 'source-read-digest.json'))) {
    if (snap?.sourceReadDigest) {
      writeJson(reportDir, 'harness/source-read-digest.json', snap.sourceReadDigest);
    } else {
      const manifest = readJsonOr(reportDir, 'source-manifest.json', null);
      if (manifest?.digest && Array.isArray(manifest.files)) {
        writeJson(reportDir, 'harness/source-read-digest.json', {
          version: 1,
          source: '/src',
          digest: manifest.digest,
          files: manifest.files,
          at: new Date().toISOString(),
        });
      }
    }
  }
  if (snap?.verificationHealth && !fs.existsSync(path.join(harnessDir, 'verification-health.json'))) {
    writeJson(reportDir, 'harness/verification-health.json', snap.verificationHealth);
  }
  if (snap?.budgetHealth && !fs.existsSync(path.join(harnessDir, 'budget-health.json'))) {
    writeJson(reportDir, 'harness/budget-health.json', snap.budgetHealth);
  }
}

export function storeStage1Evidence(out, sourceRoot = null, maxClusters = DEFAULTS.debate.maxClusters) {
  const { claims, controls, reviewers } = loadClaims(out);
  const manifest = readJsonOr(out, 'source-manifest.json', null);
  const resolvedRoot = sourceRoot && fs.existsSync(sourceRoot) ? sourceRoot : null;
  let built = { clusters: [], coverageGaps: [] };
  if (resolvedRoot) {
    try {
      const reader = sourceReader(resolvedRoot, manifest);
      built = buildClusters(claims, { reader, maxClusters });
    } catch {
      built = { clusters: [], coverageGaps: [] };
    }
  }
  const controlsObj = Object.fromEntries([...controls.entries()]);
  const files = ['evidence/index.json', 'evidence/claims.json', 'evidence/clusters.json', 'evidence/controls.json'];
  writeJson(out, 'evidence/claims.json', claims);
  writeJson(out, 'evidence/clusters.json', built);
  writeJson(out, 'evidence/controls.json', controlsObj);
  const harnessSnapshot = {
    version: 1,
    reviewers: readJsonOr(out, 'harness/reviewers.json', null),
    sourceReadDigest: readJsonOr(out, 'harness/source-read-digest.json', null),
    verificationHealth: readJsonOr(out, 'harness/verification-health.json', null),
    budgetHealth: readJsonOr(out, 'harness/budget-health.json', null),
  };
  if (harnessSnapshot.reviewers || harnessSnapshot.sourceReadDigest) {
    writeJson(out, 'evidence/harness-snapshot.json', harnessSnapshot);
    files.push('evidence/harness-snapshot.json');
  }
  const persistedHarness = persistHarnessEvidence(out);
  for (const rel of persistedHarness) {
    if (!files.includes(rel)) files.push(rel);
  }
  const index = {
    version: 1,
    storedAt: new Date().toISOString(),
    sourceDigest: manifest?.digest || null,
    claimsCount: claims.length,
    clustersCount: built.clusters.length,
    queuedClustersCount: built.clusters.filter((c) => c.status === 'QUEUED').length,
    agreedClustersCount: built.clusters.filter((c) => c.status === 'AGREED').length,
    controlsCount: Object.values(controlsObj).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0),
    files,
  };
  writeJson(out, 'evidence/index.json', index);
  return { claims, controls, reviewers, built, index };
}

function renderIncompletionSectionMd(notes) {
  if (!Array.isArray(notes) || !notes.length) return [];
  const lines = ['', '## Why This Audit Is Incomplete & Security Impact', ''];
  for (const n of notes) {
    lines.push(`- **[${n.category}] \`${n.source}\` (\`${n.code}\`)**`);
    lines.push(`  - **Reason**: ${n.reason}`);
    lines.push(`  - **Impact**: ${n.impact}`);
    if (n.nextStep) lines.push(`  - **Next step**: ${n.nextStep}`);
  }
  return lines;
}

function renderIncompletionSectionHtml(notes) {
  if (!Array.isArray(notes) || !notes.length) return '';
  return `<div class="card card-warn">
    <h2>Why This Audit Is Incomplete &amp; Security Impact (${notes.length})</h2>
    <ul>
      ${notes.map((n) => `<li>
        <strong>[${escapeHtml(n.category)}] <code>${escapeHtml(n.source)}</code></strong> — ${escapeHtml(n.reason)}<br>
        <span class="impact"><strong>Impact:</strong> ${escapeHtml(n.impact)}</span>
        ${n.nextStep ? `<br><span class="muted"><strong>Next step:</strong> ${escapeHtml(n.nextStep)}</span>` : ''}
      </li>`).join('')}
    </ul>
  </div>`;
}

function renderAdviceSectionHtml(advice) {
  if (!advice) return '';
  const d = advice.debateAdvice;
  const q = advice.quality;
  return `<div class="card card-advice">
    <div class="badges">
      <span class="pill">ORCHESTRATOR ADVICE</span>
      <span class="pill">Quality: ${escapeHtml(q.rating.toUpperCase())}</span>
      <span class="pill" style="background:${d.debateNeeded ? '#b45309' : '#15803d'}">${d.debateNeeded ? `Debate Recommended: ${escapeHtml(d.recommendedDepth.toUpperCase())} (${d.recommendedRounds} round${d.recommendedRounds === 1 ? '' : 's'})` : 'Debate Not Needed (0 rounds)'}</span>
    </div>
    <h2>Step 2 — Frontier Quality &amp; Debate Advice</h2>
    <p>${escapeHtml(q.summary)}</p>
    <p><strong>Debate guidance:</strong> ${escapeHtml(d.rationale)}</p>
    ${d.focusClusterIds?.length ? `<p><strong>Focus clusters:</strong> ${d.focusClusterIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}</p>` : ''}
    ${q.coverageGaps?.length ? `<p><strong>Gaps flagged:</strong> ${q.coverageGaps.map(escapeHtml).join(' · ')}</p>` : ''}
    ${q.issues?.length ? `<p><strong>Issues flagged:</strong> ${q.issues.map(escapeHtml).join(' · ')}</p>` : ''}
    <p><a href="audit_stage_2_advice.html">Open full Step 2 Orchestrator Advice artifact &rarr;</a></p>
  </div>`;
}

export function writeStage1Artifacts(first, second = {}) {
  const opts = typeof first === 'string' ? second : (first || {});
  const out = typeof first === 'string' ? first : opts.out;
  if (!out || typeof out !== 'string') throw new Error('writeStage1Artifacts requires report directory `out`');
  const advice = opts.advice?.quality ? opts.advice : (opts.advice?.advice?.quality ? opts.advice.advice : null);
  const incompletionNotes = opts.incompletionNotes || null;
  const meta = opts.meta || readJsonOr(out, 'meta.json', {}) || {};
  const health = opts.health || readJsonOr(out, 'report-health.json', {}) || {};
  const findings = opts.findings || readJsonOr(out, 'findings-and-scores.json', []) || [];
  const evidenceIndex = opts.evidence?.index || opts.evidence || readJsonOr(out, 'evidence/index.json', null);
  const resolvedAdvice = advice || readJsonOr(out, 'orchestrator-advice.json', null);
  const notes = incompletionNotes || health.incompletionNotes || buildIncompletionNotes(out, { meta, health });

  const doc = {
    stage: 'stage-1-no-debates',
    noDebates: true,
    pipelineMode: meta.pipelineMode || 'step-by-step',
    generatedAt: new Date().toISOString(),
    target: { name: meta.name || 'target', source: meta.source || null, commit: meta.commit || null },
    health: {
      state: health.state || 'validated_outputs',
      reviewState: health.reviewState || 'validated_outputs',
      errors: health.errors || [],
    },
    evidence: evidenceIndex || { dir: 'evidence', files: [] },
    orchestratorAdvice: resolvedAdvice
      ? {
        qualityRating: resolvedAdvice.quality.rating,
        summary: resolvedAdvice.quality.summary,
        coverageGaps: resolvedAdvice.quality.coverageGaps,
        issues: resolvedAdvice.quality.issues,
        debateNeeded: resolvedAdvice.debateAdvice.debateNeeded,
        recommendedDepth: resolvedAdvice.debateAdvice.recommendedDepth,
        recommendedRounds: resolvedAdvice.debateAdvice.recommendedRounds,
        focusClusterIds: resolvedAdvice.debateAdvice.focusClusterIds,
        rationale: resolvedAdvice.debateAdvice.rationale,
        nextSteps: resolvedAdvice.nextSteps,
      }
      : null,
    incompletionNotes: notes,
    findingsCount: findings.length,
    findings,
    disclaimer: DISCLAIMER,
  };
  writeJson(out, 'audit_stage_1.json', doc);

  const mdLines = [
    '# Audit Report — Stage 1 (No Debates)',
    '',
    '> **STAGE 1 (NO DEBATES)**: Multi-agent surface passes and evidence collection are complete. Adversarial cross-examination rounds have not been run on this snapshot.',
    '',
    `- **Target**: \`${doc.target.name}\``,
    `- **Health**: \`${doc.health.state.toUpperCase()}\``,
    `- **Clustered Stage 1 Findings**: ${findings.length}`,
    `- **Stored Evidence**: \`evidence/\` (${evidenceIndex?.claimsCount ?? 0} raw claims, ${evidenceIndex?.clustersCount ?? findings.length} clusters)`,
  ];
  if (doc.orchestratorAdvice) {
    const a = doc.orchestratorAdvice;
    mdLines.push(
      '',
      '## Orchestrator Quality & Debate Advice (Step 2)',
      '',
      `- **Quality Rating**: \`${a.qualityRating.toUpperCase()}\``,
      `- **Debates Needed?**: **${a.debateNeeded ? 'YES' : 'NO'}** (\`${a.recommendedDepth}\`, ${a.recommendedRounds} round(s))`,
      `- **Summary**: ${a.summary}`,
      `- **Debate Rationale**: ${a.rationale}`,
      ...(a.focusClusterIds.length ? [`- **Priority Clusters**: ${a.focusClusterIds.join(', ')}`] : []),
      ...a.nextSteps.map((s) => `- **Next Step**: ${s}`),
    );
  }
  mdLines.push(...renderIncompletionSectionMd(notes));
  mdLines.push('', '## Stage 1 Findings (Pre-Debate)', '');
  if (!findings.length) {
    mdLines.push('- No findings reported in Stage 1.');
  } else {
    for (const f of findings) {
      mdLines.push(`- **${f.clusterId}** [${(f.severity || 'info').toUpperCase()}] \`${f.status}\` — ${f.title} (${(f.locations || []).join(', ')})`);
    }
  }
  mdLines.push('', DISCLAIMER, '');
  writeText(out, 'audit_stage_1.md', mdLines.join('\n'));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stage 1 Audit Report (No Debates) — ${escapeHtml(doc.target.name)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1020px; margin: 2rem auto; padding: 0 1.25rem; color: #111827; background: #f9fafb; line-height: 1.55; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .card-warn { border-color: #f59e0b; background: #fffbeb; }
  .card-advice { border-color: #3b82f6; background: #eff6ff; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .pill { display: inline-block; padding: 0.22rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: #fff; background: #374151; }
  .pill-stage1 { background: #1d4ed8; }
  .pill-incomplete { background: #b91c1c; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  h2 { font-size: 1.15rem; margin: 0 0 0.6rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { text-align: left; padding: 0.55rem 0.65rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  nav { margin-bottom: 1rem; font-size: 0.9rem; }
  nav a { margin-right: 1rem; color: #2563eb; text-decoration: none; }
  .muted { color: #6b7280; font-size: 0.88rem; }
  .impact { color: #92400e; }
</style>
</head>
<body>
  <nav>
    <a href="report.html">Main Audit Report</a>
    ${resolvedAdvice ? '<a href="audit_stage_2_advice.html">Step 2 Orchestrator Advice</a>' : ''}
    <a href="pipeline-progress.json">Pipeline Progress JSON</a>
    <a href="evidence/index.json">Stored Evidence Index</a>
  </nav>
  <div class="card">
    <div class="badges">
      <span class="pill pill-stage1">STAGE 1 — NO DEBATES</span>
      <span class="pill ${doc.health.state === 'incomplete' ? 'pill-incomplete' : ''}">Health: ${escapeHtml(doc.health.state.toUpperCase())}</span>
      <span class="pill">Findings: ${findings.length}</span>
    </div>
    <h1>${escapeHtml(doc.target.name)} — Stage 1 Multi-Agent Pass</h1>
    <p>Initial multi-agent review without adversarial debates. All raw claims, clustered citations, and verified control assertions are stored under <code>evidence/</code> so optional debate rounds can run iteratively at any time.</p>
  </div>
  ${renderAdviceSectionHtml(resolvedAdvice)}
  ${renderIncompletionSectionHtml(notes)}
  <div class="card">
    <h2>Stage 1 Clustered Findings (${findings.length})</h2>
    ${findings.length === 0 ? '<p>No findings reported in Stage 1.</p>' : `<table>
      <thead><tr><th>Cluster</th><th>Severity</th><th>Stage 1 Status</th><th>Vendors</th><th>Title &amp; Location</th></tr></thead>
      <tbody>
        ${findings.map((f) => `<tr>
          <td><code>${escapeHtml(f.clusterId)}</code></td>
          <td><strong>${escapeHtml(String(f.severity || '').toUpperCase())}</strong></td>
          <td><code>${escapeHtml(f.status)}</code></td>
          <td>${escapeHtml((f.vendors || []).join(', '))}</td>
          <td>${escapeHtml(f.title)}<br><span class="muted">${escapeHtml((f.locations || []).join(', '))}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>
  <p class="muted">${escapeHtml(DISCLAIMER)}</p>
</body>
</html>
`;
  writeText(out, 'audit_stage_1.html', html);
  return ['audit_stage_1.json', 'audit_stage_1.md', 'audit_stage_1.html'];
}

export function saveDebateState(out, state, roundsCompleted) {
  const serializedDebated = {};
  if (state.debated instanceof Map) {
    for (const [clusterId, val] of state.debated.entries()) {
      serializedDebated[clusterId] = val;
    }
  } else if (state.debated && typeof state.debated === 'object') {
    Object.assign(serializedDebated, state.debated);
  }
  writeJson(out, 'evidence/debate-state.json', {
    version: 1,
    roundsCompleted,
    savedAt: new Date().toISOString(),
    debated: serializedDebated,
    anonymization: state.anonymization || { seed: 1, clusters: {} },
    citations: state.citations || [],
    trace: state.trace || [],
    gaps: state.gaps || [],
    advisory: state.advisory || [],
    clusters: state.clusters || [],
    coverageGaps: state.coverageGaps || [],
  });
}

export function loadDebateState(out) {
  const saved = readJsonOr(out, 'evidence/debate-state.json', null);
  if (!saved || typeof saved !== 'object') return null;
  return saved;
}

export function archiveJudgeInboxForNextRound(out, prevRound) {
  const inboxDir = path.join(out, 'debate', 'inbox');
  const archiveDir = path.join(out, 'evidence', `archive-round-${prevRound}`);
  if (fs.existsSync(inboxDir)) {
    for (const name of fs.readdirSync(inboxDir)) {
      if (/-judge-cluster-|-general-review\.json$/.test(name)) {
        fs.mkdirSync(path.join(archiveDir, 'inbox'), { recursive: true });
        fs.renameSync(path.join(inboxDir, name), path.join(archiveDir, 'inbox', name));
      }
    }
  }
  const sessionsDir = path.join(out, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const sessionArchiveDir = path.join(sessionsDir, `_archive-round-${prevRound}`);
    for (const name of fs.readdirSync(sessionsDir)) {
      if (/-judge-cluster-|-general-review$/.test(name)) {
        fs.mkdirSync(sessionArchiveDir, { recursive: true, mode: 0o700 });
        const dest = path.join(sessionArchiveDir, name);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(path.join(sessionsDir, name), dest);
      }
    }
  }
}

export function writeDebateRoundArtifacts(first, second, third = {}) {
  const isObj = typeof first === 'object' && first !== null;
  const opts = isObj ? first : third;
  const out = isObj ? opts.out : first;
  const roundNumber = isObj ? (opts.round ?? opts.roundNumber) : second;
  if (!out || typeof out !== 'string') throw new Error('writeDebateRoundArtifacts requires report directory `out`');
  const state = opts.state || loadDebateState(out);
  const rows = opts.rows || opts.adjudication || readJsonOr(out, 'debate/adjudication.json', []) || [];
  const meta = opts.meta || readJsonOr(out, 'meta.json', {}) || {};
  const health = opts.health || readJsonOr(out, 'report-health.json', {}) || {};
  const incompletionNotes = opts.incompletionNotes || health.incompletionNotes || buildIncompletionNotes(out, { meta, health });
  const allTurns = [];
  const entries = state?.debated instanceof Map ? [...state.debated.values()] : Object.values(state?.debated || {});
  for (const item of entries) {
    for (const t of item?.turns || []) {
      if (t.round === roundNumber) allTurns.push(t);
    }
  }
  const unansweredTurns = (state?.gaps || []).filter((g) => g.round === roundNumber).length;
  const statusCounts = {};
  for (const r of rows) {
    statusCounts[r.finalStatus] = (statusCounts[r.finalStatus] || 0) + 1;
  }
  const disputedCount = rows.filter((r) => r.finalStatus === 'DISPUTED').length;
  const completedAt = new Date().toISOString();

  const roundSummary = {
    round: roundNumber,
    completedAt,
    turnsCount: allTurns.length,
    unansweredTurns,
    statusCounts,
    disputedCount,
    turns: allTurns.map((t) => ({
      clusterId: t.clusterId,
      anonId: t.anonId,
      role: t.role,
      verdict: t.verdict,
      discarded: Boolean(t.discarded),
      conformitySuspect: Boolean(t.conformitySuspect),
    })),
    adjudication: rows,
    incompletionNotes,
    disclaimer: DISCLAIMER,
  };

  writeJson(out, `debate/rounds/round-${roundNumber}.json`, roundSummary);
  writeJson(out, `audit_round_${roundNumber}.json`, roundSummary);

  const md = [
    `# Audit Debate Results — Round ${roundNumber}`,
    '',
    `- **Completed At**: ${completedAt}`,
    `- **Turns Spoken in Round ${roundNumber}**: ${allTurns.length}`,
    `- **Unanswered Turns in Round ${roundNumber}**: ${unansweredTurns}`,
    `- **Current Status Breakdown**: ${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`,
    ...renderIncompletionSectionMd(incompletionNotes),
    '',
    '## Cluster Verdicts After This Round',
    '',
    ...(rows.length
      ? rows.map((r) => `- **${r.clusterId}** [${r.severity.toUpperCase()}] -> **${r.finalStatus}** (judge: \`${r.judge?.reviewerId || 'rules'}\`): ${r.rationale}`)
      : ['- No clusters adjudicated.']),
    '',
    DISCLAIMER,
    '',
  ].join('\n');
  writeText(out, `audit_round_${roundNumber}.md`, md);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Debate Round ${roundNumber} Results</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 1020px; margin: 2rem auto; padding: 0 1.25rem; color: #111827; background: #f9fafb; line-height: 1.55; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .card-warn { border-color: #f59e0b; background: #fffbeb; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .pill { display: inline-block; padding: 0.22rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: #fff; background: #374151; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { text-align: left; padding: 0.55rem 0.65rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  nav { margin-bottom: 1rem; font-size: 0.9rem; }
  nav a { margin-right: 1rem; color: #2563eb; text-decoration: none; }
  .muted { color: #6b7280; font-size: 0.88rem; }
  .impact { color: #92400e; }
</style>
</head>
<body>
  <nav>
    <a href="report.html">Main Audit Report</a>
    <a href="audit_stage_1.html">Stage 1 Report (No Debates)</a>
    <a href="audit_stage_2_advice.html">Step 2 Orchestrator Advice</a>
    <a href="pipeline-progress.json">Pipeline Progress JSON</a>
  </nav>
  <div class="card">
    <div class="badges">
      <span class="pill" style="background:#7c3aed">STEP 3 — DEBATE ROUND ${roundNumber}</span>
      <span class="pill">Turns in Round: ${allTurns.length}</span>
      <span class="pill">Disputed Remaining: ${disputedCount}</span>
    </div>
    <h1>Debate Round ${roundNumber} Snapshot</h1>
    <p>Status breakdown after Round ${roundNumber}: ${escapeHtml(Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none')}.</p>
  </div>
  ${renderIncompletionSectionHtml(incompletionNotes)}
  <div class="card">
    <h2>Adjudication After Round ${roundNumber}</h2>
    ${rows.length === 0 ? '<p>No clusters adjudicated.</p>' : `<table>
      <thead><tr><th>Cluster</th><th>Severity</th><th>Status</th><th>Judge</th><th>Rationale</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td><code>${escapeHtml(r.clusterId)}</code></td>
          <td><strong>${escapeHtml(r.severity.toUpperCase())}</strong></td>
          <td><code>${escapeHtml(r.finalStatus)}</code></td>
          <td><code>${escapeHtml(r.judge?.reviewerId || 'rules')}</code></td>
          <td>${escapeHtml(r.rationale)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>
  <p class="muted">${escapeHtml(DISCLAIMER)}</p>
</body>
</html>
`;
  writeText(out, `audit_round_${roundNumber}.html`, html);

  const artifacts = [`debate/rounds/round-${roundNumber}.json`, `audit_round_${roundNumber}.json`, `audit_round_${roundNumber}.md`, `audit_round_${roundNumber}.html`];
  return {
    round: roundNumber,
    turnsCount: allTurns.length,
    unansweredTurns,
    disputedCount,
    artifacts,
    completedAt,
  };
}

export function syncPipelineProgress(first, second = {}) {
  const opts = typeof first === 'string' ? second : (first || {});
  const out = typeof first === 'string' ? first : opts.out;
  if (!out || typeof out !== 'string') throw new Error('syncPipelineProgress requires report directory `out`');
  const { pipelineMode = null, currentStage = null, roundEntry = null } = opts;
  const existing = readJsonOr(out, 'pipeline-progress.json', null);
  const meta = readJsonOr(out, 'meta.json', {}) || {};
  const health = readJsonOr(out, 'report-health.json', {}) || {};
  const evidenceIndex = readJsonOr(out, 'evidence/index.json', null);
  const stage1Doc = readJsonOr(out, 'audit_stage_1.json', null);
  const adviceDoc = readJsonOr(out, 'orchestrator-advice.json', null);
  const clustersFile = readJsonOr(out, 'debate/clusters.json', null) || readJsonOr(out, 'evidence/clusters.json', null);
  const adjudication = readJsonOr(out, 'debate/adjudication.json', null);
  const findings = readJsonOr(out, 'findings-and-scores.json', []) || [];

  const mode = pipelineMode || existing?.pipelineMode || meta.pipelineMode || 'full';
  const prevRounds = Array.isArray(existing?.debate?.rounds) ? [...existing.debate.rounds] : [];
  if (roundEntry) {
    const idx = prevRounds.findIndex((r) => r.round === roundEntry.round);
    if (idx >= 0) prevRounds[idx] = roundEntry;
    else prevRounds.push(roundEntry);
    prevRounds.sort((a, b) => a.round - b.round);
  }
  const roundsCompleted = prevRounds.length > 0 ? prevRounds[prevRounds.length - 1].round : (existing?.debate?.roundsCompleted || 0);

  const completedSteps = [];
  if (stage1Doc || fs.existsSync(path.join(out, 'findings-and-scores.json'))) completedSteps.push('stage-1');
  if (adviceDoc) completedSteps.push('stage-2-advice');
  if (roundsCompleted > 0 || (Array.isArray(adjudication) && meta.debatesCompleted === true)) completedSteps.push('stage-3-debate');

  const clusters = Array.isArray(clustersFile?.clusters) ? clustersFile.clusters : [];
  const queuedClusters = clusters.filter((c) => c.status === 'QUEUED').length;
  const unresolvedClusters = Array.isArray(adjudication)
    ? adjudication.filter((r) => r.finalStatus === 'DISPUTED' || r.finalStatus === 'INSUFFICIENT_EVIDENCE').length
    : queuedClusters;

  const reviewerCount = Array.isArray(meta.agents) ? meta.agents.length : 0;
  const converged = roundsCompleted > 0 && (queuedClusters === 0 || (unresolvedClusters === 0 && (roundEntry ? roundEntry.turnsCount === 0 : false)));
  const canRunMoreRounds = reviewerCount >= 2 && queuedClusters > 0 && roundsCompleted < 20 && !converged;

  const resolvedStage = currentStage
    || (completedSteps.includes('stage-3-debate') && !canRunMoreRounds ? 'completed' : null)
    || (completedSteps.includes('stage-3-debate') ? 'stage-3-debate' : null)
    || (completedSteps.includes('stage-2-advice') ? 'stage-2-advice' : 'stage-1');

  const notes = Array.isArray(health.incompletionNotes)
    ? health.incompletionNotes
    : buildIncompletionNotes(out, { meta, health });

  const progress = {
    version: 1,
    pipelineMode: ['full', 'step-by-step', 'stage-1'].includes(mode) ? mode : 'full',
    currentStage: resolvedStage,
    completedSteps,
    evidence: {
      stored: Boolean(evidenceIndex),
      dir: 'evidence',
      claimsCount: evidenceIndex?.claimsCount ?? 0,
      clustersCount: evidenceIndex?.clustersCount ?? clusters.length,
      files: evidenceIndex?.files || [],
    },
    stage1: {
      completed: completedSteps.includes('stage-1'),
      noDebates: roundsCompleted === 0 && meta.debatesCompleted !== true,
      artifacts: stage1Doc ? ['audit_stage_1.json', 'audit_stage_1.md', 'audit_stage_1.html'] : [],
      findingsCount: stage1Doc?.findingsCount ?? findings.length,
    },
    advice: adviceDoc
      ? {
        debateNeeded: adviceDoc.debateAdvice.debateNeeded,
        recommendedDepth: adviceDoc.debateAdvice.recommendedDepth,
        recommendedRounds: adviceDoc.debateAdvice.recommendedRounds,
        qualityRating: adviceDoc.quality.rating,
        artifacts: ['orchestrator-advice.json', 'orchestrator-advice.md', 'audit_stage_2_advice.html'],
      }
      : null,
    debate: {
      optional: true,
      roundsCompleted,
      queuedClusters,
      unresolvedClusters,
      converged,
      canRunMoreRounds,
      rounds: prevRounds,
    },
    incompletionNotes: notes.map(({ category, code, source, reason, impact, ...rest }) => ({
      category, code, source, reason, impact, ...(rest.nextStep ? { nextStep: rest.nextStep } : {}),
    })),
    updatedAt: new Date().toISOString(),
  };

  const check = validate('pipeline-progress', progress);
  if (!check.ok) throw new Error(`pipeline-progress failed schema validation: ${check.errors.join('; ')}`);
  writeJson(out, 'pipeline-progress.json', progress);
  return progress;
}
