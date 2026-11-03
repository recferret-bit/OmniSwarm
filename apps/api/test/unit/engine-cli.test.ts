// The real engine runner against fake ./bin/audit scripts: exact argv, no shell, an allow-listed env
// (no intake secret reaches the engine), drained output under a cap, timeout kill, missing binary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../../src/config/load.ts';
import { createEngine } from '../../src/container.ts';
import { ArgvError, auditArgv } from '../../src/engine/cli/argv.ts';
import { CliEngineRunner } from '../../src/engine/cli/cli-runner.ts';
import { assertPassable } from '../../src/engine/cli/env.ts';
import type { EngineRunner } from '../../src/engine/port.ts';
import { AppError } from '../../src/shared/errors.ts';
import { presetEnv, resolvePreset } from '../../src/worker/preset.ts';

const SHA = 'a'.repeat(40);

function fakeEngine(body: string, config?: object): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-engine-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin/audit'), `#!/usr/bin/env node\nconst fs = require('node:fs');\n${body}\n`, { mode: 0o755 });
  if (config) fs.writeFileSync(path.join(root, 'omniswarm.config.json'), JSON.stringify(config));
  return root;
}

function input(root: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'attempt-')));
  return { repo: 'near/near-sdk-rs', commitSha: SHA, preset: 'hosted', outDir: path.join(dir, 'report'), logPath: path.join(dir, 'worker.log'), root };
}

const RECORD = `fs.writeFileSync(process.cwd() + '/seen.json', JSON.stringify({ argv: process.argv.slice(2), env: process.env, pid: process.pid, cwd: process.cwd() }));`;

test('argv is exactly the 8-flag allow-list; any field carrying a flag is refused before spawn', () => {
  const out = '/srv/runs/req/0/report';
  assert.deepEqual(auditArgv({ repo: 'near/near-sdk-rs', commitSha: SHA, preset: 'hosted', outDir: out }),
    ['run', '--github', 'near/near-sdk-rs', '--ref', SHA, '--preset', 'hosted', '--out', out]);
  for (const bad of [
    { repo: 'near/x --rpc' }, { repo: '--rpc/x' }, { commitSha: '--rpc' }, { preset: 'cli:claude:opus' }, { preset: '--rpc' },
    { outDir: 'relative/dir' }, { outDir: '/srv/../etc' }, { outDir: '/srv/out --rpc' },
  ]) {
    assert.throws(() => auditArgv({ repo: 'near/near-sdk-rs', commitSha: SHA, preset: 'hosted', outDir: out, ...bad }), ArgvError, JSON.stringify(bad));
  }
});

