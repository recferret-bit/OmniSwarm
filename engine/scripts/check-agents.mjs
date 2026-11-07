#!/usr/bin/env node
// Offline presence check for key, openrouter, claude-zai and scripted reviewers.
// Prints one row and never prints a key value. Exit 0 when every named reviewer is present.
import { resolveExecutable } from './agent-launch.mjs';
import { claudeMaxTurnsSupport, grokMaxTurnsSupport } from './provider-cli.mjs';
import { families } from './reviewer-families.mjs';
import { parseReviewerSpec } from './reviewer-registry.mjs';

export function claudeMaxTurnsLine(env = process.env) {
  return claudeMaxTurnsSupport(env) ? 'claude --max-turns: supported' : 'claude --max-turns: not supported (bridge gate only)';
}

export function grokMaxTurnsLine(env = process.env) {
  return grokMaxTurnsSupport(env) ? 'grok --max-turns: supported' : 'grok --max-turns: not supported (bridge gate only)';
}

export function checkReviewerRow(spec, env = process.env) {
  const reviewer = typeof spec === 'string' ? parseReviewerSpec(spec) : spec;
  if (reviewer.family === 'scripted') return { ok: true, line: 'scripted: ok' };
  const keyName = families.has(reviewer.family) ? families.fingerprintEnv(reviewer) : null;
  if (reviewer.family === 'cli' && reviewer.provider === 'claude-zai') {
    const cli = Boolean(resolveExecutable('claude', env));
    const key = Boolean(env[keyName]);
    if (cli && key) return { ok: true, line: `cli:claude-zai: claude CLI found, ${keyName} present` };
    return { ok: false, line: `cli:claude-zai: ${cli ? `${keyName} missing` : 'claude CLI missing'}` };
  }
  if (keyName && (reviewer.family === 'key' || reviewer.family === 'openrouter')) {
    const label = reviewer.family === 'openrouter' ? 'openrouter' : `key:${reviewer.provider}`;
    if (!env[keyName]) return { ok: false, line: `${label}: ${keyName} missing` };
    return { ok: true, line: `${label}: key present` };
  }
  const verdict = families.check(reviewer);
  return verdict.ok ? { ok: true, line: `${reviewer.id}: ok` } : { ok: false, line: `${reviewer.id}: ${verdict.reason}` };
}

function specsFromArgv(argv) {
  const specs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--reviewers') continue;
    specs.push(...String(argv[i + 1] || '').split(',').map((item) => item.trim()).filter(Boolean));
  }
  return specs;
}

function main() {
  const specs = specsFromArgv(process.argv.slice(2));
  if (!specs.length) {
    process.stderr.write('usage: check-agents.mjs --reviewers <spec,spec>\n');
    process.exit(2);
  }
  const rows = specs.map((spec) => checkReviewerRow(spec));
  for (const row of rows) process.stdout.write(`${row.line}\n`);
  process.stdout.write(`${claudeMaxTurnsLine()}\n`);
  process.stdout.write(`${grokMaxTurnsLine()}\n`);
  process.exit(rows.every((row) => row.ok) ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('check-agents.mjs')) main();
