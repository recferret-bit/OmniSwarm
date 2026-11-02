import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeAnswer, runStrategy } from './scripted-strategies.mjs';

test('scripted strategies read cited files and submit; judge answers come from the fixture', async () => {
  const calls = [];
  const callTool = async (name, args) => { calls.push({ name, args }); return 'ok'; };
  await runStrategy('baseline', { callTool, surface: 'S1' });
  assert.ok(calls.some((call) => call.name === 'read_file' && call.args.path === 'src/lib.rs'));
  assert.equal(calls.filter((call) => call.name === 'submit_audit_report').length, 1);
  const submitted = calls.find((call) => call.name === 'submit_audit_report').args.findings.map((finding) => finding.title);
  assert.deepEqual(submitted, ['Missing owner check in withdraw', 'ft_on_transfer does not check the token contract']);
  calls.length = 0;
  await runStrategy('lazy', { callTool, surface: 'S1' });
  assert.equal(calls[0].name, 'read_file');
  assert.equal(calls.at(-1).args.findings.length, 0);
  calls.length = 0;
  await runStrategy('wrong', { callTool, surface: 'S1' });
  assert.deepEqual(calls.at(-1).args.findings[0].location, ['src/lib.rs:25']);
  assert.deepEqual(judgeAnswer('Missing owner check in withdraw'), { status: 'CONFIRMED', title: 'Missing owner check in withdraw' });
  assert.equal(judgeAnswer('no such cluster').status, 'INSUFFICIENT_EVIDENCE');
});
