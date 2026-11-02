import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCall } from './bridge-budget.mjs';
import { runToolLoop } from './provider-openai-compat.mjs';

const FAMILIES = ['cli', 'key', 'openrouter', 'scripted'];

function bridgePass(toolBudget) {
  let record = { calls: 0, graceUsed: 0, filesRead: [] };
  let steps = 0;
  while (steps < toolBudget + 10) {
    steps += 1;
    const decision = decideCall(record, { tool: 'read_file', path: `f${steps}.rs`, toolBudget });
    record = decision.record;
    if (decision.error) break;
    if (decision.text) {
      const submit = decideCall(record, { tool: 'submit_audit_report', toolBudget });
      return { calls: submit.record.calls, submitted: true };
    }
  }
  return { calls: record.calls, submitted: false };
}

test('every family stays within N+3 calls for each pass count', async () => {
  const cases = [];
  for (const family of FAMILIES) {
    for (const passes of [1, 2, 3]) {
      for (const toolBudget of [2, 5]) {
        const rows = [];
        for (let pass = 1; pass <= passes; pass++) {
          if (family === 'key' || family === 'openrouter') {
            let turn = 0;
            const result = await runToolLoop({
              baseUrl: 'https://example.invalid/v1', apiKey: 'k', model: 'm', tools: [], maxTurns: toolBudget + 3,
              callTool: async () => 'ok', brief: 'review', sleep: async () => {},
              fetchImpl: async () => {
                turn += 1;
                const last = turn === toolBudget + 3;
                const body = last
                  ? { model: 'm', choices: [{ message: { content: 'stop' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
                  : { model: 'm', choices: [{ message: { tool_calls: [{ id: `c${turn}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
                return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
              },
            });
            assert.ok(result.turns <= toolBudget + 3, family);
            rows.push(result.turns);
          } else {
            const row = bridgePass(toolBudget);
            assert.ok(row.calls <= toolBudget + 3);
            assert.equal(row.submitted, true);
            rows.push(row.calls);
          }
        }
        assert.equal(rows.length, passes);
        cases.push(family);
      }
    }
  }
  assert.equal(cases.length, 24);
});
