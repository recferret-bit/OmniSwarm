import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions } from './docker-mcp-bridge.mjs';
import { mapToolCall, toOpenAiTools, toolResultText } from './api-tool-schema.mjs';

test('auditor tool schemas drop top-level oneOf and keep the submit fields', () => {
  const tools = toOpenAiTools(toolDefinitions('auditor'));
  for (const tool of tools) {
    assert.equal(tool.function.parameters.oneOf, undefined);
    assert.equal(tool.function.parameters.anyOf, undefined);
  }
  const submit = tools.find((tool) => tool.function.name === 'submit_audit_report');
  assert.ok(submit.function.parameters.properties.findings);
  assert.ok(submit.function.parameters.properties.report_json);
  assert.deepEqual(mapToolCall({ function: { name: 'read_file', arguments: '{"path":"src/lib.rs"}' } }), { name: 'read_file', args: { path: 'src/lib.rs' } });
  assert.match(toolResultText({ isError: true, content: [{ type: 'text', text: 'path outside source' }] }), /path outside source/);
});
