// One-command local review. Uses every installed reviewer CLI. Opus is the
// orchestrator when Claude is installed. A machine with only one CLI uses that
// model as both orchestrator and reviewer (Agy alone -> Argon).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

export function parseLocalArgs(argv) {
  const result = { repo: '', github: '', scope: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--repo' || flag === '--github' || flag === '--scope') {
      if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value`);
      result[flag.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new Error('usage: audit local [--repo <directory> | --github <owner/repo or url>] [--scope full|web2|web3|infra]');
  }
  if (result.repo && result.github) throw new Error('pass --repo or --github, not both');
  return result;
}

export function localAuditArgs(panel, target) {
  const args = ['run', ...(target.github ? ['--github', target.github] : ['--repo', target.repo || '.']),
    '--reviewers', panel.reviewers.join(','), '--orchestrator', panel.orchestrator, '--assign', 'matrix',
    ...(target.scope ? ['--scope', target.scope] : [])];
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
  const panel = selectLocalPanel(installedClis());
  if (!panel) {
    process.stderr.write('No local reviewer CLI is installed. Install one of: claude, codex, grok, agy.\n');
    process.exit(1);
  }
  const args = localAuditArgs(panel, target);
  process.stderr.write(`Local review\n  reviewers: ${panel.reviewers.join(', ')}\n  orchestrator: ${panel.orchestrator}\n`);
  const audit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/audit');
  const child = spawn(audit, args, { stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
