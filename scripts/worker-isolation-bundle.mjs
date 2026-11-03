// The trusted worker runtime bundle: the static import closure of worker-runtime.mjs plus the schema
// JSON that packages/schemas/index.mjs reads beside itself. The supervisor seals exactly these files,
// digests them, and mounts scripts/ at /trusted and packages/schemas/ at /packages/schemas, so every
// relative import resolves inside the container the same way it does on the host.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex as hash } from './hash-util.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_ENTRY = 'scripts/worker-runtime.mjs';
// Repository directory → container mount point. A closure file outside these roots cannot be mounted.
export const BUNDLE_MOUNTS = Object.freeze({ scripts: '/trusted', 'packages/schemas': '/packages/schemas' });

const STATIC = /^[ \t]*(?:import|export)[ \t]+(?:type[ \t]+)?[\w$*{}\s,]+?\s+from\s*(['"])([^'"\n]+)\1/gm;
const SIDE_EFFECT = /^[ \t]*import[ \t]*(['"])([^'"\n]+)\1/gm;
const DYNAMIC = /\bimport\s*\(/;

export function importSpecifiers(text, file = '<module>') {
  if (DYNAMIC.test(text)) throw new Error(`runtime bundle refuses dynamic import in ${file}`);
  return [...text.matchAll(STATIC), ...text.matchAll(SIDE_EFFECT)].map((m) => m[2]);
}

// Absolute paths of every module the entry loads, entry included, sorted. Relative specifiers only;
// node: builtins are skipped and any other bare specifier fails closed.
export function importClosure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    if (!/\.m?js$/.test(file) || !fs.statSync(file).isFile()) throw new Error(`runtime bundle module is not a file: ${file}`);
    seen.add(file);
    for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'), file)) {
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('./') && !spec.startsWith('../')) throw new Error(`runtime bundle refuses bare import ${spec} in ${file}`);
      visit(path.resolve(path.dirname(file), spec));
    }
  };
  visit(path.resolve(entry));
  return [...seen].sort();
}

const mountOf = (rel) => Object.keys(BUNDLE_MOUNTS).find((dir) => rel.startsWith(`${dir}/`) && !rel.slice(dir.length + 1).includes('/'));

// Repository-relative, sorted file list of the bundle.
export function runtimeBundle(root = REPO_ROOT, entry = RUNTIME_ENTRY) {
  const modules = importClosure(path.join(root, entry)).map((file) => path.relative(root, file).split(path.sep).join('/'));
  const schemaDir = path.join(root, 'packages/schemas');
  const schemas = modules.includes('packages/schemas/index.mjs')
    ? fs.readdirSync(schemaDir).filter((name) => name.endsWith('.schema.json')).map((name) => `packages/schemas/${name}`)
    : [];
  const files = [...new Set([...modules, ...schemas])].sort();
  const unmounted = files.filter((rel) => !mountOf(rel));
  if (unmounted.length) throw new Error(`runtime bundle file has no container mount: ${unmounted.join(', ')}`);
  return files;
}

// One digest form for the live tree and for a sealed capture: [[path, sha256], ...] in bundle order.
export function bundleDigest(files, shaOf) {
  return hash(JSON.stringify(files.map((rel) => [rel, shaOf(rel)])));
}

export function liveBundleDigest(root = REPO_ROOT, files = runtimeBundle(root)) {
  return bundleDigest(files, (rel) => hash(fs.readFileSync(path.join(root, rel))));
}

// Docker --mount arguments for a sealed capture of the bundle (capture.snapshot holds the repo-relative tree).
export function bundleMountArgs(snapshotRoot) {
  return Object.entries(BUNDLE_MOUNTS).flatMap(([dir, dst]) => ['--mount', `type=bind,src=${path.join(snapshotRoot, dir)},dst=${dst},readonly`]);
}
