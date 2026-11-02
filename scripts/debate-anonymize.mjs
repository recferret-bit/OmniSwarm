// Relabel reviewers to Reviewer A/B/C. The map is recorded and never put in a judge brief.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function mix(seed, text) {
  let h = Number(seed) || 1;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function anonymize(ids, seed = 1) {
  const order = [...ids].sort((a, b) => mix(seed, a) - mix(seed, b) || String(a).localeCompare(String(b)));
  const map = {};
  order.forEach((id, index) => { map[id] = `Reviewer ${LETTERS[index] || '?'}`; });
  return { seed, map };
}

export function stripIdentity(text) {
  return String(text || '').replace(/claude|codex|grok|glm|qwen|gemini|anthropic|openai|alibaba|scripted-[a-z]+/gi, 'a reviewer');
}
