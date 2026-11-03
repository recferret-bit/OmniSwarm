// Reviewer specs: <family>:<provider>:<model>[#label]. ORCHESTRATION section 1.
// A reviewer has an id, a family (how it is launched), a provider (which CLI/API inside the family),
// a vendor (who trained the model; used for peer and judge conflict rules) and a model.
// Adapter names appear in this file only as the vendor table and the default models.
import { sha256Hex } from './hash-util.mjs';
import { validate } from '../../packages/schemas/index.mjs';

export class ReviewerError extends Error {
  constructor(code, message) { super(message || code); this.name = 'ReviewerError'; this.code = code; }
}

export const FAMILIES = ['cli', 'key', 'openrouter', 'nearai', 'scripted'];

// Default model per cli provider when only an adapter name is given (--agents claude).
// Kept here, not in shell, so every entry point agrees (ORCHESTRATION section 1 "Defaults").
// Key order is the default reviewer order of `audit run` without --agents/--reviewers.
export const CLI_DEFAULT_MODELS = Object.freeze({
  claude: 'opus', grok: 'grok-4.7', agy: 'gemini-4-argon-high', codex: 'gpt-6.1-sol',
});

const CLI_VENDORS = { claude: 'anthropic', 'claude-zai': 'zai', codex: 'openai', grok: 'xai', agy: 'google' };
const ORG_VENDORS = { anthropic: 'anthropic', openai: 'openai', 'x-ai': 'xai', xai: 'xai', google: 'google', qwen: 'alibaba', 'z-ai': 'zai' };

const MAX_ID = 64;

// Lowercase, `/ . :` and any other character outside [a-z0-9-] become `-`, runs collapse, <= 64 chars.
export function reviewerId(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new ReviewerError('REVIEWER_SPEC_INVALID', 'reviewer id is empty after slugging');
  if (slug.length <= MAX_ID) return slug;
  const tag = sha256Hex(slug).slice(0, 6);
  return `${slug.slice(0, MAX_ID - 7).replace(/-+$/, '')}-${tag}`;
}

// vendorOf(spec) works on a spec string or a parsed reviewer.
export function vendorOf(reviewer) {
  const r = typeof reviewer === 'string' ? splitSpec(reviewer) : reviewer;
  if (r.family === 'cli') return CLI_VENDORS[r.provider] || r.provider;
  if (r.family === 'key') return r.provider;
  if (r.family === 'nearai') return 'nearai';
  if (r.family === 'scripted') return 'scripted';
  if (r.family === 'openrouter') {
    return vendorOfOpenRouterModel(r.model);
  }
  return r.provider;
}

// OpenRouter slugs are <org>/<model>; the org names the vendor. A slug without an org is 'openrouter'.
export function vendorOfOpenRouterModel(model) {
  const text = String(model || '');
  if (!text.includes('/')) return 'openrouter';
  const org = text.split('/')[0].toLowerCase();
  return ORG_VENDORS[org] || org.replace(/[^a-z0-9-]+/g, '-');
}

function splitSpec(text) {
  if (typeof text !== 'string') throw new ReviewerError('REVIEWER_SPEC_INVALID', 'reviewer spec must be a string');
  const check = validate('reviewer-spec', text);
  if (!check.ok) throw new ReviewerError('REVIEWER_SPEC_INVALID', `invalid reviewer spec "${text.slice(0, 80)}": expected <family>:<provider>:<model>[#label]`);
  const [body, label] = text.split('#');
  const first = body.indexOf(':');
  const family = body.slice(0, first);
  const rest = body.slice(first + 1);
  if (family === 'cli' || family === 'key') {
    const cut = rest.indexOf(':');
    return { family, provider: rest.slice(0, cut), model: rest.slice(cut + 1), ...(label ? { label } : {}) };
  }
  if (family === 'scripted') {
    const [strategy, name] = rest.split(':');
    return { family, provider: strategy, model: name || strategy, ...(label ? { label } : {}) };
  }
  return { family, provider: family, model: rest, ...(label ? { label } : {}) };
}

