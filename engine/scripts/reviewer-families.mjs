// Family registry: a family knows how to launch its reviewers. Each family is one file,
// scripts/provider-<family>.mjs, exporting `family` ({name, providers, launch, envAllowlist, installed, ...}).
// Later waves add files (W03: key, openrouter, scripted, nearai); nothing here is edited to add one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES } from './reviewer-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Wave that ships each family, named in the error a reviewer gets before then.
export const FAMILY_WAVES = Object.freeze({ cli: 'W01', key: 'W03', openrouter: 'W03', nearai: 'W03 (H+)', scripted: 'W03' });

export class FamilyError extends Error {
  constructor(code, message) { super(message); this.name = 'FamilyError'; this.code = code; }
}

const loaded = new Map();
for (const name of FAMILIES) {
  const file = path.join(HERE, `provider-${name}.mjs`);
  if (!fs.existsSync(file)) continue;
  const mod = await import(file);
  if (!mod.family || mod.family.name !== name) throw new Error(`provider-${name}.mjs must export family.name === "${name}"`);
  loaded.set(name, mod.family);
}

export const families = {
  // Installed family names, in registry order.
  list: () => [...loaded.keys()],
  has: (name) => loaded.has(name),
  get(name) {
    const family = loaded.get(name);
    if (family) return family;
    if (!Object.hasOwn(FAMILY_WAVES, name)) throw new FamilyError('FAMILY_UNKNOWN', `unknown reviewer family: ${name}`);
    throw new FamilyError('FAMILY_NOT_INSTALLED', `family \`${name}\` not installed yet (${FAMILY_WAVES[name]})`);
  },
  // {ok, reason?} for one parsed reviewer: family file present, provider known and installed.
  check(reviewer) {
    let family;
    try { family = families.get(reviewer.family); } catch (error) { return { ok: false, code: error.code, reason: error.message }; }
    const provider = family.providers?.[reviewer.provider];
    if (!provider) return { ok: false, code: 'PROVIDER_UNKNOWN', reason: `unknown provider ${reviewer.provider}` };
    if (typeof provider.installed === 'function' ? !provider.installed() : provider.installed === false) {
      return { ok: false, code: 'FAMILY_NOT_INSTALLED', reason: `provider \`${reviewer.family}:${reviewer.provider}\` not installed yet (${provider.wave || FAMILY_WAVES[reviewer.family]})` };
    }
    return { ok: true };
  },
  // Launch one reviewer session. Throws FamilyError for a family or provider that is not installed.
  launch(reviewer, ctx) {
    const verdict = families.check(reviewer);
    if (!verdict.ok) throw new FamilyError(verdict.code, verdict.reason);
    return families.get(reviewer.family).launch(reviewer, ctx);
  },
  // Environment variable names this reviewer's process may receive beyond the base set.
  envAllowlist: (reviewer) => families.get(reviewer.family).envAllowlist(reviewer),
  // Operator variable that holds this reviewer's key (null for keyless reviewers). Key presence checks and
  // the recorded keyFingerprint both read this one name.
  fingerprintEnv: (reviewer) => families.get(reviewer.family).fingerprintEnv?.(reviewer) ?? null,
  // True when the session must keep the model it was launched with (a changed model aborts the turn).
  modelPinned: (reviewer) => Boolean(loaded.get(reviewer.family)?.providers?.[reviewer.provider]?.pinsModel),
};