test('the hosted preset gets only its provider keys; intake secrets never reach the engine', async () => {
  const config = { presets: { hosted: { reviewers: ['key:zai:glm-5.3', 'openrouter:qwen/qwen3.8-max-0902'], orchestrator: 'openrouter:anthropic/claude-opus-5.5' } } };
  const root = fakeEngine(`${RECORD}\nfs.mkdirSync(process.argv[process.argv.indexOf('--out') + 1], { recursive: true });`, config);
  const env = {
    PATH: process.env.PATH ?? '', HOME: os.homedir(), DATABASE_URL: 'postgres://secret', SESSION_SECRET: 'x'.repeat(40), ADMIN_TOKEN: 'y'.repeat(40),
    GITHUB_TOKEN: 'ghp_secret', OPERATOR_KEY_FILE: '/run/credentials/operator-key', PROBE_SECRET_KEY: 'leak', ANTHROPIC_API_KEY: 'not-in-preset',
    ZAI_API_KEY: 'zai-key', OPENROUTER_API_KEY: 'or-key', INTAKE_RECIPIENT: 'omniswarm.testnet', CONTRACT_ID: 'registry.testnet',
    ENGINE_RUNNER: 'cli', ENGINE_ROOT: root, HOSTED_PRESET: 'hosted',
  };
  const engine: EngineRunner = await createEngine(loadConfig('worker', env), env);
  const run = input(root);
  const result = await engine.run(run, new AbortController().signal);
  assert.equal(result.exitCode, 0);
  const seen = JSON.parse(fs.readFileSync(path.join(root, 'seen.json'), 'utf8'));
  assert.deepEqual(seen.argv, ['run', '--github', 'near/near-sdk-rs', '--ref', SHA, '--preset', 'hosted', '--out', run.outDir]);
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(root), 'cwd is the engine root');
  assert.notEqual(seen.pid, process.pid);
  assert.deepEqual(Object.keys(seen.env).filter((key) => !['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', '__CF_USER_TEXT_ENCODING'].includes(key)).sort(),
    ['OPENROUTER_API_KEY', 'ZAI_API_KEY']);
  for (const secret of ['postgres://secret', 'ghp_secret', 'leak', 'not-in-preset', 'x'.repeat(40)]) {
    assert.ok(!JSON.stringify(seen.env).includes(secret), `engine env carries ${secret}`);
  }
  assert.match(fs.readFileSync(run.logPath, 'utf8'), /spawned pid/);
  assert.throws(() => assertPassable(['DATABASE_URL']), /may not be passed/);
  assert.throws(() => assertPassable(['OPERATOR_KEY_FILE']), /may not be passed/);
});

test('presets with CLI subscriptions or an unvetted orchestrator are refused', () => {
  assert.deepEqual(presetEnv('demo', ['scripted:baseline', 'scripted:judge']).envNames, []);
  assert.throws(() => presetEnv('x', ['openrouter:a/b', 'cli:claude:opus']), (error: unknown) => error instanceof AppError && error.code === 'PRESET_NOT_ALLOWED');
  const root = fakeEngine('', { presets: { auto: { reviewers: ['scripted:baseline'], orchestrator: 'recommended' } } });
  assert.throws(() => resolvePreset(path.join(root, 'omniswarm.config.json'), 'auto'), /orchestrator explicitly/);
  assert.throws(() => resolvePreset(path.join(root, 'omniswarm.config.json'), 'missing'), /not defined/);
});

function runner(root: string, overrides: Partial<ConstructorParameters<typeof CliEngineRunner>[0]> = {}) {
  return new CliEngineRunner({ root, env: { PATH: process.env.PATH ?? '' }, timeoutS: 30, killGraceS: 1, logMaxBytes: 64 * 1024, ...overrides });
}

test('2 MB of output does not block the engine and the log is capped', async () => {
  const root = fakeEngine(`process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stderr.write('e'.repeat(512 * 1024));`);
  const run = input(root);
  const result = await runner(root).run(run, new AbortController().signal);
  assert.equal(result.exitCode, 0);
  const size = fs.statSync(run.logPath).size;
  assert.ok(size < 70 * 1024, `log is ${size} bytes`);
  assert.match(fs.readFileSync(run.logPath, 'utf8'), /log truncated/);
});

test('a hung engine is killed at the timeout (process group, SIGTERM then SIGKILL)', async () => {
  const root = fakeEngine(`process.on('SIGTERM', () => {}); require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' }); setInterval(() => {}, 1000);`);
  const started = Date.now();
  const result = await runner(root, { timeoutS: 1, killGraceS: 1 }).run(input(root), new AbortController().signal);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 10_000);
});

test('abort stops the run; a missing binary is a spawn error, not an exit code', async () => {
  const root = fakeEngine(`setInterval(() => {}, 1000);`);
  const abort = new AbortController();
  const pending = runner(root).run(input(root), abort.signal);
  setTimeout(() => abort.abort(), 200);
  assert.equal((await pending).aborted, true);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-engine-'));
  const missing = await runner(empty).run(input(empty), new AbortController().signal);
  assert.equal(missing.spawnError, 'ENOENT');
  assert.equal(missing.exitCode, null);
});
