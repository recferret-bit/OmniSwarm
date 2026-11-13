// The "Evidence & scope" panels: review status and limits, isolation policy, sandbox records, per-stack coverage,
// control assertions and attached diagram source. Shared by report.html and the pre-v2 findings-by-model.html.
import { disclosure, esc, prose } from './report-cards.mjs';
import { suiteLabel, testsHeadline, testsHtml, toolsHeadline, toolsHtml } from './report-tests.mjs';

export const incompleteLabelOf = (ctx) => (ctx.reviewComplete ? 'INCOMPLETE REPORT' : 'INCOMPLETE REVIEW');

function incompletionDetails(health, complete) {
  const notes = Array.isArray(health?.incompletionNotes) ? health.incompletionNotes : [];
  if (complete || !notes.length) return '';
  return `<div class="incompletion-notes"><h4>Why this audit is incomplete &amp; security impact</h4><ul class="validation-errors">${notes.map((n) => `<li><strong>[${esc(n.category)}${n.source ? ` · ${esc(n.source)}` : ''}]</strong> ${esc(n.reason)}<br><small><strong>Impact:</strong> ${esc(n.impact)}${n.nextStep ? ` · <strong>Next:</strong> ${esc(n.nextStep)}` : ''}</small></li>`).join('')}</ul></div>`;
}

