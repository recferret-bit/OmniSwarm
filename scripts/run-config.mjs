#!/usr/bin/env node
// Run configuration: omniswarm.config.json (or --config), presets, and flag precedence
// (flags > preset > config file > defaults). ORCHESTRATION sections 1 and 3, OD-03, OD-04.
// The config file is read from the operator's OmniSwarm checkout or an explicit --config path,
// never from the audited target.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../shared/schemas/index.mjs';
import { CLI_DEFAULT_MODELS, ReviewerError, cliSpecsFromAgents, formatReviewerSpec, parseReviewerList, parseReviewerSpec } from './reviewer-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CONFIG_NAME = 'omniswarm.config.json';
export const DEFAULTS = Object.freeze({ passes: 2, toolBudget: 40, debate: Object.freeze({ rounds: 2, toolBudget: 12, maxClusters: 25 }) });
export const MATRIX_LIMIT = 8;
const LEGACY_AGENTS = Object.keys(CLI_DEFAULT_MODELS);

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; this.code = 'CONFIG_INVALID'; }
}

export function loadConfigFile(file) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('not a regular file under 1 MiB');
    text = fs.readFileSync(file, 'utf8');
  } catch (error) { throw new ConfigError(`${file}: cannot read config (${error.message})`); }
  let json;
  try { json = JSON.parse(text); } catch (error) { throw new ConfigError(`${file}: invalid JSON (${error.message})`); }
  const check = validate('run-config', json);
  if (!check.ok) throw new ConfigError(`${file}: ${check.errors[0]}`);
  return json;
}

