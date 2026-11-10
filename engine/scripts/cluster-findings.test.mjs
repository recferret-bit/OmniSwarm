import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterFindings, dedupCandidates, isCompoundTitle, sameSite, sharedAnchorFiles, sharedTitleWords } from './cluster-findings.mjs';

let n = 0;
const claim = (auditor, surface, title, location, severity = 'medium') =>
  ({ auditor, surface, title, location, severity, confidence: 'probable', claimId: `${auditor}#${n++}` });

// Synthetic shapes of a real duplicated report: three auditors on one endpoint, two on a script
// loader, plus claims that touch the same shared files but are different issues.
const claims = () => {
  n = 0;
  return [
    claim('codex-s4-config', 'S4', 'Receipt endpoint bypasses visibility', ['api/ride.controller.ts:27', 'api/get-ride.handler.ts:19', 'api/ride.dto.ts:54']),
    claim('agy-s3-logic', 'S3', 'Missing replay gate on public ride route', ['api/ride.controller.ts:27', 'api/get-ride.handler.ts:18'], 'high'),
    claim('grok-s6-client', 'S6', 'Public ride JSON leaks seed and wallet', ['api/ride.controller.ts:28', 'api/get-ride.handler.ts:18', 'api/ride.dto.ts:66']),
    claim('claude-s5-deps', 'S5', 'Signing library loaded without SRI', ['web/pay.js:11', 'web/play.html:32']),
    claim('grok-s6-client', 'S6', 'Game pages load CDN scripts without SRI', ['web/play.html:32', 'web/pay.js:12']),
    // Decoys: one shared file only, or same auditor.
    claim('grok-s2-input', 'S2', 'Hidden and locked replays return different errors', ['domain/replay-visibility.ts:22', 'api/ride.controller.ts:27']),
    claim('codex-s4-config', 'S4', 'Promo error reveals code state', ['api/errors.ts:10', 'api/promo.handler.ts:55']),
    claim('claude-s1-auth', 'S1', 'Pay mismatch reveals wallet prefix', ['api/errors.ts:11', 'api/pay.handler.ts:37']),
    claim('agy-s3-logic', 'S3', 'Payout plan persisted early', ['svc/payout.ts:100', 'svc/ranking.ts:20']),
    claim('agy-s3-logic', 'S3', 'Payout ranking uses stale verdicts', ['svc/payout.ts:101', 'svc/ranking.ts:21']),
  ];
};

test('cross-auditor claims on the same root cause merge across surfaces and titles', () => {
  const clusters = clusterFindings(claims());
  const sets = clusters.map((c) => c.claimIds.length).sort();
  assert.equal(clusters.length, 7);
  assert.deepEqual(sets, [1, 1, 1, 1, 1, 2, 3]);
  const triple = clusters.find((c) => c.claimIds.length === 3);
  assert.deepEqual([...triple.auditors].sort(), ['agy-s3-logic', 'codex-s4-config', 'grok-s6-client']);
  const pair = clusters.find((c) => c.claimIds.length === 2);
  assert.deepEqual([...pair.auditors].sort(), ['claude-s5-deps', 'grok-s6-client']);
});

test('a single shared file never chains unrelated claims together', () => {
  const clusters = clusterFindings(claims());
  const decoy = clusters.find((c) => c.primaryTitle.startsWith('Hidden and locked'));
  assert.equal(decoy.claimIds.length, 1);
  assert.equal(clusters.find((c) => c.primaryTitle.startsWith('Promo')).claimIds.length, 1);
});

test('one auditor splitting an issue in two is respected', () => {
  const clusters = clusterFindings(claims());
  assert.equal(clusters.filter((c) => c.auditors.includes('agy-s3-logic') && c.findings.some((f) => f.location[0].startsWith('svc/'))).length, 2);
});

test('cluster leads with its highest-severity claim and keeps the severity spread', () => {
  const triple = clusterFindings(claims()).find((c) => c.claimIds.length === 3);
  assert.equal(triple.severity, 'high');
  assert.equal(triple.primaryTitle, 'Missing replay gate on public ride route');
  assert.equal(triple.claimIds[0], triple.findings[0].claimId);
  assert.deepEqual([...triple.severities].sort(), ['high', 'medium']);
});

test('exact title with a shared citation still merges, even on a single anchor', () => {
  n = 0;
  const clusters = clusterFindings([
    claim('claude-s1-auth', 'S1', 'Same issue', ['src/a.ts:12']),
    claim('grok-s1-auth', 'S1', 'same issue', ['src/a.ts:12']),
    claim('codex-s1-auth', 'S1', 'Same issue', ['src/b.ts:8']),
  ]);
  assert.equal(clusters.length, 2);
});

test('near-line tolerance is bounded', () => {
  assert.deepEqual(sharedAnchorFiles({ location: ['a.ts:10', 'b.ts:5'] }, { location: ['a.ts:13', 'b.ts:9'] }), ['a.ts']);
});

