// Egress allow-lists for the sandbox: the proxy's host allow-list and the address checks for an operator-typed --rpc URL.
// The target never chooses a destination.

// The user typed this URL. It is never read from the repository.
export function rpcAllowed(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (!ipAllowed(host)) return null;
  }
  return url.href;
}

export function hostAllowed(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!h || h.includes(':') || h.includes('/') || h.includes('@')) return false;
  if (/^\d/.test(h) || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  return ALLOW.has(h);
}

const ALLOW = new Set([
  'crates.io',
  'index.crates.io',
  'static.crates.io',
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

export function ipAllowed(ip) {
  const raw = String(ip || '').toLowerCase().split('%')[0];
  if (!raw) return false;
  if (raw.includes(':')) {
    if (raw === '::' || raw === '::1' || raw.startsWith('fe80:') || raw.startsWith('fc') || raw.startsWith('fd')) return false;
    if (raw.startsWith('::ffff:')) return ipAllowed(raw.slice(7));
    return true;
  }
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}
