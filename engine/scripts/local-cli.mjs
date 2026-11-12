// One-command local review. Uses every installed reviewer CLI. Opus is the
// orchestrator when Claude is installed. A machine with only one CLI uses that
// model as both orchestrator and reviewer (Agy alone -> Argon).
// `--provider <id> --models <m1,...>` reviews with one API provider from the provider catalog
// (packages/schemas/providers.mjs: zai, openrouter, nearai) instead. The first model orchestrates and every
// model reviews. `--nearai <m1,...>` is shorthand for `--provider nearai --models <m1,...>`. The provider's
// key variable (for example NEARAI_API_KEY) is only checked for presence here; it reaches the reviewer process
// through `audit run`, never this file. `--with-clis` adds the installed CLIs as extra reviewers.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiProviders, isModelId, providerById, specFor } from '../../packages/schemas/providers.mjs';

export const LOCAL_CLIS = [
  { bin: 'claude', spec: 'cli:claude:opus' },
  { bin: 'codex', spec: 'cli:codex:gpt-6.1-sol' },
  { bin: 'grok', spec: 'cli:grok:grok-4.7' },
  { bin: 'agy', spec: 'cli:agy:gemini-4-argon-high' },
];

/** First matching executable on PATH. Does not run the CLI. */
export function findExecutable(bin, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // keep looking
    }
  }
  return null;
}

export function installedClis(env = process.env) {
  return LOCAL_CLIS.filter((cli) => findExecutable(cli.bin, env)).map((cli) => cli.bin);
}

/** Reviewers are every installed CLI, in LOCAL_CLIS order. Orchestrator prefers Opus. */
export function selectLocalPanel(installed) {
  const present = LOCAL_CLIS.filter((cli) => installed.includes(cli.bin));
  if (!present.length) return null;
  const opus = present.find((cli) => cli.bin === 'claude');
  return {
    reviewers: present.map((cli) => cli.spec),
    orchestrator: (opus ?? present[0]).spec,
  };
}

const API_IDS = () => apiProviders().map((provider) => provider.id).join(', ');
const PIPELINE_MODES = ['full', 'step-by-step', 'stage-1'];
const USAGE = 'usage: audit local [--repo <directory> | --github <owner/repo or url>] [--scope full|web2|web3|infra] '
  + '[--pipeline full|step-by-step|stage-1 | --step-by-step | --no-debate] [--concurrency <1-8>] '
  + '[--provider <zai|openrouter|nearai> --models <model,...> | --nearai <model,...>] [--with-clis]';

/** One API provider's panel: every named model reviews, the first orchestrates. `withClis` adds installed CLIs as reviewers. */
export function selectProviderPanel(providerId, models, { installed = [], withClis = false } = {}) {
  const api = models.map((model) => specFor(providerId, model));
  const clis = withClis ? LOCAL_CLIS.filter((cli) => installed.includes(cli.bin)).map((cli) => cli.spec) : [];
  return { reviewers: [...api, ...clis], orchestrator: api[0] };
}

function modelList(flag, value) {
  if (!value || value.startsWith('-')) throw new Error(`${flag} needs a model, or a comma-separated list`);
  const models = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  const bad = models.find((model) => !isModelId(model));
  if (bad !== undefined || !models.length) throw new Error(`${flag}: invalid model ${JSON.stringify(bad ?? value)}`);
  return models;
}

