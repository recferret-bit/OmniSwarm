// The report's Tests and Tools blocks, rendered for the terminal, Markdown and HTML from the `tests` and `tools`
// records of verification-health.mjs: what the run recorded about the target project's own test suites, and about
// the audit's own scanners and sandbox record.
// Both blocks inform; neither decides whether a report is complete. That is the agents' review alone.
// Their strings come from a third-party repository and its tools' output, so control characters are removed for
// the terminal and Markdown, and the HTML is escaped.

const STATE_LABEL = Object.freeze({ passed: 'passed', passed_with_skips: 'passed with skips', failed: 'failed', no_result: 'no result', not_run: 'not run', unverified: 'unverified' });
// Reasons listed per suite in Markdown and HTML. The record keeps more (verification-health.mjs) and the suite's
// full output is in its evidence file; each list says how many there are in all.
const SHOWN = 25;
const listed = (total, shown) => (total > shown ? `${number(total)} in all, the ${shown} most frequent listed` : 'most frequent first');

const plain = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Inline code in Markdown cannot contain a backtick or a line break.
const code = (value) => `\`${plain(value).replaceAll('`', "'")}\``;
const number = (value) => Number(value || 0).toLocaleString('en-US');

export const suiteLabel = (state) => STATE_LABEL[state] || 'unknown';

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const hasBlock = (tests) => Boolean(tests && Array.isArray(tests.suites) && Array.isArray(tests.notes));

// "3 suites: 2 passed, 1 failed. 12,058 tests passed, 466 failed or errored, 500 skipped."
export function testsHeadline(tests) {
  if (!hasBlock(tests)) return 'No test record in this report.';
  const t = tests.totals;
  if (!t.suites) return 'No test suite of the target was catalogued.';
  const parts = [[t.passed, 'passed'], [t.passedWithSkips, 'passed with skips'], [t.failed, 'failed'], [t.notRun, 'not run']].filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
  return `${t.suites} suite${t.suites === 1 ? '' : 's'}: ${parts.join(', ')}. ${number(t.tests.passed)} test${t.tests.passed === 1 ? '' : 's'} passed, ${number(t.tests.failed)} failed or errored, ${number(t.tests.skipped)} skipped.`;
}

const suiteFacts = (suite) => [
  suite.exitCode == null ? null : `exit ${suite.exitCode}`,
  duration(suite.durationMs),
  suite.attempts > 1 ? `${suite.attempts} attempts, the worst is shown` : null,
  suite.dependencies ? `dependencies ${suite.dependencies}` : null,
].filter(Boolean);

// Terminal lines. The full list of causes and failing tests is in the report; the terminal names the commonest.
export function testsText(tests, { causes = 3 } = {}) {
  if (!hasBlock(tests)) return [];
  const lines = ['Tests (the target project\'s own suites; they do not decide whether this report is complete):', `  ${testsHeadline(tests)}`];
  for (const suite of tests.suites) {
    lines.push(`  - ${plain(suite.description)}: ${suiteLabel(suite.state)}. ${plain(suite.result)}`);
    for (const cause of suite.causes.slice(0, causes)) lines.push(`      ${cause.count}x ${plain(cause.message)}`);
    for (const skip of (suite.skipReasons || []).slice(0, causes)) lines.push(`      skipped ${skip.count}x: ${plain(skip.message)}`);
    for (const note of suite.notes) lines.push(`      ${plain(note)}`);
  }
  for (const note of tests.notes) lines.push(`  - ${plain(note)}`);
  return lines;
}

