import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validate } from '@omniswarm/schemas';
import { localJobView } from '../../src/modules/operator/local-job.service.ts';

const base = { id: '00000000-0000-4000-8000-000000000001', kind: 'path' as const, source: '/repos/a', ref: null, commit_sha: null, error: null, created_at: new Date('2026-11-10T12:00:00Z'), updated_at: new Date('2026-11-10T12:00:00Z') };
const config = { storage: { runsRoot: os.tmpdir() } } as never;

function outDir(snapshot?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-progress-'));
  if (snapshot) {
    fs.mkdirSync(path.join(dir, 'harness', 'host'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'harness', 'host', 'progress.json'), JSON.stringify(snapshot));
  }
  return dir;
}
const snapshot = { version: 1, state: 'running', phase: 'review', percent: 30, phases: [{ name: 'review', state: 'running' }], reviewers: [{ id: 'cli-claude-opus', state: 'running', jobsDone: 0, jobs: 6, passes: 2, pass: 1, calls: 9, budget: 40, surface: 'S2' }] };

test('a running local job carries the engine snapshot from its own out dir', () => {
  const view = localJobView(config, { ...base, status: 'running', out_dir: outDir(snapshot) } as never);
  assert.equal(view.progress?.phase, 'review');
  assert.equal(view.progress?.reviewer, 'cli-claude-opus');
  assert.ok(validate('intake-api#progress', view.progress).ok);
});

test('a queued job, a job with no snapshot yet, and a job with no out dir carry no progress', () => {
  for (const row of [{ status: 'queued', out_dir: outDir(snapshot) }, { status: 'running', out_dir: outDir() }, { status: 'running', out_dir: null }]) {
    assert.equal('progress' in localJobView(config, { ...base, ...row } as never), false, JSON.stringify(row.status));
  }
});
