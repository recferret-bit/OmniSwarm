import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkWorkflow, jobs } from './workflow-policy.mjs';

const SHA = 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';
const GOOD = `name: deploy
on:
  push:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  plan:
    if: github.event_name == 'push'
    steps:
      - uses: ${SHA}
      - run: bash infra/deploy/deploy.sh --dry-run x HEAD
  deploy:
    if: github.event_name == 'workflow_dispatch'
    environment: production
    steps:
      - name: Deploy
        env:
          KEY: \${{ secrets.DEPLOY_SSH_KEY }}
        run: bash infra/deploy/deploy.sh h "$TAG"
`;

test('the shipped deploy workflow passes', () => {
  const text = fs.readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.deepEqual(checkWorkflow(text), []);
  assert.deepEqual(Object.keys(jobs(text)), ['plan', 'deploy']);
});

test('a minimal good workflow passes', () => {
  assert.deepEqual(checkWorkflow(GOOD), []);
});

test('a pull_request trigger is an error', () => {
  const errors = checkWorkflow(GOOD.replace('  push:\n', '  push:\n  pull_request:\n'));
  assert.ok(errors.includes('deploy workflow must not run on pull_request, pull_request_target or workflow_run'), errors.join('\n'));
});

test('secrets in a job outside the protected environment are errors', () => {
  const errors = checkWorkflow(GOOD.replace('      - run: bash infra/deploy/deploy.sh --dry-run x HEAD', '      - env:\n          K: ${{ secrets.DEPLOY_SSH_KEY }}\n        run: x'));
  assert.ok(errors.includes('job plan reads secrets but is not workflow_dispatch-only in environment production'), errors.join('\n'));
  assert.ok(errors.includes('job plan has no environment and reads secrets'), errors.join('\n'));
});

test('an expression inline in run:, an unpinned action and a write permission are errors', () => {
  const bad = GOOD.replace('bash infra/deploy/deploy.sh h "$TAG"', 'bash infra/deploy/deploy.sh h ${{ inputs.tag }}')
    .replace(SHA, 'actions/checkout@v4').replace('  contents: read', '  contents: write');
  const errors = checkWorkflow(bad);
  assert.ok(errors.some((e) => e.startsWith('expression outside an env entry: run: bash infra/deploy/deploy.sh h ${{ inputs.tag }}')), errors.join('\n'));
  assert.ok(errors.includes('action not pinned to a commit SHA: actions/checkout@v4'), errors.join('\n'));
  assert.ok(errors.includes('top-level permissions must be exactly `contents: read`'), errors.join('\n'));
});
