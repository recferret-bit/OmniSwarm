#!/bin/bash
# Run every README screener block in a clean clone with provider keys unset.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLONE="$(mktemp -d "$ROOT/../omniswarm-screener.XXXXXX")"
trap 'rm -rf "$CLONE"' EXIT
git clone --local "$ROOT" "$CLONE" >/dev/null
cd "$CLONE"
unset OPENROUTER_API_KEY ZAI_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY XAI_API_KEY GEMINI_API_KEY NEARAI_API_KEY GITHUB_TOKEN || true
node --input-type=module <<'EOF'
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const readme = fs.readFileSync('README.md', 'utf8');
const blocks = [...readme.matchAll(/<!-- screener\n([\s\S]*?)-->/g)].map((match) => match[1]);
if (!blocks.length) {
  console.error('no screener blocks');
  process.exit(1);
}
const env = { ...process.env };
for (const key of ['OPENROUTER_API_KEY', 'ZAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'NEARAI_API_KEY', 'GITHUB_TOKEN']) delete env[key];
for (const block of blocks) {
  const run = block.match(/^run: (.+)$/m)?.[1];
  const see = block.match(/^you should see: (.+)$/m)?.[1];
  if (!run || !see) {
    console.error('bad screener block');
    process.exit(1);
  }
  const result = spawnSync(run, { shell: true, encoding: 'utf8', env, timeout: 180000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (!output.includes(see)) {
    console.error(`screener failed: ${run}\nexpected: ${see}\n${output.slice(0, 1000)}`);
    process.exit(1);
  }
  console.log(`screener ok: ${run}`);
}
EOF
bash tools/secret-sweep.sh
echo "screener check ok"
