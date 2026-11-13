// Pure scanner behind `npm run guard`: walks first-party build output and reports
// every banned token with the file it was found in. Kept separate from the build
// step so its detection is unit-tested (bundle-scan.test.mjs).
import fs from 'node:fs';
import path from 'node:path';

// Mock wallet, MSW, mock controls and key- or secret-shaped strings.
export const BANNED = [
  { name: 'MockConnector', pattern: /MockConnector/ },
  { name: 'mock wallet account', pattern: /alice\.near/ },
  { name: 'ed25519 key', pattern: /ed25519:[1-9A-HJ-NP-Za-km-z]{43,88}/ },
  { name: 'base58 64-byte secret', pattern: /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{87,88}(?![1-9A-HJ-NP-Za-km-z])/ },
  { name: 'sk- key', pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/ },
  { name: 'GitHub token', pattern: /ghp_[A-Za-z0-9]{20,}|github_pat_/ },
  { name: 'provider env name', pattern: /OPENROUTER|ZAI_/ },
  { name: 'MSW worker', pattern: /mockServiceWorker|setupWorker/ },
  { name: 'mock reports origin', pattern: /reports\.omniswarm\.mock/ },
  { name: 'mock controls', pattern: /Tamper the report|Mock mode \(dev only\)|REVIEW_FAILED|SSE_DROP/ },
];

// Source maps are skipped: they hold original source text (comments, dead branches), are
// not served by the production server and are not what a browser executes.
const TEXT = /\.(js|mjs|cjs|css|html|json|txt|rsc|svg)$/;

export function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (TEXT.test(entry.name)) out.push(full);
  }
  return out;
}

// `extra` adds literal strings (e.g. a recorded fixture hash) that must not be inlined.
export function scan(files, extra = []) {
  const rules = [...BANNED, ...extra.map((value) => ({ name: `literal ${value.slice(0, 12)}…`, pattern: new RegExp(value) }))];
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of rules) if (rule.pattern.test(text)) hits.push({ file, rule: rule.name });
  }
  return hits;
}
