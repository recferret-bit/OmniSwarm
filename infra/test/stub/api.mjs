// Infra bring-up stand-in for @omniswarm/api. It answers the routes nginx and
// smoke.sh depend on and reports what nginx forwarded, so the bring-up can
// assert proxy behaviour (real IP, upstream spread, SSE streaming, admin deny).
// It is never part of a deployed image.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function databaseReachable() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://invalid:1/');
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432), timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function events(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    res.write(`data: {"n":${n}}\n\n`);
    if (n >= 20) { clearInterval(timer); res.end(); }
  }, 300);
  req.on('close', () => clearInterval(timer));
}

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://stub');
  if (pathname === '/api/health') return json(res, 200, { ok: true });
  if (pathname === '/api/ready') {
    const ok = await databaseReachable();
    return json(res, ok ? 200 : 503, { ok });
  }
  if (pathname === '/api/whoami') {
    return json(res, 200, {
      host: os.hostname(),
      xff: req.headers['x-forwarded-for'] || null,
      realIp: req.headers['x-real-ip'] || null,
      proto: req.headers['x-forwarded-proto'] || null,
    });
  }
  if (/^\/api\/requests\/[^/]+\/events$/.test(pathname)) return events(req, res);
  if (pathname === '/api/challenge' && req.method === 'POST') return json(res, 200, { nonce: 'stub' });
  if (pathname.startsWith('/api/admin')) return json(res, 200, { reachedAdmin: true });
  return json(res, 404, { error: { code: 'NOT_FOUND', message: pathname, retryable: false } });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => json(res, 500, { error: { code: 'STUB', message: String(err), retryable: false } }));
});
server.listen(port, host, () => console.log(`stub api on ${host}:${port} as ${os.hostname()}`));

process.on('SIGTERM', () => {
  console.log('stub api: SIGTERM received, draining');
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
});
