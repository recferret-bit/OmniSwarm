import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWaves, openCheck, openCommands, landCommands } from './wave.mjs';

const waves = loadWaves();
const w = (n) => waves.find((x) => x.id === n);

test('reads all 15 wave headers and their hard dependencies', () => {
  assert.equal(waves.length, 15);
  assert.deepEqual(w('00').deps, []);
  assert.deepEqual(w('03').deps, ['01']);
  assert.deepEqual(w('06').deps, ['02', '03', '05']);
  assert.deepEqual(w('07').deps, ['05']);
  assert.deepEqual(w('09').deps, ['08']);
  assert.deepEqual(w('13').deps, ['08', '10']);
});

test('open refuses a wave whose dependencies are not tagged', () => {
  const none = () => false;
  assert.equal(openCheck(w('06'), none).message, 'W06 waits for W02, W03, W05 in main');
  assert.equal(openCheck(w('06'), (d) => ['02', '03', '05'].includes(d)).ok, true);
  assert.equal(openCheck(w('06'), (d) => d !== '03').message, 'W06 waits for W03 in main');
  assert.equal(openCheck(w('00'), none).ok, true);
});

test('prints the section 7 commands', () => {
  assert.deepEqual(openCommands(w('03')), ['git worktree add ../OmniSwarm-wt/w03 -b wave/w03-api-reviewers main']);
  const land = landCommands(w('03')).join('\n');
  assert.match(land, /git merge --no-ff wave\/w03-api-reviewers -m "W03 API Reviewers" && git tag wave-03 && git push origin main --tags/);
  assert.match(land, /npm run check:all && npm run check:w03/);
});