export function parseLocalArgs(argv) {
  const result = { repo: '', github: '', scope: '', provider: '', models: [], withClis: false, pipelineMode: '', concurrency: 0 };
  const setPipeline = (mode) => {
    if (!PIPELINE_MODES.includes(mode)) throw new Error(`--pipeline must be one of: ${PIPELINE_MODES.join(', ')}`);
    if (result.pipelineMode && result.pipelineMode !== mode) throw new Error(`conflicting pipeline flags (${result.pipelineMode} vs ${mode})`);
    result.pipelineMode = mode;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--with-clis') { result.withClis = true; continue; }
    if (flag === '--step-by-step') { setPipeline('step-by-step'); continue; }
    if (flag === '--no-debate') { setPipeline('stage-1'); continue; }
    if (flag === '--pipeline') {
      if (!value || value.startsWith('-')) throw new Error(`--pipeline needs one of: ${PIPELINE_MODES.join(', ')}`);
      setPipeline(value);
      i += 1;
      continue;
    }
    if (flag === '--concurrency') {
      const n = Number(value);
      if (!value || !Number.isInteger(n) || n < 1 || n > 8) throw new Error('--concurrency must be an integer 1–8');
      result.concurrency = n;
      i += 1;
      continue;
    }
    if (flag === '--nearai') {
      if (result.provider && result.provider !== 'nearai') throw new Error('--nearai cannot be combined with another --provider');
      result.provider = 'nearai';
      result.models = modelList(flag, value);
      i += 1;
      continue;
    }
    if (flag === '--provider') {
      if (!value || value.startsWith('-')) throw new Error(`--provider needs one of: ${API_IDS()}`);
      if (providerById(value)?.transport !== 'openai-chat') throw new Error(`--provider: unknown API provider ${JSON.stringify(value)} (one of: ${API_IDS()})`);
      if (result.provider && result.provider !== value) throw new Error('pass one --provider');
      result.provider = value;
      i += 1;
      continue;
    }
    if (flag === '--models') {
      result.models = modelList(flag, value);
      i += 1;
      continue;
    }
    if (flag === '--repo' || flag === '--github' || flag === '--scope') {
      if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value`);
      result[flag.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new Error(USAGE);
  }
  if (result.repo && result.github) throw new Error('pass --repo or --github, not both');
  if (result.provider && !result.models.length) throw new Error(`--provider ${result.provider} needs --models <model,...>`);
  if (!result.provider && result.models.length) throw new Error('--models needs --provider <id>');
  if (result.withClis && !result.provider) throw new Error('--with-clis only applies with --provider or --nearai');
  return result;
}

export function localAuditArgs(panel, target) {
  const args = ['run', ...(target.github ? ['--github', target.github] : ['--repo', target.repo || '.']),
    '--reviewers', panel.reviewers.join(','), '--orchestrator', panel.orchestrator, '--assign', 'matrix',
    ...(target.scope ? ['--scope', target.scope] : []),
    ...(target.pipelineMode ? ['--pipeline', target.pipelineMode] : []),
    ...(target.concurrency ? ['--concurrency', String(target.concurrency)] : [])];
  return args;
}

function main() {
  let target;
  try {
    target = parseLocalArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  const installed = installedClis();
  const provider = target.provider ? providerById(target.provider) : null;
  if (provider && process.env.OMNI_LIVE !== '1') {
    process.stderr.write(`--provider ${provider.id} makes real, billed ${provider.label} calls. Opt in with OMNI_LIVE=1, for example:\n  OMNI_LIVE=1 ./bin/audit local --provider ${provider.id} --models ${target.models.join(',')}\n`);
    process.exit(1);
  }
  if (provider && !process.env[provider.keyEnv]) {
    process.stderr.write(`--provider ${provider.id} needs ${provider.keyEnv} in your environment (a ${provider.label} key). ${provider.dataPolicy}\n`);
    process.exit(1);
  }
  const panel = provider ? selectProviderPanel(provider.id, target.models, { installed, withClis: target.withClis }) : selectLocalPanel(installed);
  if (!panel) {
    process.stderr.write('No local reviewer CLI is installed. Install one of: claude, codex, grok, agy.\n');
    process.exit(1);
  }
  const args = localAuditArgs(panel, target);
  if (provider) process.stderr.write(`${provider.dataPolicy}\n`);
  process.stderr.write(`Local review\n  reviewers: ${panel.reviewers.join(', ')}\n  orchestrator: ${panel.orchestrator}\n`);
  const audit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/audit');
  const child = spawn(audit, args, { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
