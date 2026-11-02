// Bridge tool definitions to the function schema a chat-completions model calls.
// The bridge stays the validator: a top-level oneOf (submit's report_json | findings) is stripped
// so strict providers accept the schema, and a bad call comes back as text the model can correct.
export function strictParameters(schema) {
  const copy = JSON.parse(JSON.stringify(schema || { type: 'object', properties: {} }));
  delete copy.oneOf;
  delete copy.anyOf;
  return copy;
}

export function toOpenAiTools(definitions) {
  return definitions.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: strictParameters(tool.inputSchema),
    },
  }));
}

export function toolResultText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content.map((part) => part?.text || '') : [];
  const text = parts.join('\n') || result.message || '';
  return text;
}

export function mapToolCall(call) {
  let args = call?.function?.arguments ?? call?.arguments ?? {};
  if (typeof args === 'string') {
    try { args = args ? JSON.parse(args) : {}; }
    catch { return { name: call?.function?.name || call?.name, args: {}, error: `invalid tool arguments: ${args.slice(0, 200)}` }; }
  }
  return { name: call?.function?.name || call?.name, args: args && typeof args === 'object' ? args : {} };
}
