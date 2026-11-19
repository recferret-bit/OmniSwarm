import test from 'node:test';
import assert from 'node:assert/strict';
import { section } from './report-section-crosscheck.mjs';

const cluster = (id, title, status, severity, rounds = 0) => ({ id, primaryTitle: title, status, severity, rounds });

function data() {
  return {
    clusters: [
      cluster('CLUSTER-2', 'Agreed check', 'AGREED', 'low', 0),
      cluster('CLUSTER-12', 'Nonce replay', 'AGREED', 'critical', 0),
      cluster('CLUSTER-3', 'Delegated top-up', 'QUEUED', 'high', 1),
      cluster('CLUSTER-16', 'Deposit forfeit', 'CAPPED', 'medium', 0),
      cluster('CLUSTER-4', 'Quiet medium', 'CAPPED', 'low', 0),
    ],
    coverageGaps: [
      { clusterId: 'CLUSTER-16', reason: 'debate_cap' },
      { clusterId: 'CLUSTER-4', reason: 'debate_cap' },
      { clusterId: 'CLUSTER-3', reason: 'debate_time' },
    ],
    byCluster: new Map([
      ['CLUSTER-2', { finalStatus: 'CONFIRMED', judge: { reviewerId: 'triage', vendor: 'none', alternate: false } }],
      ['CLUSTER-12', { finalStatus: 'CONFIRMED', judge: { reviewerId: 'triage', vendor: 'none', alternate: false } }],
      ['CLUSTER-3', { finalStatus: 'CONFIRMED', judge: { reviewerId: 'cli-grok-grok-4-7', vendor: 'xai', alternate: true } }],
      ['CLUSTER-16', { finalStatus: 'LIKELY', judge: { reviewerId: 'rules', vendor: 'rules', alternate: false } }],
    ]),
    rounds: [{
      clusterId: 'CLUSTER-3', round: 1, anonId: 'A', conformitySuspect: true,
      citations: [{ file: 'a.rs', startLine: 1, quote: 'x' }],
    }],
    citations: [{ file: 'a.rs', startLine: 1, quote: 'x', clusterId: 'CLUSTER-3', anonId: 'A', valid: true }],
  };
}

test('cross-check sorts by severity, collapses the cap, and does not print unmeasured zeros', () => {
  const html = section.render(data());
  const main = html.slice(html.indexOf('id="crosscheck-debated"'), html.indexOf('id="crosscheck-cap"'));
  const cap = html.slice(html.indexOf('id="crosscheck-cap"'));
  assert.ok(main.indexOf('CLUSTER-12') < main.indexOf('CLUSTER-3') && main.indexOf('CLUSTER-3') < main.indexOf('CLUSTER-2'));
  assert.equal(main.includes('CLUSTER-16'), false);
  assert.match(main, /CLUSTER-3/);
  assert.equal(main.includes('>none<'), false);
  assert.match(main, /Nonce replay[\s\S]{0,250}>triage</);
  assert.match(main, /<td class="num">—<\/td>/);
  assert.match(main, /<td>xai<\/td><td>yes<\/td>/);
  assert.match(main, /Agreed check[\s\S]{0,200}<td class="num">0<\/td>/);
  assert.equal(/<details class="panel" id="crosscheck-cap" open>/.test(html), false);
  assert.match(html, /<details class="panel" id="crosscheck-debated" open>/);
  assert.match(cap, /Deposit forfeit/);
  assert.match(cap, /Debate cap/);
  assert.equal(cap.includes('debate_cap'), false);
  assert.equal(cap.includes('CLUSTER-3'), false, 'a debate_time gap stays in the debated table');
  assert.ok(cap.indexOf('CLUSTER-16') < cap.indexOf('CLUSTER-4'));
  assert.match(html, /data-cross-filter="INSUFFICIENT_EVIDENCE"[^>]*>Insufficient Evidence</);
  assert.equal((html.match(/<tr data-status=/g) || []).length, 5);
});
