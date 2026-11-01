import fs from 'node:fs';
import path from 'node:path';

// Read manifest facts without executing Cargo or target build scripts. Keep table/key
// boundaries (including quoted/dotted keys); strings and comments are never signals.
export function tomlFacts(text) {
  const tokens = [];
  const re = /\s+|#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^']*'|[\[\]{},.=]|[^\s#[\]{}.,=]+/gy;
  let m, end = 0;
  while ((m = re.exec(text))) {
    end = re.lastIndex;
    const raw = m[0];
    if (/^\s|^#/.test(raw)) continue;
    if (raw.startsWith('"""') || raw.startsWith("'''")) tokens.push({ value: raw.slice(3, -3), string: true });
    else if (raw.startsWith('"')) tokens.push({ value: JSON.parse(raw.replace(/\\U([0-9a-fA-F]{8})/g, (_, hex) => JSON.stringify(String.fromCodePoint(parseInt(hex, 16))).slice(1, -1))), string: true });
    else if (raw.startsWith("'")) tokens.push({ value: raw.slice(1, -1), string: true });
    else tokens.push({ value: raw, string: false });
  }
  if (end !== text.length) throw Error('Unsupported manifest syntax');
  let i = 0;
  const facts = new Map(), tables = new Set();
  const peek = value => tokens[i]?.value === value && !tokens[i]?.string;
  const take = value => { if (!peek(value)) throw Error('Malformed manifest'); i++; };
  const key = () => {
    const parts = [];
    do {
      if (parts.length) take('.');
      const token = tokens[i++];
      if (!token || (!token.string && !/^[\w-]+$/.test(token.value))) throw Error('Malformed key');
      parts.push(token.value);
    } while (peek('.'));
    return parts;
  };
  const value = prefix => {
    if (peek('{')) {
      i++;
      while (!peek('}')) { const p = key(); take('='); value([...prefix, ...p]); if (!peek(',')) break; i++; }
      take('}');
    } else if (peek('[')) {
      i++;
      const start = i;
      let depth = 1;
      while (i < tokens.length && depth) { if (peek('[')) depth++; if (peek(']')) depth--; i++; }
      if (depth) throw Error('Unclosed array');
      facts.set(JSON.stringify(prefix), tokens.slice(start, i - 1).filter(t => t.string).map(t => t.value));
    } else {
      const token = tokens[i++];
      if (!token) throw Error('Missing value');
      // Numeric/date values are irrelevant to these facts, but can contain dots.
      while (!token.string && peek('.')) { i += 2; }
      facts.set(JSON.stringify(prefix), token.string ? token.value : token.value === 'true' ? true : token.value === 'false' ? false : null);
    }
  };
  let table = [];
  while (i < tokens.length) {
    if (peek('[')) {
      i++;
      const array = peek('['); if (array) i++;
      table = key(); take(']'); if (array) { take(']'); table.push('@array'); }
      tables.add(JSON.stringify(table));
    } else { const p = key(); take('='); value([...table, ...p]); }
  }
  return { facts, tables };
}

export function cargoManifestFacts(text) {
  try {
    const { facts, tables } = tomlFacts(text);
    const dependencies = new Map();
    for (const [encoded, value] of facts) {
      const keys = JSON.parse(encoded);
      const index = keys.findIndex(k => k === 'dependencies' || k === 'dev-dependencies' || k === 'build-dependencies');
      if (index < 0 || !keys[index + 1]) continue;
      if (!(index === 0 || index === 1 && keys[0] === 'workspace' || index === 2 && keys[0] === 'target')) continue;
      const group = keys.slice(0, index + 1).join('.'), name = keys[index + 1];
      const id = JSON.stringify([group, name]);
      const dep = dependencies.get(id) || { name, package: name, group };
      const field = keys[index + 2] || 'version';
      if (['package', 'version', 'workspace'].includes(field)) dep[field] = value;
      dependencies.set(id, dep);
    }
    return { facts, tables, dependencies: [...dependencies.values()], error: false };
  } catch { return { facts: new Map(), tables: new Set(), dependencies: [], error: true }; }
}

export function cargoInfo(root, manifest, read = file => fs.readFileSync(file, 'utf8')) {
  const parsed = cargoManifestFacts(read(manifest));
  let workspace = manifest, workspaceFacts = parsed;
  const explicit = parsed.facts.get('["package","workspace"]');
  const candidates = [];
  if (typeof explicit === 'string') candidates.push(path.resolve(path.dirname(manifest), explicit, 'Cargo.toml'));
  if (!parsed.tables.has('["workspace"]')) {
    for (let dir = path.dirname(path.dirname(manifest)); dir === root || dir.startsWith(root + path.sep); dir = path.dirname(dir)) candidates.push(path.join(dir, 'Cargo.toml'));
  }
  for (const candidate of candidates) {
    if (!candidate.startsWith(root + path.sep)) continue;
    let p; try { p = cargoManifestFacts(read(candidate)); } catch { continue; }
    if (p.tables.has('["workspace"]')) { workspace = candidate; workspaceFacts = p; break; }
  }
  const dependencies = parsed.dependencies.filter(d => d.group !== 'workspace.dependencies').map(d => {
    if (!d.workspace) return d;
    const inherited = workspaceFacts.dependencies.find(w => w.group === 'workspace.dependencies' && w.name === d.name);
    return inherited ? { ...inherited, ...d, package: inherited.package, version: inherited.version } : d;
  });
  const unresolved = parsed.dependencies.some(d => d.workspace && !workspaceFacts.dependencies.some(w => w.group === 'workspace.dependencies' && w.name === d.name));
  return { ...parsed, dependencies, workspace, workspaceFacts, error: parsed.error || workspaceFacts.error || unresolved };
}

export function isNearCargo(info, includeDev = false) {
  return info.dependencies.some(d => d.package === 'near-sdk' && (includeDev || /(?:^|\.)dependencies$/.test(d.group)));
}

export function nearReleaseEvidence(root, manifest, read) {
  const info = cargoInfo(root, manifest, read);
  const facts = info.workspaceFacts.facts;
  const release = facts.get('["profile","release","overflow-checks"]');
  const overrides = [...facts].filter(([key]) => { const p = JSON.parse(key); return p[0] === 'profile' && p[1] === 'release' && p.length > 3 && p.at(-1) === 'overflow-checks'; });
  // Cargo config and build-time environment can override manifests. State only the
  // manifest evidence; never certify the effective compiler configuration.
  let configOverride = false;
  const reader = read || (file => fs.readFileSync(file, 'utf8'));
  for (let dir = path.dirname(manifest); dir === root || dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    for (const name of ['config', 'config.toml']) {
      try {
        const config = cargoManifestFacts(reader(path.join(dir, '.cargo', name)));
        if (config.error || [...config.facts.keys()].some(key => { const p = JSON.parse(key); return p[0] === 'profile' || p.at(-1) === 'rustflags' || p[0] === 'env'; })) configOverride = true;
      } catch { /* no project Cargo config */ }
    }
  }
  const detail = release === true && !configOverride && !overrides.some(([, v]) => v !== true)
    ? 'release overflow-checks = true in the workspace manifest (build/config overrides still require review)'
    : 'LEAD: release overflow checks are disabled, absent, overridden, or unresolved; inspect checked arithmetic and build/config overrides';
  return `${path.relative(root, manifest)}: ${detail}; profile source ${path.relative(root, info.workspace)}.`;
}
