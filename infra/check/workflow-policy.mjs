// Policy over .github/workflows/deploy.yml (W12-15), on top of actionlint's schema and
// shellcheck pass:
//   - never triggered by pull_request, pull_request_target or workflow_run
//   - a job that reads a secret runs only on workflow_dispatch, in the `production` environment
//   - a job without an environment reads no secret (the push-time dry-run job)
//   - ${{ }} expressions appear only as `NAME: ${{ ... }}` env entries, never inline in run:
//   - every action is pinned to a commit SHA; the token is read-only
//
//   node infra/check/workflow-policy.mjs <workflow.yml>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_TRIGGERS = /^\s*-?\s*(pull_request|pull_request_target|workflow_run)\b/m;
const ENV_EXPRESSION = /^\s+[A-Z][A-Z0-9_]*: \$\{\{ [^}]+ \}\}$/;

// Top-level jobs: `  <name>:` lines under `jobs:` and the lines that follow them.
export function jobs(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === 'jobs:');
  const out = {};
  let current = null;
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (head) { current = head[1]; out[current] = []; continue; }
    if (current && /^\S/.test(line)) current = null;
    if (current) out[current].push(line);
  }
  return out;
}

export function checkWorkflow(text) {
  const errors = [];
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line));
  const onBlock = [];
  for (const line of code.slice(code.findIndex((l) => /^on:/.test(l)))) {
    if (onBlock.length && /^\S/.test(line)) break;
    onBlock.push(line);
  }
  if (FORBIDDEN_TRIGGERS.test(onBlock.join('\n')) || /^on:.*\b(pull_request|workflow_run)/m.test(text)) {
    errors.push('deploy workflow must not run on pull_request, pull_request_target or workflow_run');
  }
  if (!/^permissions:\n {2}contents: read$/m.test(text)) errors.push('top-level permissions must be exactly `contents: read`');
  if (/:\s*write\b/.test(code.join('\n'))) errors.push('no job may ask for a write permission');
  for (const line of code) {
    if (line.includes('${{') && !ENV_EXPRESSION.test(line)) errors.push(`expression outside an env entry: ${line.trim()}`);
    const uses = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
    if (uses && !/@[0-9a-f]{40}$/.test(uses[1])) errors.push(`action not pinned to a commit SHA: ${uses[1]}`);
  }
  const all = jobs(text);
  if (!Object.keys(all).length) errors.push('no jobs found');
  for (const [name, body] of Object.entries(all)) {
    const block = body.filter((line) => !/^\s*#/.test(line)).join('\n');
    const secrets = /\bsecrets\./.test(block);
    const environment = /^ {4}environment: (\S+)$/m.exec(block)?.[1];
    const dispatchOnly = /^ {4}if: github\.event_name == 'workflow_dispatch'$/m.test(block);
    if (secrets && !(environment === 'production' && dispatchOnly)) {
      errors.push(`job ${name} reads secrets but is not workflow_dispatch-only in environment production`);
    }
    if (!environment && secrets) errors.push(`job ${name} has no environment and reads secrets`);
  }
  return errors;
}

function main([file]) {
  const errors = checkWorkflow(fs.readFileSync(file, 'utf8'));
  for (const e of errors) console.log(`  error: ${e}`);
  console.log(`  workflow policy (${file}): ${errors.length ? 'FAILED' : 'ok'}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