export function testsMarkdown(tests) {
  if (!hasBlock(tests)) return [];
  const lines = ['', '## Tests', '', `> ${plain(tests.policy)}`, '', testsHeadline(tests)];
  if (tests.suites.length) {
    lines.push('', '| Suite | Result | Passed | Failed or errored | Skipped | Exit | Duration |', '|---|---|---|---|---|---|---|');
    for (const suite of tests.suites) {
      const c = suite.counts;
      lines.push(`| ${plain(suite.description).replaceAll('|', '/')} | ${suiteLabel(suite.state)} | ${c ? number(c.passed) : '—'} | ${c ? number(c.failed) : '—'} | ${c ? number(c.skipped) : '—'} | ${suite.exitCode ?? '—'} | ${duration(suite.durationMs) || '—'} |`);
    }
  }
  for (const suite of tests.suites) {
    const detail = suite.state !== 'passed' || suite.notes.length || suite.skipReasons?.length;
    if (!detail) continue;
    lines.push('', `### ${plain(suite.description)}`, '', `- **Result**: ${suiteLabel(suite.state)}. ${plain(suite.result)}`);
    if (suite.evidenceFile) lines.push(`- **Full output**: ${code(suite.evidenceFile)}`);
    for (const note of suite.notes) lines.push(`- ${plain(note)}`);
    const causes = suite.causes.slice(0, SHOWN), skips = (suite.skipReasons || []).slice(0, SHOWN);
    if (causes.length) {
      lines.push(`- **Failure causes** (${listed(suite.causesTotal ?? suite.causes.length, causes.length)}):`);
      for (const cause of causes) lines.push(`  - ${cause.count}x ${code(cause.message)}`);
    }
    if (skips.length) {
      lines.push(`- **Skip reasons** (${listed(suite.skipReasonsTotal ?? skips.length, skips.length)}):`);
      for (const skip of skips) lines.push(`  - ${skip.count}x ${code(skip.message)}`);
    }
    if (suite.outputTail.length) lines.push('- **Last output**:', '', '```text', ...suite.outputTail.map((line) => plain(line).replaceAll('```', "'''")), '```');
    if (suite.failedTests.length) {
      lines.push(`- **Failing tests** (${number(suite.failedTestsTotal)}${suite.failedTestsTotal > suite.failedTests.length ? `, first ${suite.failedTests.length} listed` : ''}):`);
      for (const name of suite.failedTests) lines.push(`  - ${code(name)}`);
    }
  }
  if (tests.notes.length) lines.push('', '### Suites that are not run', '', ...tests.notes.map((note) => `- ${plain(note)}`));
  return lines;
}

function suiteDetailHtml(suite) {
  const parts = [`<p><strong>${esc(suiteLabel(suite.state))}.</strong> ${esc(suite.result)}${suiteFacts(suite).length ? ` <small>(${esc(suiteFacts(suite).join('; '))})</small>` : ''}</p>`];
  if (suite.evidenceFile) parts.push(`<p>Full output: <code>${esc(suite.evidenceFile)}</code></p>`);
  if (suite.notes.length) parts.push(`<ul>${suite.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>`);
  const causes = suite.causes.slice(0, SHOWN), skips = (suite.skipReasons || []).slice(0, SHOWN);
  const reasons = (rows) => `<ul>${rows.map((row) => `<li>${row.count}× <code>${esc(row.message)}</code></li>`).join('')}</ul>`;
  if (causes.length) parts.push(`<p>Failure causes (${esc(listed(suite.causesTotal ?? suite.causes.length, causes.length))}):</p>${reasons(causes)}`);
  if (skips.length) parts.push(`<p>Skip reasons (${esc(listed(suite.skipReasonsTotal ?? skips.length, skips.length))}):</p>${reasons(skips)}`);
  if (suite.outputTail.length) parts.push(`<p>Last output:</p><pre>${esc(suite.outputTail.join('\n'))}</pre>`);
  if (suite.failedTests.length) {
    const shown = suite.failedTestsTotal > suite.failedTests.length ? `, first ${suite.failedTests.length} listed` : '';
    parts.push(`<details><summary>Failing tests (${number(suite.failedTestsTotal)}${shown})</summary><ul>${suite.failedTests.map((name) => `<li><code>${esc(name)}</code></li>`).join('')}</ul></details>`);
  }
  return `<details class="test-suite"${suite.state === 'passed' ? '' : ' open'}><summary>${esc(suite.description)} — ${esc(suiteLabel(suite.state))}</summary>${parts.join('')}</details>`;
}

