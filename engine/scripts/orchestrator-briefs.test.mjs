import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIEF_HEADINGS, briefIds, renderDebateBrief } from './orchestrator-briefs.mjs';

const snapshots = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report-fixtures', '__snapshots__', 'briefs');
const cluster = {
  id: 'CLUSTER-2', primaryTitle: 'withdraw has no owner check', severity: 'high', surface: 'S1',
  evidence: [{ file: 'src/lib.rs', startLine: 16, endLine: 16, quote: 'self.balance -= amount;', valid: true }, { file: 'src/lib.rs', startLine: 99, endLine: 99, quote: '', valid: false, reason: 'line_out_of_range' }],
};
const turns = [{ round: 1, role: 'challenge', anonId: 'Reviewer A', verdict: 'refuted', argument: 'The guard holds.', citations: [{ file: 'src/lib.rs', startLine: 12, endLine: 12, quote: 'assert_eq!' }] }];
const options = {
  challenge: { cluster, anonId: 'Reviewer B', round: 1 },
  'devil-advocate': { cluster, anonId: 'Reviewer C', round: 1 },
  defend: { cluster, turns, anonId: 'Reviewer A', round: 2 },
  rebut: { cluster, turns, anonId: 'Reviewer B', round: 3 },
  judge: { cluster, turns },
  'general-review': { clusters: [{ clusterId: 'CLUSTER-2', finalStatus: 'LIKELY', severity: 'high', title: 'withdraw has no owner check' }] },
};

test('every brief has the four headings, one cluster, and matches its snapshot', () => {
  assert.deepEqual(briefIds(), Object.keys(options));
  for (const id of briefIds()) {
    const text = renderDebateBrief(id, { ...options[id], budget: 12 });
    for (const heading of BRIEF_HEADINGS) assert.match(text, new RegExp(`^## ${heading}$`, 'm'), id);
    assert.equal(/anthropic|openai|claude|codex|grok|vendor/i.test(text), false, id);
    const file = path.join(snapshots, `${id}.md`);
    if (process.env.UPDATE_SNAPSHOTS === '1') { fs.mkdirSync(snapshots, { recursive: true }); fs.writeFileSync(file, text); }
    assert.equal(text, fs.readFileSync(file, 'utf8'), `${id} brief changed; rerun with UPDATE_SNAPSHOTS=1 and review the diff`);
  }
  assert.match(renderDebateBrief('defend', options.defend), /Reviewer A, round 1 \(challenge\): refuted/);
  assert.match(renderDebateBrief('judge', options.judge), /`self\.balance -= amount;`/);
  assert.throws(() => renderDebateBrief('review-pass'), /unknown brief/);
});