export function parseReviewerSpec(text) {
  const parts = splitSpec(text);
  const slugSource = parts.label || (parts.family === 'scripted' ? `scripted-${parts.provider}${parts.model !== parts.provider ? `-${parts.model}` : ''}` : parts.family === 'cli' || parts.family === 'key' ? `${parts.family}-${parts.provider}-${parts.model}` : `${parts.family}-${parts.model}`);
  const reviewer = { id: reviewerId(slugSource), family: parts.family, provider: parts.provider, vendor: vendorOf(parts), model: parts.model, ...(parts.label ? { label: parts.label } : {}) };
  const check = validate('reviewer-spec', reviewer);
  if (!check.ok) throw new ReviewerError('REVIEWER_SPEC_INVALID', `reviewer ${reviewer.id} fails the reviewer-spec schema: ${check.errors[0]}`);
  return reviewer;
}

export function formatReviewerSpec(reviewer) {
  const { family, provider, model, label } = reviewer;
  const body = family === 'cli' || family === 'key' ? `${family}:${provider}:${model}`
    : family === 'scripted' ? (model === provider ? `scripted:${provider}` : `scripted:${provider}:${model}`)
    : `${family}:${model}`;
  return label ? `${body}#${label}` : body;
}

// Parse a list; ids must be unique (REVIEWER_DUPLICATE). Strings or already-parsed reviewers are accepted.
export function parseReviewerList(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).map((s) => (typeof s === 'string' ? parseReviewerSpec(s) : s));
  assertUniqueReviewers(list);
  return list;
}

export function assertUniqueReviewers(list) {
  const seen = new Set();
  for (const reviewer of list) {
    if (seen.has(reviewer.id)) throw new ReviewerError('REVIEWER_DUPLICATE', `Duplicate reviewer: ${reviewer.id}. Give one of them a #label.`);
    seen.add(reviewer.id);
  }
  return list;
}

// Same character set and length as a model in a reviewer spec (packages/schemas reviewer-spec), so an
// OpenRouter slug such as `qwen/qwen3.8-max-0902` is accepted. A path segment of `.` or `..`, or a leading
// or trailing `/`, is refused: the model is a label, never a path. Session stores and submission
// identities both use this check.
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,128}$/;
export function validModelId(model) {
  return typeof model === 'string' && MODEL_ID.test(model) && model.split('/').every((part) => part && part !== '.' && part !== '..');
}

// Reviewer-id pattern used wherever a reviewer id is embedded in a job or file name.
export const REVIEWER_ID_PATTERN = '[a-z0-9][a-z0-9-]{0,80}';
export const isReviewerId = (value) => typeof value === 'string' && new RegExp(`^${REVIEWER_ID_PATTERN}$`).test(value);

// Legacy reports (before reviewers existed) list adapter names in meta.agents and models in meta.models.
// Their reviewer id is the adapter name. Reports with meta.reviewers use those entries as written.
export function reviewersOfMeta(meta) {
  if (Array.isArray(meta?.reviewers) && meta.reviewers.length) return meta.reviewers;
  if (!Array.isArray(meta?.agents)) return [];
  return meta.agents.filter((agent) => typeof agent === 'string').map((agent) => {
    const model = meta.models?.[agent];
    const reviewer = { id: agent, family: 'cli', provider: agent, model: typeof model === 'string' && model ? model : CLI_DEFAULT_MODELS[agent] || 'unknown' };
    return { ...reviewer, vendor: vendorOf(reviewer) };
  });
}

// Reviewer that authored an auditor/job name such as "<id>-s2-input" (id may contain hyphens).
export function reviewerOfJob(name, reviewers) {
  const match = /^(.+)-s[1-6]-[a-z]+$/.exec(String(name));
  if (!match) return null;
  return reviewers.find((r) => r.id === match[1]) || null;
}

// Vendor of a job name or crosscheck reviewer id, given the report's reviewers (null when unknown).
export function vendorOfJob(name, reviewers) {
  return reviewerOfJob(name, reviewers)?.vendor || reviewers.find((r) => r.id === name)?.vendor || null;
}

// Convenience for the old flags: --agents a,b with an optional model map -> cli specs.
export function cliSpecsFromAgents(agents, models = {}) {
  return agents.map((agent) => {
    if (!Object.hasOwn(CLI_DEFAULT_MODELS, agent)) throw new ReviewerError('REVIEWER_SPEC_INVALID', `Unknown agent: ${agent} (valid: ${Object.keys(CLI_DEFAULT_MODELS).join(', ')})`);
    return `cli:${agent}:${models[agent] || CLI_DEFAULT_MODELS[agent]}`;
  });
}