// One fragment for report.html and the stage pages: the policy line, the totals, one row per suite, then each
// suite's causes, last output and failing tests, then the suites that are never run.
export function testsHtml(tests) {
  if (!hasBlock(tests)) return '<p class="note">This report has no test record.</p>';
  const rows = tests.suites.map((suite) => {
    const c = suite.counts;
    return `<tr><td>${esc(suite.description)}</td><td class="test-${esc(suite.state)}"><strong>${esc(suiteLabel(suite.state))}</strong></td><td>${c ? number(c.passed) : '—'}</td><td>${c ? number(c.failed) : '—'}</td><td>${c ? number(c.skipped) : '—'}</td><td>${suite.exitCode ?? '—'}</td><td>${esc(duration(suite.durationMs) || '—')}</td></tr>`;
  }).join('');
  const table = tests.suites.length ? `<div class="table-scroll"><table><thead><tr><th>Suite</th><th>Result</th><th>Passed</th><th>Failed or errored</th><th>Skipped</th><th>Exit</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  const notRun = tests.notes.length ? `<p class="note"><strong>Suites that are not run</strong></p><ul>${tests.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : '';
  return `<p class="note">${esc(tests.policy)}</p><p><strong>${esc(testsHeadline(tests))}</strong></p>${table}${tests.suites.map(suiteDetailHtml).join('')}${notRun}`;
}

// Tools: the audit's own scanners, one row per required scanner, then any note no row shows (a missing sandbox
// record, scanner output that does not support its recorded status).
const TOOL_LABEL = Object.freeze({ passed: 'passed', findings: 'findings', not_applicable: 'not applicable', failed: 'failed', missing: 'did not run' });
const toolLabel = (state) => TOOL_LABEL[state] || 'unknown';
const hasTools = (tools) => Boolean(tools && Array.isArray(tools.scanners) && Array.isArray(tools.notes));
// "gitleaks: 44 findings", "semgrep: failed. Timed out: …", "cargo-audit: not applicable".
const toolLine = (row) => (row.state === 'findings' && row.findings != null ? `${number(row.findings)} finding${row.findings === 1 ? '' : 's'}` : `${toolLabel(row.state)}${row.detail ? `. ${row.detail}` : ''}`);

// "7 scanners: 4 with findings, 2 passed, 1 failed. 1 note."
export function toolsHeadline(tools) {
  if (!hasTools(tools)) return 'No tool record in this report.';
  const n = (state) => tools.scanners.filter((row) => row.state === state).length;
  const parts = [[n('findings'), 'with findings'], [n('passed'), 'passed'], [n('not_applicable'), 'not applicable'], [n('failed'), 'failed'], [n('missing'), 'did not run']].filter(([count]) => count).map(([count, label]) => `${count} ${label}`);
  const head = tools.scanners.length ? `${tools.scanners.length} scanner${tools.scanners.length === 1 ? '' : 's'}: ${parts.join(', ')}.` : 'No scanner result was recorded.';
  return tools.notes.length ? `${head} ${tools.notes.length} note${tools.notes.length === 1 ? '' : 's'}.` : head;
}

export function toolsText(tools) {
  if (!hasTools(tools)) return [];
  const lines = ['Tools (the audit\'s own scanners; they do not decide whether this report is complete):', `  ${toolsHeadline(tools)}`];
  for (const row of tools.scanners) lines.push(`  - ${plain(row.tool)}: ${plain(toolLine(row))}`);
  for (const note of tools.notes) lines.push(`  - ${plain(note)}`);
  return lines;
}

export function toolsMarkdown(tools) {
  if (!hasTools(tools)) return [];
  const lines = ['', '## Tools', '', `> ${plain(tools.policy)}`, '', toolsHeadline(tools)];
  if (tools.scanners.length) {
    lines.push('', '| Scanner | Result | Findings | Scope | Detail |', '|---|---|---|---|---|');
    const cell = (value) => plain(value).replaceAll('|', '/');
    for (const row of tools.scanners) lines.push(`| ${cell(row.tool)} | ${toolLabel(row.state)} | ${row.findings == null ? '—' : number(row.findings)} | ${cell(row.scopes.join(', ')) || '—'} | ${cell(row.detail) || '—'} |`);
  }
  if (tools.notes.length) lines.push('', ...tools.notes.map((note) => `- ${plain(note)}`));
  return lines;
}

export function toolsHtml(tools) {
  if (!hasTools(tools)) return '<p class="note">This report has no tool record.</p>';
  const rows = tools.scanners.map((row) => `<tr><td>${esc(row.tool)}</td><td class="tool-${esc(row.state)}"><strong>${esc(toolLabel(row.state))}</strong></td><td>${row.findings == null ? '—' : number(row.findings)}</td><td>${esc(row.scopes.join(', ')) || '—'}</td><td>${esc(row.detail) || '—'}</td></tr>`).join('');
  const table = tools.scanners.length ? `<div class="table-scroll"><table><thead><tr><th>Scanner</th><th>Result</th><th>Findings</th><th>Scope</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  const notes = tools.notes.length ? `<ul>${tools.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : '';
  return `<p class="note">${esc(tools.policy)}</p><p><strong>${esc(toolsHeadline(tools))}</strong></p>${table}${notes}`;
}
