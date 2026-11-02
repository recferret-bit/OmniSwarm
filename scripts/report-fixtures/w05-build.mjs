import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitSubmission } from '../audit-submission.mjs';
import { digest } from '../agent-session-store.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'w05-run');
fs.rmSync(out, { recursive: true, force: true });
const reviewers = [
  { id: 'cli-claude-opus', family: 'cli', provider: 'claude', vendor: 'anthropic', model: 'opus' },
  { id: 'key-zai-glm-5-3', family: 'key', provider: 'zai', vendor: 'zai', model: 'glm-5.3' },
  { id: 'openrouter-qwen-qwen3-8-max', family: 'openrouter', provider: 'openrouter', vendor: 'alibaba', model: 'qwen3.8-max-0902' },
  { id: 'scripted-baseline', family: 'scripted', provider: 'baseline', vendor: 'scripted', model: 'baseline' },
];
const surfaces = [['S1', 's1-auth', 'auth'], ['S2', 's2-input', 'input'], ['S3', 's3-logic', 'logic']];
const finding = (reviewer, surface, n) => ({
  title: `${reviewer.id} ${surface} finding ${n}`, surface, severity: 'high', confidence: 'confirmed',
  location: ['src/lib.rs:30'], impact: 'Fixture impact.', preconditions: 'Fixture.', analysis: 'The line omits the owner check.',
  validation: 'Source inspection.', attack: [], poc: '', fix: 'Compare the predecessor to the owner.',
});
const controls = { verified_safe: [] };
const put = (rel, value) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const jobs = [];
const scores = [];
for (const reviewer of reviewers) {
  for (const [surface, slug] of surfaces) {
    const name = `${reviewer.id}-${slug}`;
    const payload = [...(surface === 'S1' ? [] : [finding(reviewer, surface, 1)]), controls];
    if (surface === 'S1') {
      const assignment = { surface };
      const sourceDigest = 'a'.repeat(64);
      const identity = { name, agent: reviewer.id, role: 'auditor', model: reviewer.model, sourceDigest, assignmentDigest: digest(assignment), surface };
      commitSubmission(out, name, identity, payload, 'Fixture.');
      put(`harness/identities/${name}.json`, identity);
      put(`harness/assignments/${name}.json`, assignment);
    } else put(`submissions/${name}.json`, payload);
    jobs.push({ name, adapter: reviewer.id, surface, state: 'collected', turnCode: 0 });
    if (surface !== 'S1') scores.push({ title: payload[0].title, severity: 'high', surface, status: 'MODEL_ASSERTION', score: 40, claimIds: [`${name}#0`], locations: ['src/lib.rs:30'] });
    if (surface === 'S1') {
      put(`auditors/${name}.json`, payload);
      put(`auditors/${name}.md`, 'Source review only.\n');
    }
  }
  if (reviewer.id === 'key-zai-glm-5-3') {
    put('harness/usage/key-zai-glm-5-3/s1-pass-1.json', { k: 1, index: 1, role: 'discover', calls: 30, tokensIn: 10, tokensOut: 4, cost: 0.2, costSource: 'reported', stop: 'submitted', startedAt: '2026-11-02T00:00:00Z', endedAt: '2026-11-02T00:01:00Z' });
    put('harness/usage/key-zai-glm-5-3/s1-pass-2.json', { k: 2, index: 2, role: 'self-verify', calls: 33, tokensIn: 12, tokensOut: 5, cost: 0.21, costSource: 'reported', stop: 'submitted', startedAt: '2026-11-02T00:02:00Z', endedAt: '2026-11-02T00:03:00Z' });
  }
  if (reviewer.id === 'scripted-baseline') {
    put('harness/usage/scripted-baseline/s1-pass-1.json', { k: 1, calls: 4, tokensIn: 1, tokensOut: 1, cost: 0, costSource: 'none', stop: 'submitted', startedAt: '2026-11-02T00:00:00Z', endedAt: '2026-11-02T00:00:01Z' });
    put('harness/usage/scripted-baseline/s2-pass-1.json', { k: 1, calls: 6, tokensIn: 1, tokensOut: 1, cost: 0, costSource: 'none', stop: 'submitted', startedAt: '2026-11-02T00:00:00Z', endedAt: '2026-11-02T00:00:01Z' });
  }
}

put('meta.json', {
  name: 'w05-fixture', mode: 'local', source: 'fixture', date: '2026-11-02T00:00:00Z', finalized: true,
  surface: 's1', agents: reviewers.map((r) => r.id), models: Object.fromEntries(reviewers.map((r) => [r.id, r.model])),
  reviewers, auditors: reviewers.map((r) => `${r.id}-s1-auth`), submissionAuthority: 'mcp_commit', workerExits: Object.fromEntries(reviewers.map((r) => [`${r.id}-s1-auth`, 0])),
  crosscheckExits: {}, stageFailures: [],
});
put('workers.json', { version: 1, jobs });
put('findings-and-scores.json', { findings: scores });
put('harness/sandbox.md', '# Sandbox\n| fixture | impossible | Benign data fixture, no target execution. |\n');
put('source-manifest.json', { digest: 'a'.repeat(64), files: [] });
process.stdout.write(`wrote ${out}\n`);
