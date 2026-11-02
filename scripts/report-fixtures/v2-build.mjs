import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'v2-run'));
fs.rmSync(out, { recursive: true, force: true });
const put = (rel, value) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const reviewers = [
  { id: 'cli-claude-opus', family: 'cli', vendor: 'anthropic', model: 'opus' },
  { id: 'key-zai-glm-5-3', family: 'key', vendor: 'zai', model: 'glm-5.3' },
  { id: 'openrouter-qwen-qwen3-8-max', family: 'openrouter', vendor: 'alibaba', model: 'qwen/qwen3.8-max-0902' },
  { id: 'openrouter-anthropic-claude-opus', family: 'openrouter', vendor: 'anthropic', model: 'claude-opus-5.5' },
  { id: 'scripted-baseline', family: 'scripted', vendor: 'scripted', model: 'baseline' },
];
put('meta.json', {
  name: 'v2-fixture', mode: 'local', source: 'fixture', date: '2026-11-02T00:00:00Z', finalized: true, surface: 's1',
  agents: ['cli-claude-opus'], models: { 'cli-claude-opus': 'opus' },
  auditors: ['cli-claude-opus-s1-auth'], workerExits: { 'cli-claude-opus-s1-auth': 0 }, crosscheckExits: {}, stageFailures: [],
});
put('auditors/cli-claude-opus-s1-auth.json', [{
  title: 'Missing owner check', surface: 'S1', severity: 'high', confidence: 'confirmed', location: ['src/lib.rs:16'],
  impact: 'Any caller can withdraw.', preconditions: 'A balance exists.',
  analysis: 'withdraw does not compare the predecessor. reentrancy is not the issue.',
  validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor to the owner.',
}, {
  title: 'Unchecked arithmetic', surface: 'S1', severity: 'low', confidence: 'probable', location: ['src/lib.rs:40'],
  impact: 'A balance can wrap.', preconditions: 'A large deposit.',
  analysis: 'The addition is unchecked.', validation: 'Source inspection.', attack: [], poc: '', fix: 'Use checked math.',
}, { verified_safe: [] }]);
put('auditors/cli-claude-opus-s1-auth.md', 'Source review only.\n');
put('harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
put('debate/clusters.json', {
  clusters: [
    { id: 'CLUSTER-1', primaryTitle: 'Missing owner check', status: 'QUEUED', rounds: 2, severity: 'high' },
    { id: 'CLUSTER-2', primaryTitle: 'Agreed check', status: 'AGREED', rounds: 0, severity: 'low' },
  ],
  coverageGaps: [{ clusterId: 'CLUSTER-9', reason: 'debate_cap' }],
});
put('debate/adjudication.json', [
  { clusterId: 'CLUSTER-1', finalStatus: 'DISPUTED', severity: 'high', severityReason: 'Left as reported.', judge: { reviewerId: 'scripted-judge', vendor: 'scripted', alternate: false }, rationale: 'Verified quotes disagree.', validArguments: ['Reviewer A'], discardedArguments: ['Reviewer B'] },
  { clusterId: 'CLUSTER-2', finalStatus: 'CONFIRMED', severity: 'low', severityReason: 'Two vendors.', judge: { reviewerId: 'scripted-judge', vendor: 'scripted', alternate: false }, rationale: 'Agreed before debate.', validArguments: [], discardedArguments: [] },
]);
const turn = (round, anon, extra) => ({
  round, clusterId: 'CLUSTER-1', role: extra.role, anonId: anon, verdict: 'upheld',
  citations: [{ file: 'src/lib.rs', startLine: 16, endLine: 16, quote: extra.quote }],
  argument: extra.argument, devilAdvocate: Boolean(extra.devil), conformitySuspect: Boolean(extra.suspect),
});
put('debate/round-1/Reviewer A-CLUSTER-1.json', turn(1, 'Reviewer A', { role: 'devil', quote: 'saturating_sub', argument: 'The withdraw body is the bug.', devil: true }));
put('debate/round-1/Reviewer B-CLUSTER-1.json', turn(1, 'Reviewer B', { role: 'challenge', quote: 'nope', argument: 'A bad quote.' }));
put('debate/round-2/Reviewer C-CLUSTER-1.json', turn(2, 'Reviewer C', { role: 'defend', quote: 'saturating_sub', argument: 'I concede.', suspect: true }));
put('debate/citations.json', [
  { file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'saturating_sub', valid: true, clusterId: 'CLUSTER-1' },
  { file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'nope', valid: false, reason: 'quote_not_found', clusterId: 'CLUSTER-1' },
]);
put('general-review.json', {
  executiveSummary: 'One disputed finding remains.\nLine two.\nLine three.',
  riskPosture: 'high-risk',
  topFindings: [{ clusterId: 'CLUSTER-1', title: 'Missing owner check', severity: 'high', finalStatus: 'DISPUTED' }],
  coverage: [{ surface: 'S1', covered: true, gaps: ['debate_cap'] }],
  openDisagreements: [{ clusterId: 'CLUSTER-1', summary: 'Quotes disagree.' }],
  contributions: reviewers.map((row) => ({ reviewerId: row.id, uniqueConfirmed: row.id === 'cli-claude-opus' ? 1 : 0, refuted: 0, toolCalls: 4, costUsd: 0 })),
  methodology: { reviewers: reviewers.map((row) => row.id), orchestrator: 'scripted:judge', passes: 2, toolBudget: 40, debateRounds: 2 },
  disclaimer: 'Model agreement and passing checks do not certify security.',
});
put('general-review.md', '# General review\n\n<script>alert(1)</script>\n\nModel agreement and passing checks do not certify security.\n');
const card = (row, cost) => ({
  id: row.id, status: 'COMPLETE', uniqueFindings: row.id === 'cli-claude-opus' ? 2 : 1, uniqueConfirmed: row.id === 'cli-claude-opus' ? 1 : 0, refuted: 0,
  calls: 4, cost, model: row.model, report: `reviewers/${row.id}/report.html`,
  severity: { high: row.id === 'cli-claude-opus' ? 1 : 0, medium: 0, low: 1 },
});
put('reviewers/index.json', {
  groups: [
    { family: 'cli', label: 'Local subscriptions', vendors: [{ vendor: 'anthropic', reviewers: [card(reviewers[0], 0)] }] },
    { family: 'key', label: 'API keys', vendors: [{ vendor: 'zai', reviewers: [card(reviewers[1], 0.41)] }] },
    { family: 'openrouter', label: 'OpenRouter', vendors: [{ vendor: 'alibaba', reviewers: [card(reviewers[2], null)] }, { vendor: 'anthropic', reviewers: [card(reviewers[3], 0.2)] }] },
    { family: 'scripted', label: 'Demo', vendors: [{ vendor: 'scripted', reviewers: [card(reviewers[4], 0)] }] },
  ],
  totals: { findings: 2, reviewers: reviewers.length },
  pages: ['reviewers.html', ...reviewers.map((row) => `reviewers/${row.id}/report.html`)],
});
for (const row of reviewers) {
  put(`reviewers/${row.id}/usage.json`, {
    passes: [{ k: 1, calls: 4, tokensIn: 100, tokensOut: 40, stop: 'submitted' }],
    totals: { calls: 4, tokensIn: 100, tokensOut: 40, cost: row.id === 'openrouter-qwen-qwen3-8-max' ? null : 0.1, stops: ['submitted'] },
  });
}
console.log(out);
