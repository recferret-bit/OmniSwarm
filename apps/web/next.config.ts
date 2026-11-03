import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

// Same-origin `/api/*`. In development the Next server proxies it to API_ORIGIN
// (the Fastify intake). In production nginx routes `/api/` to Fastify and `/` to
// this standalone server, so no rewrite is configured and the browser never
// learns a second origin (the `sid` cookie is SameSite=Lax and HttpOnly).
async function rewrites() {
  const origin = process.env.API_ORIGIN;
  if (process.env.NODE_ENV === 'production' || !origin) return [];
  return [{ source: '/api/:path*', destination: `${origin.replace(/\/$/, '')}/api/:path*` }];
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  reactStrictMode: true,
  poweredByHeader: false,
  rewrites,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
