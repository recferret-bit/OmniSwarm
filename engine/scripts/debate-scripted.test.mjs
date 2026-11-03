import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runPanel } from '../eval/panel.mjs';
import { decideDefaultRounds, retainedBy, score } from '../eval/metrics.mjs';
import { offlinePlan } from './debate-plan.mjs';
import { runDebateStages } from './debate-run.mjs';
import { SCRIPTS, tempDir } from './debate-test-run.mjs';

const GOLDEN = path.join(SCRIPTS, '..', 'eval', 'golden');
const load = (name) => ({ dir: path.join(GOLDEN, name), expected: JSON.parse(fs.readFileSync(path.join(GOLDEN, name, 'expected.json'), 'utf8')) });
const at = (item) => (cluster) => cluster.anchors.some((a) => a.file === item.file && a.line >= item.startLine && a.line <= item.endLine);

async function debateGolden(name, rounds) {
  const { dir, expected } = load(name);
  const panel = await runPanel(dir, expected, tempDir('panel-'));
  const out = tempDir('golden-debate-');
  const result = await runDebateStages(offlinePlan({ out, sourceRoot: dir, claims: panel.claims, controls: panel.controls, reviewers: panel.reviewers, rounds }));
  const status = (item) => result.rows.find((row) => row.clusterId === result.clusters.find(at(item))?.id)?.finalStatus;
  return { out, result, expected, status, panel };
}

test('the seeded bugs stay (LIKELY) and the decoys are REFUTED, judged by the cluster that cites them', async () => {
  const { expected, status } = await debateGolden('near-escrow', 3);
  for (const bug of expected.bugs) assert.equal(status(bug), 'LIKELY', `${bug.title}`);
  for (const decoy of expected.decoys) assert.equal(status(decoy), 'REFUTED', `${decoy.claim}`);
});

test('a confident wrong control assertion refutes a real single-source bug; the eval counts it as lost', async () => {
  const { expected, status } = await debateGolden('solana-vault', 2);
  const misjudged = expected.bugs.find((bug) => bug.misjudgedBy);
  assert.equal(status(misjudged), 'REFUTED');
});

test('rounds: one devil per cluster, bad quotes discarded, a copied flip is suspect, round 3 only after a change', async () => {
  const { out, result } = await debateGolden('near-escrow', 3);
  for (const [id, row] of result.debated) {
    const devils = row.turns.filter((turn) => turn.round === 1 && turn.role === 'devil');
    assert.equal(devils.length, 1, id);
    const changed = row.turns.some((turn) => turn.round === 2 && turn.verdictChanged);
    assert.equal(row.turns.some((turn) => turn.round === 3), changed, id);
  }
  const citations = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'citations.json'), 'utf8'));
  assert.ok(citations.some((row) => row.reason === 'quote_not_found'));
  const turns = [...result.debated.values()].flatMap((row) => row.turns);
  assert.ok(turns.some((turn) => turn.conformitySuspect && !turn.discarded));
  const written = fs.readdirSync(path.join(out, 'debate'), { recursive: true }).filter((rel) => /^round-\d\//.test(rel)).map((rel) => fs.readFileSync(path.join(out, 'debate', rel), 'utf8')).join('\n');
  assert.equal(/scripted-|baseline|paranoid|lazy/.test(written), false);
  const anonymization = JSON.parse(fs.readFileSync(path.join(out, 'debate', 'anonymization.json'), 'utf8'));
  assert.ok(Object.keys(anonymization.clusters).length >= 2);
});

test('union and majority are computed from the same submissions', async () => {
  const { result, expected, panel } = await debateGolden('py-fastapi', 2);
  const submitters = new Set(panel.claims.map((c) => c.reviewerId)).size;
  const union = score(retainedBy('union', result.clusters), expected);
  const majority = score(retainedBy('majority', result.clusters, { submitters }), expected);
  const debate = score(retainedBy('debate', result.clusters, { adjudication: result.rows }), expected);
  assert.equal(union.retained, result.clusters.length);
  assert.ok(majority.retained < union.retained);
  assert.equal(debate.decoyHits, 0);
  assert.equal(decideDefaultRounds({ debate, union, majority }).rounds, 2);
  assert.equal(decideDefaultRounds({ debate: { ...debate, bugHits: union.bugHits - 2 }, union, majority }).rounds, 1);
});
