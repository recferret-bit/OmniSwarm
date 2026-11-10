// The three review layers of a target: web2 (application code), web3 (contracts, programs and the code that
// asks a wallet to sign) and infra (containers, CI, proxy and deploy configuration, environment files).
// A file belongs to exactly one layer, decided from its path, the chain manifests and, for JS/TS, a chain SDK
// import. The risk domains of audit-plans.mjs (http, databases, crypto, ...) are a different axis: they say what
// to look for, a layer says which part of the system the file is. The intake's themes (apps/api/src/worker/themes.ts)
// split by top-level directory before a job is queued; this map is per file and is what a reviewer sees.
// Mounted into the sandbox beside harness.mjs: it may import harness-walk.mjs only.
import path from 'node:path';
import { SKIP_DIRS, readText, rel as relPath, walk } from './harness-walk.mjs';

export const LAYERS = ['web2', 'web3', 'infra'];
export const LAYER_TITLES = {
  web2: 'Web2: application (backend, API, browser client)',
  web3: 'Web3: on-chain code and wallet flows',
  infra: 'Infra: containers, CI, proxy and deploy configuration',
};

const INFRA_FILE = /(?:^|\/)(?:Dockerfile[^/]*|[^/]+\.dockerfile|(?:docker-)?compose[^/]*\.ya?ml|[^/]+\.tf|[^/]+\.tfvars|[^/]*nginx[^/]*\.conf|Caddyfile|Procfile|Jenkinsfile|\.gitlab-ci\.yml|[^/]+\.service|\.env(?:\.[^/]+)?|[^/]+\.env)$/i;
const INFRA_DIR = /(?:^|\/)(?:\.github|\.gitlab|\.circleci|infra|infrastructure|deploy|deployment|ops|devops|k8s|kubernetes|helm|charts|terraform|ansible|nginx)\//i;
const CHAIN_SOURCE = /\.(?:sol|vy|move|cairo)$/i;
const CHAIN_MANIFEST = /\b(?:anchor-lang|solana-program|solana-sdk|pinocchio|near-sdk)\b/;
const CHAIN_PROJECT_FILE = /^(?:Anchor\.toml|foundry\.toml|remappings\.txt|hardhat\.config\.[cm]?[jt]s|truffle-config\.js)$/;
const CHAIN_PACKAGE = '(?:hardhat|@nomicfoundation/[^\'"]+|@openzeppelin/[^\'"]+|@wagmi/[^\'"]+|@rainbow-me/[^\'"]+|@metamask/[^\'"]+|@web3modal/[^\'"]+|near-api-js|@near-js/[^\'"]+|@hot-labs/near-connect|@solana/[^\'"]+|@coral-xyz/[^\'"]+|@anchor-lang/[^\'"]+|@defuse-protocol/[^\'"]+|@near-intents-agent-api/sdk|@neardefi/shade-agent-js|ethers|viem|wagmi|web3)';
const CHAIN_IMPORT = new RegExp(`\\bfrom\\s+['"]${CHAIN_PACKAGE}['"]|\\b(?:require|import)\\s*\\(\\s*['"]${CHAIN_PACKAGE}['"]\\s*\\)|\\bwindow\\.(?:solana|ethereum|near)\\b`);
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte']);
const ROOT_CRATE_FILE = /^(?:src\/.*\.rs|build\.rs|Cargo\.(?:toml|lock))$/;
const MAX_LISTED = 200;

function underRoot(rel, root) {
  if (root === '.') return ROOT_CRATE_FILE.test(rel);
  return rel === root || rel.startsWith(`${root}/`);
}

// layers: the object buildLayerMap returns (or the copy in stack-profile.json). With none, path rules only.
export function layerOfPath(file, layers = null) {
  const rel = String(file || '').replace(/^\.?\//, '').replace(/:\d+(?:-\d+)?$/, '');
  if (INFRA_FILE.test(rel)) return 'infra';
  if (CHAIN_SOURCE.test(rel) || CHAIN_PROJECT_FILE.test(path.posix.basename(rel))) return 'web3';
  if ((layers?.roots?.web3 || []).some((root) => underRoot(rel, root))) return 'web3';
  if (INFRA_DIR.test(rel)) return 'infra';
  if ((layers?.clientFiles || []).includes(rel)) return 'web3';
  return 'web2';
}

export function buildLayerMap(targetRoot) {
  const root = path.resolve(targetRoot);
  const files = [];
  const chainRoots = new Set();
  const clientFiles = [];
  walk(root, (file) => {
    const rel = relPath(root, file);
    files.push(rel);
    const base = path.basename(file);
    if (base === 'Cargo.toml') {
      if (CHAIN_MANIFEST.test(readText(file) || '')) chainRoots.add(path.posix.dirname(rel));
    } else if (base === 'foundry.toml' || /^hardhat\.config\./.test(base) || base === 'truffle-config.js') {
      // An EVM project directory is on-chain code: its contracts, tests, scripts and vendored libraries.
      if (path.posix.dirname(rel) !== '.') chainRoots.add(path.posix.dirname(rel));
    } else if (JS_EXT.has(path.extname(file).toLowerCase()) && !file.endsWith('.min.js')) {
      if (CHAIN_IMPORT.test(readText(file) || '')) clientFiles.push(rel);
    }
  }, { skipDirs: SKIP_DIRS, sorted: true });
  const layers = { roots: { web3: [...chainRoots].sort() }, clientFiles: clientFiles.sort().slice(0, MAX_LISTED) };
  const byLayer = Object.fromEntries(LAYERS.map((layer) => [layer, []]));
  for (const rel of files.sort()) byLayer[layerOfPath(rel, layers)].push(rel);
  return {
    version: 1,
    counts: Object.fromEntries(LAYERS.map((layer) => [layer, byLayer[layer].length])),
    present: LAYERS.filter((layer) => byLayer[layer].length > 0),
    ...layers,
    files: Object.fromEntries(LAYERS.map((layer) => [layer, byLayer[layer].slice(0, MAX_LISTED)])),
  };
}

// The sentence a scoped run puts in front of its reviewers. scope: 'web2' | 'web3' | 'infra'; '' for a full run.
export function scopeNote(scope) {
  if (!LAYERS.includes(scope)) return '';
  return `This run reviews the ${scope} layer only (${LAYER_TITLES[scope]}). Files of the other layers are context: read them to follow a flow, but every finding must cite a ${scope} file first, and a report that cites another layer first is refused. Put anything you notice outside the ${scope} layer in markdown_summary under "Out of scope", not in findings.`;
}

export function renderLayerLines(layers, scope = '') {
  if (!layers?.counts) return [];
  const lines = ['## Review Layers', 'Every file belongs to one layer. Name the layer of each finding from the file it cites; do not mix layers in one finding.', ...(scopeNote(scope) ? [scopeNote(scope)] : [])];
  for (const layer of LAYERS) {
    const listed = layers.files?.[layer] || [];
    const count = layers.counts[layer] || 0;
    lines.push(`- **${LAYER_TITLES[layer]}**: ${count ? `${count} file(s): ${listed.slice(0, 12).map((f) => `\`${f}\``).join(', ')}${count > 12 ? ', ...' : ''}` : 'absent'}`);
  }
  return lines;
}
