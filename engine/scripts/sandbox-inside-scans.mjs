// Dependency advisory scans (npm/pnpm/yarn audit, cargo audit, osv-scanner) and the local server ZAP points at.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CARGO_ENV, OPENSSL_NOTE, brief, dirOf, log, run, scanResult } from './sandbox-inside-exec.mjs';
import { yarnBerry } from './sandbox-inside-node.mjs';
import { installed, outDir, publish, put } from './sandbox-inside-state.mjs';

// Yarn classic uses exit 0–31 as a severity bitmask. A transport error is also exit 1,
// and that JSON is {"type":"error"} rather than an advisory report.
function yarnAuditResult(res) {
  if (/"type"\s*:\s*"error"/.test(String(res.out || ''))) return 'failed';
  if (res.code >= 0 && res.code <= 31) return 'ran';
  return scanResult(res);
}

export async function audits(tree) {
  const bits = [];
  let worst = 'ran';
  const jobs = [
    ...tree.npmLocks.items.map((rel) => ['npm', ['audit', '--json', '--registry', 'https://registry.npmjs.org'], rel]),
    ...tree.pnpmLocks.items.map((rel) => ['pnpm', ['audit', '--json'], rel]),
    ...tree.yarnOnly.items.map((rel) => ['yarn', null, rel]),
  ];
  for (const [cmd, args, rel] of jobs) {
    const cwd = dirOf(path.posix.dirname(rel));
    if (!cwd) continue;
    const yarnArgs = cmd === 'yarn'
      ? (yarnBerry(cwd) ? ['npm', 'audit', '--json'] : ['audit', '--json', '--registry', 'https://registry.npmjs.org'])
      : args;
    const res = await run(cmd, yarnArgs, { cwd, timeoutMs: 5 * 60 * 1000 });
    log('npm-audit', res);
    const kind = cmd === 'yarn' ? yarnAuditResult(res) : scanResult(res);
    if (kind === 'failed') worst = 'failed';
    bits.push(`${rel} ${brief(res)}`);
  }
  put('npm-audit', worst, bits.join('; ') || 'no lockfile directory');
}

export async function cargoAudit(rels) {
  const bits = [];
  let worst = 'ran';
  for (const rel of rels) {
    const file = path.join('/work/src', rel);
    const res = await run('cargo', ['audit', '--file', file], {
      cwd: '/work/src',
      timeoutMs: 5 * 60 * 1000,
      env: { CARGO_HOME: '/work/cargo', OPENSSL_NO_VENDOR: '1' },
    });
    log('cargo-audit', res);
    const kind = scanResult(res);
    if (kind === 'failed') worst = 'failed';
    if (kind === 'impossible') worst = 'impossible';
    bits.push(`${rel} ${brief(res)}`);
  }
  put('cargo-audit', worst, bits.join('; '));
}

export async function osv(call) {
  const id = call ? 'osv-call' : 'osv-lock';
  const args = ['scan', 'source', '-r', '/work/src', '--offline-vulnerabilities'];
  if (call) args.push('--call-analysis=rust');
  const res = await run('osv-scanner', args, { cwd: '/work/src', timeoutMs: call ? 20 * 60 * 1000 : 5 * 60 * 1000, env: { ...CARGO_ENV, XDG_CACHE_HOME: '/opt/osv-cache' } });
  log(id, res);
  const kind = scanResult(res);
  let detail = kind === 'impossible'
    ? `An ecosystem in this tree has no offline database, so this scan was not completed. The OSV API is not contacted. ${brief(res)}`
    : brief(res);
  if (call && kind === 'ran') detail = `${detail} ${OPENSSL_NOTE}`;
  put(id, kind, detail);
}

function listen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitPort(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await listen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function maybeServe(tree) {
  const web = tree.webStart;
  if (!web) return;
  const key = web.rel === '.' ? '.' : web.rel;
  if (!installed.has(key)) {
    put('zap', 'impossible', `Install in ${web.rel} did not succeed, so the local server was not started.`);
    publish('zap.json', { ready: false });
    return;
  }
  const cwd = dirOf(web.rel);
  const logFd = fs.openSync(path.join(outDir, 'web-server.log'), 'w');
  const child = spawn('npm', ['start'], {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, HOST: '0.0.0.0', PORT: '3000', BROWSER: 'none' },
  });
  const up = await waitPort(3000, 30_000);
  if (!up) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    put('zap', 'impossible', 'The start script did not listen on 127.0.0.1:3000. ZAP was not pointed anywhere else.');
    publish('zap.json', { ready: false });
    return;
  }
  publish('zap.json', { ready: true, port: 3000 });
  // The host may still be pulling the ZAP image, then the baseline is capped at 2 minutes.
  const until = Date.now() + 12 * 60 * 1000;
  while (Date.now() < until && !fs.existsSync(path.join(outDir, 'zap.done'))) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}
