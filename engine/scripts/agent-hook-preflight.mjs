import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// R-08. AGY runs with --dangerously-skip-permissions, so the PreToolUse hook is the only thing that refuses a host tool.
// Before a session starts, run the configured hook command itself on a denied tool call and on the one allowed MCP call.
// A missing, edited-out or non-denying hook makes AGY unavailable (fail closed) instead of silently unprotected.
// This proves the hook is wired and discriminating. It cannot prove that the AGY binary calls it; that needs a live AGY
// run and stays an owner check (docs/plan/checks/w02-check.md).
const DENIED = { toolCall: { name: 'run_command', args: { CommandLine: 'id' } } };
const ALLOWED = { toolCall: { name: 'call_mcp_tool', args: { ServerName: 'audit_docker', ToolName: 'read_file' } } };

function decide(command, input, run) {
  const result = run('/bin/sh', ['-c', command], { input: JSON.stringify(input), encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout).decision ?? null; } catch { return null; }
}

export function agyHookPreflight({ hooksFile, run = spawnSync } = {}) {
  const unavailable = detail => ({ state: 'unavailable', reason: 'hook_not_enforced', detail });
  let config;
  try { config = JSON.parse(fs.readFileSync(hooksFile, 'utf8')); } catch { return unavailable('hooks.json is missing or unreadable'); }
  const entries = Object.values(config ?? {}).flatMap(group => Array.isArray(group?.PreToolUse) ? group.PreToolUse : []);
  const commands = entries.flatMap(entry => (entry?.hooks ?? []).filter(hook => hook?.type === 'command' && typeof hook.command === 'string').map(hook => hook.command));
  if (entries.length !== 1 || commands.length !== 1 || entries[0].matcher !== '.*') return unavailable('expected exactly one catch-all PreToolUse command hook');
  if (!/audit-tool-policy\.mjs/.test(commands[0])) return unavailable('the PreToolUse hook is not the audit tool policy');
  if (decide(commands[0], DENIED, run) !== 'deny') return unavailable('the hook did not refuse a host command tool');
  if (decide(commands[0], ALLOWED, run) !== 'allow') return unavailable('the hook did not allow the review bridge tool');
  return { state: 'ready' };
}
