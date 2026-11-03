#!/bin/bash
# Run every README screener block in a clean clone with provider keys unset, then the secret sweep.
# A block passes only when its command exits 0 and prints its "you should see" line. A block that prints
# "Demo report saved to: <dir>" must also have written the demo's real output there: report.html stamped
# DEMO, reviewers/index.json, debate/clusters.json, debate/adjudication.json and general-review.json.
#   SCREENER_REPO=<git dir>   repository to clone (default: this checkout); tests point it at a fixture repo
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${SCREENER_REPO:-$ROOT}"
CLONE="$(mktemp -d "${TMPDIR:-/tmp}/omniswarm-screener.XXXXXX")"
trap 'rm -rf "$CLONE"' EXIT
git clone --quiet --local "$REPO" "$CLONE/repo"
cd "$CLONE/repo"
unset OPENROUTER_API_KEY ZAI_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY XAI_API_KEY GEMINI_API_KEY NEARAI_API_KEY GITHUB_TOKEN || true
node --input-type=module <<'EOF'
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEMO_FILES = ['report.html', 'reviewers/index.json', 'debate/clusters.json', 'debate/adjudication.json', 'general-review.json'];
const fail = (message) => { console.error(message); process.exit(1); };
const readme = fs.readFileSync('README.md', 'utf8');
const blocks = [...readme.matchAll(/<!-- screener\n([\s\S]*?)-->/g)].map((match) => match[1]);
if (!blocks.length) fail('no screener blocks');
for (const block of blocks) {
  const run = block.match(/^run: (.+)$/m)?.[1];
  const see = block.match(/^you should see: (.+)$/m)?.[1];
  if (!run || !see) fail('bad screener block');
  const result = spawnSync(run, { shell: true, encoding: 'utf8', env: process.env, timeout: 180000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) fail(`screener failed: ${run}\nexit ${result.status ?? result.signal}\n${output.slice(-2000)}`);
  if (!output.includes(see)) fail(`screener failed: ${run}\nexpected: ${see}\n${output.slice(0, 1000)}`);
  const saved = output.match(/^Demo report saved to: (.+)$/m)?.[1]?.trim();
  if (saved) {
    const dir = path.resolve(saved);
    const missing = DEMO_FILES.filter((rel) => !fs.existsSync(path.join(dir, rel)));
    if (missing.length) fail(`screener failed: ${run}\nthe demo output in ${dir} has no ${missing.join(', ')}`);
    if (!fs.readFileSync(path.join(dir, 'report.html'), 'utf8').includes('DEMO — not a review')) fail(`screener failed: ${run}\nreport.html is not stamped DEMO`);
  }
  console.log(`screener ok: ${run}`);
}
EOF
bash tools/secret-sweep.sh
echo "screener check ok"
