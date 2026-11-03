// Infra bring-up stand-in for the @omniswarm/web standalone server.
import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || '0.0.0.0';

const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://stub').pathname !== '/') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found\n');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  return res.end('<!doctype html><title>OmniSwarm stub web</title><p>stub web</p>\n');
});
server.listen(port, host, () => console.log(`stub web on ${host}:${port}`));

process.on('SIGTERM', () => {
  console.log('stub web: SIGTERM received, draining');
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
});
