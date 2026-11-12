// Relabel each cluster's participants Reviewer A/B/C with a seeded shuffle that differs per cluster, so a label
// cannot be linked across clusters. The map is recorded in debate/anonymization.json and never put in a brief.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function mix(seed, text) {
  let h = (Number(seed) || 1) >>> 0;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function anonymize(ids, seed = 1, clusterId = '') {
  const order = [...new Set(ids)].sort((a, b) => mix(seed, `${clusterId}:${a}`) - mix(seed, `${clusterId}:${b}`) || String(a).localeCompare(String(b)));
  if (order.length > LETTERS.length) throw new Error('too many debate participants for one cluster');
  return Object.fromEntries(order.map((id, index) => [id, `Reviewer ${LETTERS[index]}`]));
}

// Free-text scrub for arguments: model, vendor, provider and reviewer names become "a reviewer".
export function stripIdentity(text, names = []) {
  const extra = names.filter(Boolean).map((name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Model-family words are matched as whole words so ordinary text survives ("SOL" the token is not scrubbed).
  const families = ['opus', 'sonnet', 'haiku', 'chatgpt', 'gpt-?\\d[\\w.-]*', 'deepseek', 'mistral', 'llama', 'kimi', 'antigravity', 'openrouter', 'nearai'].map((word) => `\\b${word}\\b`);
  const pattern = new RegExp(['claude', 'codex', 'grok', 'glm', 'qwen', 'gemini', 'anthropic', 'openai', 'alibaba', 'xai', 'zai', 'scripted-[a-z]+', ...families, ...extra].join('|'), 'gi');
  return String(text || '').replace(pattern, 'a reviewer');
}
