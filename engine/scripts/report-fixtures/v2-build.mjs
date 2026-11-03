// The report-v2 fixture: a finalized five-reviewer run on surface S1 with a debate and a general review.
// generate-html-report.mjs scores it, derives reviewers/ from meta.reviewers and renders every page.
//   CLUSTER-1  "Missing owner check"   cli-claude-opus only, debated, DISPUTED (devil, bad quote, conformity flag)
//   CLUSTER-2  "Agreed check"          key-zai + openrouter-qwen, AGREED at triage
//   CLUSTER-3  "Unchecked arithmetic"  cli-claude-opus, CAPPED (coverage gap)
//   CLUSTER-4  "Logged secret"         openrouter-anthropic, LIKELY
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviewerSpec } from '../reviewer-registry.mjs';

const out = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'v2-run'));
fs.rmSync(out, { recursive: true, force: true });
const put = (rel, value) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const reviewers = ['cli:claude:opus', 'key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902', 'openrouter:anthropic/claude-opus-5.5', 'scripted:baseline'].map(parseReviewerSpec);
const [claude, zai, qwen, orClaude] = reviewers.map((r) => r.id);
const auditors = reviewers.map((r) => `${r.id}-s1-auth`);
put('meta.json', {
  name: 'v2-fixture', mode: 'local', source: 'fixture', date: '2026-11-02T00:00:00Z', finalized: true, surface: 's1',
  agents: reviewers.map((r) => r.id), models: Object.fromEntries(reviewers.map((r) => [r.id, r.model])), reviewers, auditors,
  workerExits: Object.fromEntries(auditors.map((a) => [a, 0])), crosscheckExits: Object.fromEntries(reviewers.map((r) => [r.id, 0])), stageFailures: [],
});
const finding = (title, location, severity, extra = {}) => ({
  title, surface: 'S1', severity, confidence: 'probable', location: [location], impact: `${title}.`, preconditions: 'A balance exists.',
  analysis: 'Source inspection of the cited line.', validation: 'Source inspection.', attack: [], poc: '', fix: 'Add the missing control.', ...extra,
});
const filed = {
  [claude]: [finding('Missing owner check', 'src/lib.rs:16', 'high', { analysis: 'withdraw does not compare the predecessor. reentrancy is not the issue.' }), finding('Unchecked arithmetic', 'src/lib.rs:40', 'low')],
  [zai]: [finding('Agreed check', 'src/lib.rs:30', 'low')],
  [qwen]: [finding('Agreed check', 'src/lib.rs:30', 'low')],
  [orClaude]: [finding('Logged secret', 'src/log.ts:3', 'medium')],
};
for (const id of reviewers.map((r) => r.id)) {
  put(`auditors/${id}-s1-auth.json`, [...(filed[id] || []), { verified_safe: [] }]);
  put(`auditors/${id}-s1-auth.md`, 'Source review only.\n');
}
// Every reviewer cross-checks every other reviewer's claims; one refutes the arithmetic claim (PARTIAL_REVIEW).
const claims = Object.entries(filed).flatMap(([id, rows]) => rows.map((row, n) => ({ id, claimId: `${id}-s1-auth#${n}`, row })));
for (const reviewer of reviewers) {
  const verdicts = claims.filter((c) => c.id !== reviewer.id).map((c) => ({
    id: c.claimId, verdict: reviewer.id === zai && c.row.title === 'Unchecked arithmetic' ? 'refuted' : 'upheld',
    reason: 'Read the cited line.', evidence: c.row.location,
  }));
  if (verdicts.length) put(`auditors/crosscheck-${reviewer.id}.json`, verdicts);
}
put('harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
const usage = (id, row) => put(`harness/usage/${id}/s1-pass-1.json`, { k: 1, role: 'discover', calls: 4, tokensIn: 100, tokensOut: 40, stop: 'submitted', ...row });
usage(claude, { cost: 0, costSource: 'none' });
usage(zai, { cost: 0.41, costSource: 'reported' });
usage(orClaude, { cost: 0.2, costSource: 'reported' });

const claim = (id, n = 0) => `${id}-s1-auth#${n}`;
const cluster = (id, title, status, severity, claimIds, extra = {}) => ({ id, primaryTitle: title, status, severity, surface: 'S1', claimIds, ...extra });
put('debate/clusters.json', {
  clusters: [
    cluster('CLUSTER-2', 'Agreed check', 'AGREED', 'low', [claim(zai), claim(qwen)], { rounds: 0, vendors: ['zai', 'alibaba'] }),
    cluster('CLUSTER-1', 'Missing owner check', 'QUEUED', 'high', [claim(claude)], { rounds: 2, vendors: ['anthropic'] }),
    cluster('CLUSTER-4', 'Logged secret', 'QUEUED', 'medium', [claim(orClaude)], { rounds: 1, vendors: ['anthropic'] }),
    cluster('CLUSTER-3', 'Unchecked arithmetic', 'CAPPED', 'low', [claim(claude, 1)], { rounds: 0, vendors: ['anthropic'] }),
  ],
  coverageGaps: [{ clusterId: 'CLUSTER-3', reason: 'debate_cap' }],
});
const judge = { reviewerId: zai, vendor: 'zai', alternate: true };
put('debate/adjudication.json', [
  { clusterId: 'CLUSTER-2', finalStatus: 'CONFIRMED', severity: 'low', severityReason: 'Left at the reported severity.', judge: { reviewerId: 'triage', vendor: 'none', alternate: false }, rationale: 'AGREED at triage.', validArguments: [], discardedArguments: [] },
  { clusterId: 'CLUSTER-1', finalStatus: 'DISPUTED', severity: 'high', severityReason: 'Left as reported.', judge, rationale: 'Verified quotes disagree.', validArguments: ['Reviewer A round 1: refuted'], discardedArguments: ['Reviewer B round 1: no_valid_citation'] },
  { clusterId: 'CLUSTER-4', finalStatus: 'LIKELY', severity: 'medium', severityReason: 'Left as reported.', judge, rationale: 'Single source, not refuted.', validArguments: [], discardedArguments: [] },
]);
const turn = (round, anon, extra) => ({
  round, clusterId: 'CLUSTER-1', role: extra.role, anonId: anon, verdict: extra.verdict || 'upheld',
  citations: [{ file: 'src/lib.rs', startLine: 16, endLine: 16, quote: extra.quote }],
  argument: extra.argument, devilAdvocate: extra.role === 'devil', conformitySuspect: Boolean(extra.suspect),
});
put('debate/round-1/Reviewer A-CLUSTER-1.json', turn(1, 'Reviewer A', { role: 'devil', verdict: 'refuted', quote: 'saturating_sub', argument: 'The guard sits in the caller.' }));
put('debate/round-1/Reviewer B-CLUSTER-1.json', turn(1, 'Reviewer B', { role: 'challenge', verdict: 'refuted', quote: 'nope', argument: 'A bad quote.' }));
put('debate/round-1/Reviewer C-CLUSTER-1.json', turn(1, 'Reviewer C', { role: 'challenge', quote: 'unrecorded', argument: 'A quote the checker never saw.' }));
put('debate/round-2/Reviewer D-CLUSTER-1.json', turn(2, 'Reviewer D', { role: 'defend', verdict: 'refuted', quote: 'saturating_sub', argument: 'I concede.', suspect: true }));
put('debate/citations.json', [
  { file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'saturating_sub', valid: true, clusterId: 'CLUSTER-1', anonId: 'Reviewer A', round: 1 },
  { file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'nope', valid: false, reason: 'quote_not_found', clusterId: 'CLUSTER-1', anonId: 'Reviewer B', round: 1 },
  { file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'saturating_sub', valid: true, clusterId: 'CLUSTER-1', anonId: 'Reviewer D', round: 2 },
]);
put('general-review.json', {
  executiveSummary: 'One disputed finding remains.\nLine two.\nLine three.',
  riskPosture: 'high-risk',
  topFindings: [{ clusterId: 'CLUSTER-1', title: 'Missing owner check', severity: 'high', finalStatus: 'DISPUTED' }],
  coverage: [{ surface: 'S1', covered: true, gaps: ['debate_cap'] }],
  openDisagreements: [{ clusterId: 'CLUSTER-1', summary: 'Quotes disagree.' }],
  contributions: reviewers.map((row) => ({ reviewerId: row.id, uniqueConfirmed: row.id === orClaude ? 1 : 0, refuted: 0, toolCalls: 4, costUsd: 0 })),
  methodology: { reviewers: reviewers.map((row) => row.id), orchestrator: 'cli:codex:gpt-5.5', passes: 2, toolBudget: 40, debateRounds: 2, judgeAssignment: ['CLUSTER-1: key-zai-glm-5-3 (alternate)'] },
  disclaimer: 'Model agreement and passing checks do not certify security.',
});
put('general-review.md', '# General review\n\n<script>alert(1)</script>\n\nModel agreement and passing checks do not certify security.\n');
console.log(out);