// Legacy model flags: --model-<agent> > --models a=x,b=y > --model > built-in default.
function legacyModels(flags) {
  const pairs = {};
  for (const pair of String(flags.models || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const cut = pair.indexOf('=');
    if (cut < 1) throw new ConfigError(`--models entry needs vendor=slug (${pair})`);
    const agent = pair.slice(0, cut);
    if (!Object.hasOwn(CLI_DEFAULT_MODELS, agent)) throw new ConfigError(`unknown vendor in --models: ${agent} (${Object.keys(CLI_DEFAULT_MODELS).join(', ')})`);
    pairs[agent] = pair.slice(cut + 1);
  }
  const model = {};
  for (const agent of Object.keys(CLI_DEFAULT_MODELS)) {
    const pick = flags.modelByAgent?.[agent] || pairs[agent] || flags.model || '';
    if (pick) model[agent] = pick;
  }
  return model;
}

const hasLegacyModelFlags = (flags) => Boolean(flags.model || flags.models || Object.values(flags.modelByAgent || {}).some(Boolean));

// Resolve flags + config into the effective run configuration.
// flags: {config, preset, reviewers, agents, model, models, modelByAgent, assign, orchestrator, alternateJudge, passes, toolBudget}
export function resolveRunConfig({ flags = {}, root = ROOT, explicitConfig = flags.config } = {}) {
  const file = explicitConfig ? path.resolve(explicitConfig) : path.join(root, CONFIG_NAME);
  let config = null;
  if (explicitConfig || fs.existsSync(file)) config = loadConfigFile(file);
  let layer = {};
  if (flags.preset) {
    const preset = config?.presets?.[flags.preset];
    if (!preset) throw new ConfigError(config
      ? `${file}: unknown preset "${flags.preset}" (have: ${Object.keys(config.presets || {}).join(', ') || 'none'})`
      : `--preset ${flags.preset} needs a config file; copy omniswarm.config.example.json to ${CONFIG_NAME} or pass --config`);
    layer = preset;
  }
  const pick = (key) => (layer[key] !== undefined ? layer[key] : config?.[key]);

  if (flags.reviewers && flags.agents) throw new ConfigError('use --reviewers or --agents, not both');
  let specs; let from;
  if (flags.reviewers) { specs = String(flags.reviewers).split(',').map((s) => s.trim()).filter(Boolean); from = 'flag'; }
  else if (flags.agents) {
    const names = String(flags.agents).split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new ConfigError('no reviewers requested');
    specs = cliSpecsFromAgents(names, legacyModels(flags)); from = 'agents';
  } else if (pick('reviewers')) { specs = pick('reviewers'); from = layer.reviewers ? 'preset' : 'config'; }
  else { specs = cliSpecsFromAgents(LEGACY_AGENTS, legacyModels(flags)); from = 'default'; }
  if (!specs.length) throw new ConfigError('no reviewers requested');
  let reviewers = parseReviewerList(specs);
  if (hasLegacyModelFlags(flags) && from !== 'agents' && from !== 'default') {
    const models = legacyModels(flags);
    reviewers = parseReviewerList(reviewers.map((r) => formatReviewerSpec(r.family === 'cli' && models[r.provider] ? { ...r, model: models[r.provider] } : r)));
  }

  const number = (name, value) => { if (value === undefined || value === '') return undefined; const n = Number(value); if (!Number.isInteger(n)) throw new ConfigError(`${name} must be an integer`); return n; };
  const merged = {
    reviewers: reviewers.map(formatReviewerSpec),
    ...(flags.orchestrator || pick('orchestrator') ? { orchestrator: flags.orchestrator || pick('orchestrator') } : {}),
    ...(flags.alternateJudge || pick('alternateJudge') ? { alternateJudge: flags.alternateJudge || pick('alternateJudge') } : {}),
    ...((flags.assign || pick('assign')) ? { assign: flags.assign || pick('assign') } : {}),
    passes: number('--passes', flags.passes) ?? pick('passes') ?? DEFAULTS.passes,
    toolBudget: number('--tool-budget', flags.toolBudget) ?? pick('toolBudget') ?? DEFAULTS.toolBudget,
    grace: 3,
    ...(pick('debate') ? { debate: pick('debate') } : {}),
    ...(flags.maxCostUsd !== undefined ? { maxCostUsd: Number(flags.maxCostUsd) } : pick('maxCostUsd') !== undefined ? { maxCostUsd: Number(pick('maxCostUsd')) } : {}),
    ...(pick('prices') ? { prices: pick('prices') } : {}),
  };
  if (!Number.isInteger(merged.passes) || merged.passes < 1 || merged.passes > 5) throw new ConfigError('passes must be 1–5');
  if (!Number.isInteger(merged.toolBudget) || merged.toolBudget < 5 || merged.toolBudget > 200) throw new ConfigError('tool budget must be 5–200');
  const check = validate('run-config', merged);
  if (!check.ok) throw new ConfigError(`invalid run configuration: ${check.errors[0]}`);

  const warnings = [];
  let assign = merged.assign;
  if (!assign) {
    // A run that names no reviewer list keeps today's one-reviewer-per-surface split; a run that does gets the matrix.
    if (from === 'agents' || from === 'default') assign = 'round-robin';
    else if (reviewers.length <= MATRIX_LIMIT) assign = 'matrix';
    else { assign = 'round-robin'; warnings.push(`${reviewers.length} reviewers exceed ${MATRIX_LIMIT}: using --assign round-robin to bound cost`); }
  }
  return {
    reviewers,
    reviewersFrom: from,
    orchestrator: merged.orchestrator === 'recommended' ? 'recommended' : merged.orchestrator ? parseReviewerSpec(merged.orchestrator) : null,
    alternateJudge: merged.alternateJudge ? parseReviewerSpec(merged.alternateJudge) : null,
    assign,
    budgets: { passes: merged.passes, toolBudget: merged.toolBudget, debate: { ...DEFAULTS.debate, ...(merged.debate || {}) }, maxCostUsd: merged.maxCostUsd ?? null },
    prices: merged.prices || null,
    preset: flags.preset || null,
    configFile: config ? file : null,
    warnings,
  };
}

// ---- CLI: node run-config.mjs resolve [flags] -> JSON on stdout, errors on stderr, exit 2 ----
export function parseFlags(argv) {
  const flags = { modelByAgent: {} };
  const take = (i) => { if (i + 1 >= argv.length) throw new ConfigError(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    const key = { '--config': 'config', '--preset': 'preset', '--reviewers': 'reviewers', '--agents': 'agents', '--model': 'model', '--models': 'models', '--assign': 'assign', '--orchestrator': 'orchestrator', '--alternate-judge': 'alternateJudge', '--passes': 'passes', '--tool-budget': 'toolBudget', '--max-cost-usd': 'maxCostUsd' }[arg];
    if (key) { flags[key] = take(i); continue; }
    const legacy = /^--model-([a-z]+)$/.exec(arg);
    if (legacy && Object.hasOwn(CLI_DEFAULT_MODELS, legacy[1])) { flags.modelByAgent[legacy[1]] = take(i); continue; }
    throw new ConfigError(`unknown option ${arg}`);
  }
  return flags;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'resolve') { process.stderr.write('usage: run-config.mjs resolve [--config f] [--preset p] [--reviewers a,b | --agents a,b] [--model* ...] [--assign m] [--orchestrator o] [--alternate-judge j] [--passes n] [--tool-budget n]\n'); process.exit(2); }
  try {
    const result = resolveRunConfig({ flags: parseFlags(rest) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (!(error instanceof ConfigError || error instanceof ReviewerError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