test('unmerged cross-auditor overlaps are reported as dedup candidates, merged ones are not', () => {
  const clusters = clusterFindings(claims());
  const candidates = dedupCandidates(clusters);
  assert.ok(candidates.some((c) => c.sharedFiles.includes('api/errors.ts')));
  assert.ok(candidates.some((c) => c.sharedFiles.includes('api/ride.controller.ts')));
  assert.ok(!candidates.some((c) => c.sharedFiles.includes('svc/payout.ts')), 'same-auditor overlap is not a candidate');
});

test('bundled titles are flagged as compound, single issues are not', () => {
  assert.ok(isCompoundTitle('Missing gate on GET /api/rides/:id/public, Unauthenticated Pledge Queries, and Solana Pay Owner Enumeration'));
  assert.ok(!isCompoundTitle('Public ride JSON skips the replay gate and returns seed, full wallet, and payment data'));
  assert.ok(!isCompoundTitle('Wallet-signing @solana/web3.js and three.js are loaded from jsDelivr without SRI'));
});

// The same defect reported by three models arrives as three single-location claims with different titles.
const one = (auditor, title, location, surface = 'S3') => claim(auditor, surface, title, [location]);

test('the same site merges: adjacent lines, or near lines with a shared subject, from different auditors', () => {
  n = 0;
  const clusters = clusterFindings([
    one('claude-s3', 'Withdraw pays out before the balance is debited', 'backend/tips.js:45'),
    one('codex-s3', 'Race between balance check and debit in /me/withdraw', 'backend/tips.js:46'),
    one('grok-s3', 'Non-atomic withdraw lets one balance be paid twice', 'backend/tips.js:48'),
    one('claude-s3', 'Tip confirmation credits any caller', 'backend/tips.js:50'),
  ]);
  const sizes = clusters.map((c) => c.claimIds.length).sort();
  assert.deepEqual(sizes, [1, 3], 'lines 45, 46 (adjacent) and 48 (near, shares "withdraw" and "balance" with 46) are one defect; 50 stays apart');
});

test('the same site does not merge: far lines, near lines with no shared subject, another file, the same auditor', () => {
  const merged = (a, b) => sameSite({ auditor: 'x', ...a }, { auditor: 'y', ...b });
  const at = (title, loc) => ({ title, location: [loc] });
  assert.equal(merged(at('Withdraw skips the owner comparison', 'a.js:10'), at('Withdraw skips the owner comparison', 'a.js:14')), false, 'four lines apart');
  assert.equal(merged(at('Payout races the balance update', 'a.js:10'), at('Destination is caller supplied', 'a.js:13')), false, 'three lines, no shared subject');
  assert.equal(merged(at('Payout races the balance update', 'a.js:10'), at('Payout races the balance update', 'b.js:10')), false, 'another file');
  assert.equal(sameSite({ auditor: 'x', ...at('Same title here', 'a.js:10') }, { auditor: 'x', ...at('Same title here', 'a.js:10') }), false, 'one auditor splitting an issue is respected');
  assert.equal(merged(at('x', 'a.js:10'), { title: 'y', location: [] }), false, 'no location');
  // And the positive side of the same table.
  assert.equal(merged(at('Anything at all', 'a.js:10'), at('Something else', 'a.js:11')), true, 'adjacent lines');
  assert.equal(merged(at('Payout races the balance update', 'a.js:10'), at('Balance update races the payout', 'a.js:13')), true, 'three lines with a shared subject');
});

test('only the first (sink) location counts, and context files that disagree veto the merge', () => {
  n = 0;
  // The second claim cites the first one\'s sink only as context: its own sink is elsewhere.
  const context = clusterFindings([
    claim('codex-s3', 'S3', 'Replay gate missing', ['api/ride.controller.ts:27']),
    claim('grok-s2', 'S2', 'Hidden and locked replays return different errors', ['domain/replay.ts:22', 'api/ride.controller.ts:27']),
  ]);
  assert.equal(context.length, 2);
  // Neighbouring lines of a shared error mapper, each with its own handler: different issues.
  const mapper = clusterFindings([
    claim('codex-s4', 'S4', 'Promo error reveals code state', ['api/errors.ts:10', 'api/promo.handler.ts:55']),
    claim('claude-s1', 'S1', 'Pay mismatch reveals wallet prefix', ['api/errors.ts:11', 'api/pay.handler.ts:37']),
  ]);
  assert.equal(mapper.length, 2);
  // The same neighbouring lines with a handler in common are one issue.
  const shared = clusterFindings([
    claim('codex-s4', 'S4', 'Promo error reveals code state', ['api/errors.ts:10', 'api/promo.handler.ts:55']),
    claim('claude-s1', 'S1', 'Promo code state leaks in error', ['api/errors.ts:11', 'api/promo.handler.ts:55']),
  ]);
  assert.equal(shared.length, 1);
});

test('title words ignore short and generic words', () => {
  // Only "withdraw" is shared: "missing", "check", "route", "validation" and "handler" are generic.
  assert.equal(sharedTitleWords('Missing check on the withdraw route', 'No validation of withdraw handler'), 1);
  assert.equal(sharedTitleWords('Payout races the balance update', 'Balance update races the payout'), 4);
  assert.equal(sharedTitleWords('', 'anything'), 0);
});
