import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWaves, openCheck, openCommands, landCommands } from './wave.mjs';

const waves = loadWaves();
const w = (n) => waves.find((x) => x.id === n);

test('reads all 31 wave headers and their hard dependencies', () => {
  assert.equal(waves.length, 31);
  assert.deepEqual(w('00').deps, []);
  assert.deepEqual(w('03').deps, ['01']);
  assert.deepEqual(w('06').deps, ['02', '03', '05']);
  assert.deepEqual(w('07').deps, ['05']);
  assert.deepEqual(w('09').deps, ['08']);
  assert.deepEqual(w('13').deps, ['08', '10']);
});

test('reads the debate and orchestrator v2 series (W20-W30) and its hard dependencies only', () => {
  assert.deepEqual(w('20').deps, []);
  assert.deepEqual(w('21').deps, ['20']);
  assert.deepEqual(w('22').deps, ['20']);
  assert.deepEqual(w('23').deps, ['20']);
  assert.deepEqual(w('24').deps, ['20', '23']);
  assert.deepEqual(w('25').deps, ['20', '21', '22', '23']);
  assert.deepEqual(w('26').deps, ['25', '23']);
  assert.deepEqual(w('27').deps, ['21', '24']);
  assert.deepEqual(w('28').deps, ['21', '22', '23', '24']);
  assert.deepEqual(w('29').deps, ['25', '26']);
  assert.deepEqual(w('30').deps, ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']);
});

test('the v2 series cannot open before its dependencies are tagged', () => {
  const tagged = (list) => (d) => list.includes(d);
  assert.equal(openCheck(w('20'), tagged([])).ok, true);
  assert.equal(openCheck(w('22'), tagged([])).message, 'W22 waits for W20 in main');
  assert.equal(openCheck(w('25'), tagged(['20', '21'])).message, 'W25 waits for W22, W23 in main');
  assert.equal(openCheck(w('26'), tagged(['25'])).message, 'W26 waits for W23 in main');
  assert.equal(openCheck(w('30'), tagged(['20', '21', '22', '23', '24', '25', '26', '27', '28'])).message, 'W30 waits for W29 in main');
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
