import test from 'node:test';
import assert from 'node:assert/strict';
import { section } from './report-section-general-review.mjs';

const general = {
  executiveSummary: 'x',
  disclaimer: 'Model agreement and passing checks do not certify security.',
  coverage: [{ surface: 'S1', covered: true, gaps: ['debate_cap'] }],
  openDisagreements: [{ clusterId: 'CLUSTER-1', summary: 'Quotes disagree.' }],
  contributions: [{ reviewerId: 'cli-claude-opus', uniqueConfirmed: 1, refuted: 0, toolCalls: 4, costUsd: null }],
  methodology: {
    reviewers: ['cli-claude-opus', 'cli-grok-grok-4-7'],
    orchestrator: 'cli:claude:opus',
    passes: 2,
    toolBudget: 40,
    debateRounds: 2,
    judgeAssignment: [
      'CLUSTER-1: triage',
      'CLUSTER-3: cli-grok-grok-4-7 (alternate)',
      'CLUSTER-16: rules',
      'CLUSTER-19: rules',
    ],
  },
  incompletionNotes: [{ category: 'provider_error', source: 's3', reason: 'Session failed', impact: 'S3 may be thin' }],
};

const markdown = `# General review

This summary covers clusters.

CRITICAL (confirmed):
- Intent verifier nonce replay (CLUSTER-12): replay by **re-encoding**.
- Cargo squatting (CLUSTER-5): shared map.

High-severity themes (confirmed):
- Missing signature and recipient binding:
  - NEP-413 recipient is not bound (CLUSTER-2).

1. Canonicalize nonces.
2. Scope processed_ops.

<script>alert(1)</script>

[Missing owner check](#finding-CLUSTER-1)
`;

test('general review formats prose and does not dump cap judges', () => {
  const html = section.render({ general, markdown });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(html.includes('<h3>General review</h3>'), false);
  assert.match(html, /<p class="md-kicker sev-critical">CRITICAL \(confirmed\):<\/p>/);
  assert.match(html, /<ul><li>Intent verifier nonce replay \(CLUSTER-12\): replay by <strong>re-encoding<\/strong>\.<\/li>/);
  assert.match(html, /<li>Missing signature and recipient binding:<ul><li>NEP-413 recipient is not bound \(CLUSTER-2\)\.<\/li><\/ul><\/li>/);
  assert.match(html, /<ol><li>Canonicalize nonces\.<\/li><li>Scope processed_ops\.<\/li><\/ol>/);
  assert.match(html, /<a href="#finding-CLUSTER-1">Missing owner check<\/a>/);
  assert.equal(html.includes('Judges: CLUSTER-'), false);
  assert.equal(html.includes('CLUSTER-16: rules'), false);
  assert.match(html, /1 cli-grok-grok-4-7 · 1 triage · 2 rules/);
  assert.match(html, /debate cap/);
  const judges = html.slice(html.indexOf('id="judge-assignments"'));
  assert.match(judges, /cli-grok-grok-4-7/);
  assert.match(judges, />alternate</);
  assert.equal(judges.includes('CLUSTER-16'), false);
  assert.equal(judges.includes('>triage<'), false);
  assert.match(html, /<h2><span class="section-num">06<\/span>General review<\/h2>/);
  assert.match(html, /<td>cli-claude-opus<\/td><td class="num">1<\/td>/);
  assert.match(html, /<td>provider_error<\/td><td>s3<\/td><td>Session failed<\/td>/);
});

test('a missing general review stays a notice', () => {
  const html = section.render({ general: null, markdown: '' });
  assert.match(html, /General review not run/);
  assert.match(html, /id="general-review"/);
});
