import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Role registry. A role is a file bridge-tools-<role>.mjs that exports `role`, `toolDefinitions()` and
// `handlers` ({ toolName: async (ctx, args) => text }). Adding a role adds a file; the dispatcher does not change.
// W04 plugs its counter into `ctx.beforeCall(ctx, name)`; W06 adds bridge-tools-debate.mjs and bridge-tools-orchestrator.mjs.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROLE_FILE = /^bridge-tools-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.mjs$/;
const SUPPORT_FILES = new Set(['common', 'registry']);
const roles = new Map();

export function registerBridgeRole(mod) {
  if (!mod || typeof mod.role !== 'string' || !/^[a-z][a-z0-9-]*$/.test(mod.role) || typeof mod.toolDefinitions !== 'function' || !mod.handlers || typeof mod.handlers !== 'object') {
    throw new Error('Invalid bridge tool module: expected role, toolDefinitions() and handlers');
  }
  roles.set(mod.role, mod);
  return mod;
}

// Loads every bridge-tools-<role>.mjs in a directory. The default directory is this one.
export async function loadBridgeRoles(dir = HERE) {
  for (const file of fs.readdirSync(dir).sort()) {
    const match = ROLE_FILE.exec(file);
    if (!match || SUPPORT_FILES.has(match[1])) continue;
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (mod.role !== match[1]) throw new Error(`Bridge tool file ${file} declares role ${mod.role}`);
    registerBridgeRole(mod);
  }
  return [...roles.keys()];
}

await loadBridgeRoles();

export function bridgeRole(role) {
  const name = role || 'auditor';
  const mod = roles.get(name);
  if (!mod) throw new Error(`Unknown bridge role: ${String(name).slice(0, 40)}`);
  return mod;
}

export function bridgeRoleNames() { return [...roles.keys()]; }