export function validationDetails(ctx, modelRows) {
  const { complete, health, sourceLine, meta } = ctx;
  const requested = modelRows.map((row) => `<tr><td><strong>${esc(row.key)}</strong></td><td>${esc(row.label)}</td><td>${row.available ? 'Valid outputs available' : 'no valid outputs'}</td></tr>`).join('');
  return `<p class="note"><strong>${complete ? 'OUTPUTS VALIDATED — NOT A CLEAN-AUDIT CERTIFICATE' : incompleteLabelOf(ctx)}</strong>. These are unverified model assertions. No authenticated execution evidence or served-model/provider attestation was collected. Zero findings is not proof of safety.</p>
  ${(health.errors || []).length ? `<ul class="validation-errors">${health.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : ''}${incompletionDetails(health, complete)}
  <p class="note">Agreement means matching titles and citations across asserted adapters. First-pass independence and served-provider identity are not enforced. Peer verdicts are model statements; priority scores are heuristic.</p>
  <div class="table-scroll"><table><caption class="meta-label">Requested models · served identity unverified</caption><thead><tr><th>Adapter</th><th>Requested model</th><th>Output</th></tr></thead><tbody>${requested}</tbody></table></div>
  ${sourceLine ? `<p class="note">Captured source: <code>${esc(sourceLine)}</code></p>` : ''}
  ${meta.isolation?.sourceDigest ? `<p class="note">Snapshot SHA-256: <code>${esc(meta.isolation.sourceDigest)}</code></p>` : ''}`;
}

export function isolationDetails({ meta, workerJobs }) {
  if (meta.isolation?.policy === 'read_only_source_review') {
    return `<h3>Read-only worker isolation policy</h3><p class="note">Live transport is blocked: subscription delegation and tools-disabled transport are not verified. No host reviewer fallback, model call, lead scanner or target build was started. These are parent-recorded blocked jobs, not successful reviews.</p>${workerJobs.map((j) => `<p class="note">${esc(j.name)} · ${esc(j.state)} · ${esc(j.reason || '')}</p>`).join('')}`;
  }
  if (meta.isolation?.policy === 'report_finalization') {
    return `<h3>Saved review finalization</h3><p class="note">No new Docker container, build, test, scanner or source inspection ran during finalization. Coverage was copied from <code>${esc(meta.recovery?.fromReport || 'the prior review')}</code> for the same source digest; untested coverage is not a pass.</p>`;
  }
  return '';
}

function sandboxDetails({ sandboxRows }) {
  if (!sandboxRows.length) return '<p class="note">Sandbox coverage unavailable or invalid — not a pass.</p>';
  const n = (result) => sandboxRows.filter((r) => r.result === result).length;
  const label = (r) => (r.result === 'impossible' ? 'Not started' : r.result === 'ran' ? 'Finished' : 'Failed');
  return `<p class="note">${n('ran')} finished · ${n('failed')} failed · ${n('impossible')} not started. Sandbox-reported records are not authenticated execution evidence. Finished does not mean passed; failed or not started is not a pass.</p><div class="table-scroll"><table><thead><tr><th>Check</th><th>Observed status</th><th>Coverage & limits</th></tr></thead><tbody>${sandboxRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="result-${r.result}">${label(r)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table></div>`;
}

function stackRows(eco, suiteRows, gapRows) {
  const near = eco.near;
  const evm = eco.evm;
  return [
    ['Python', eco.python.detected, `${eco.python.sourceFiles} production files; ${eco.python.frameworks.join(', ') || 'no framework recognised'}${eco.python.declaredVersion ? `; declared Python ${eco.python.declaredVersion.version}` : ''}`, suiteRows(['pytest']), gapRows(/python-deps|osv-scanner|semgrep|pytest/)],
    ['Node / TypeScript', eco.node.detected, `${eco.node.sourceFiles} production files; ${eco.node.frameworks.join(', ') || 'no framework recognised'}`, suiteRows(['npm']), gapRows(/npm-audit|node-deps|npm existing/)],
    ['Solana program', eco.solana.detected, eco.solana.marks.join(', ') || 'none', suiteRows(['cargo']), [...gapRows(/cargo-audit|cargo existing/), 'Reproducible build and deployed-bytes comparison are outside this review by policy.']],
    ['NEAR', Boolean(near?.detected), !near?.detected ? 'absent' : `${near.contracts ? 'near-sdk contract' : 'no near-sdk crate'}; kinds ${(near.kinds || []).join(', ') || 'none'}; ${(near.marks || []).join(', ') || 'no manifest mark'}`, !near?.detected ? [] : near.contracts ? ['cargo test not run: local near-sandbox or testnet', ...suiteRows(['near-build', 'near-clippy'])] : suiteRows(['npm']), !near?.detected ? [] : [...gapRows(/NEAR|near-sandbox|cargo existing/), 'near-sandbox, cargo near reproducible-wasm, mainnet v1.signer reads, and deployed code-hash comparison are outside this offline review.']],
    ['EVM', Boolean(evm?.detected), !evm?.detected ? 'absent' : `${evm.contracts ? `${evm.sourceFiles} contract file(s)` : 'no contract source'}; kinds ${(evm.kinds || []).join(', ') || 'none'}; tooling ${(evm.tooling || []).join(', ') || 'none'}`, !evm?.detected ? [] : evm.contracts ? ['contract tests not run: no forge, hardhat or solc in the sandbox'] : suiteRows(['npm']), !evm?.detected ? [] : [...gapRows(/EVM contract tests/), 'Deployed bytecode and on-chain state are outside this review by policy.']],
  ];
}

// Per-ecosystem coverage: what was detected, which existing suites ran, and which scanners were required but incomplete.
function stackCoverage({ profile, catalog, health }) {
  const verification = health.verification || {};
  const suites = new Map((verification.suites || []).map((suite) => [suite.id, suite.state]));
  // A report written before the Tests block has only the strict suite states.
  const recorded = new Map((health.tests?.suites || []).map((suite) => [suite.id, suite]));
  // Open gaps: scanners that failed or did not run, and suites the target has but the sandbox never runs. Like the
  // Tests and Tools blocks, this table informs and does not decide whether the report is complete.
  const gaps = [...(verification.gaps || []), ...(health.tests?.notes || [])];
  const eco = profile?.ecosystems;
  if (!eco) return '<p class="note">Stack profile unavailable or predates ecosystem detection; per-stack coverage cannot be derived.</p>';
  const suiteState = (test) => {
    const suite = recorded.get(test.id);
    if (suite) return `${suiteLabel(suite.state)}${suite.counts ? ` (${suite.counts.passed} passed, ${suite.counts.failed} failed or errored, ${suite.counts.skipped} skipped)` : ''}`;
    return suites.get(test.id) === 'passed' ? 'passed' : suites.get(test.id) === 'failed_or_unverified' ? 'failed or unverified' : 'not run';
  };
  const suiteRows = (kinds) => (catalog.tests || []).filter((test) => kinds.includes(test.kind)).map((test) => `${test.description}: ${suiteState(test)}`);
  const gapRows = (pattern) => gaps.filter((gap) => pattern.test(gap));
  const rows = stackRows(eco, suiteRows, gapRows);
  return `<div class="table-scroll"><table><thead><tr><th>Stack</th><th>Detected</th><th>Existing tests</th><th>Open coverage gaps</th></tr></thead><tbody>${rows.map(([name, detected, detail, tests, open]) => `<tr><td><b>${esc(name)}</b><br><small>${esc(detail)}</small></td><td>${detected ? 'yes' : 'absent'}</td><td>${detected ? (tests.length ? tests.map(esc).join('<br>') : 'no suite catalogued') : '—'}</td><td>${detected ? (open.length ? open.map(esc).join('<br>') : 'none recorded') : '—'}</td></tr>`).join('')}</tbody></table></div><p class="note">Source review of a detected stack is performed by the assigned surfaces S1–S6 (see the surface map); this table shows only tool-reported test and scanner coverage. A failed or missing item is not a pass.</p>`;
}

function controlsDetails({ verifiedSafe }) {
  if (!verifiedSafe.length) return '';
  const item = (s) => `<details class="control"><summary><span>${esc(s.control)}</span><span class="pill ${s.holds === false ? 'red' : 'green'}">${s.holds === false ? 'Reported broken' : 'Reported holding'}</span></summary><div class="prose">${prose(s.evidence || s.how_attacked)}<p class="meta-label">${s.provenance === 'model_assertion' ? '<span class="pill">model assertion</span> ' : ''}${esc(s.auditor)} · unverified</p></div></details>`;
  return `<details class="panel"><summary><span class="pill green">Controls</span>Auditor control assertions<span class="meta-label">${verifiedSafe.length} reported</span></summary><div class="panel-body"><p class="note">Unverified model assertions, not certified controls. Contradiction detection and tiebreak escalation are not implemented.</p><div class="controls-list">${verifiedSafe.map(item).join('')}</div></div></details>`;
}

// The target's own suites, in full. They are shown on every report and never decide whether it is complete.
function testsPanel({ health }) {
  const tests = health.tests;
  if (!tests) return '';
  const tone = tests.state === 'passed' ? 'green' : tests.state === 'failed' ? 'orange' : 'blue';
  return `<details class="panel" id="tests"><summary><span class="pill ${tone}">Tests</span>Tests<span class="meta-label">${esc(testsHeadline(tests))}</span></summary><div class="panel-body">${testsHtml(tests)}</div></details>`;
}

// The audit's own scanners and sandbox record, shown on every report. They never decide whether it is complete.
function toolsPanel({ health }) {
  const tools = health.tools;
  if (!tools) return '';
  return `<details class="panel" id="tools"><summary><span class="pill ${tools.state === 'passed' ? 'green' : 'orange'}">Tools</span>Tools<span class="meta-label">${esc(toolsHeadline(tools))}</span></summary><div class="panel-body">${toolsHtml(tools)}</div></details>`;
}

export function evidencePanels(ctx, modelRows) {
  const { complete, health, sandboxRows, sandboxMd, diagrams } = ctx;
  return `<details class="panel" id="validation"><summary><span class="pill orange">${complete ? 'Validated' : 'Incomplete'}</span>Review status & limitations<span class="meta-label">${health.errors?.length || 0} gaps</span></summary><div class="panel-body">${validationDetails(ctx, modelRows)}${isolationDetails(ctx)}</div></details>
    <details class="panel"><summary><span class="pill blue">Coverage</span>Sandbox & checks<span class="meta-label">${sandboxRows.length} records</span></summary><div class="panel-body">${sandboxDetails(ctx)}${sandboxMd ? disclosure('Original sandbox record', `<pre>${esc(sandboxMd)}</pre>`) : ''}</div></details>
    <details class="panel"><summary><span class="pill blue">Stacks</span>Coverage by stack<span class="meta-label">Python · Node · Solana · NEAR</span></summary><div class="panel-body">${stackCoverage(ctx)}</div></details>
    ${testsPanel(ctx)}
    ${toolsPanel(ctx)}
    ${controlsDetails(ctx)}
    ${diagrams.length ? `<details class="panel"><summary>Attached diagram source<span class="meta-label">${diagrams.length} files</span></summary><div class="panel-body"><p class="note">Attachments are displayed as inert source.</p>${diagrams.map((d) => disclosure(d.title, `<pre>${esc(d.svg)}</pre>`)).join('')}</div></details>` : ''}`;
}
