// Iterates every examples/<schema>/{valid,invalid}-*.json. Filter by schema name:
//   npm run test:schemas -- reviewer-spec run-config
// Example files for schemas with $defs (intake-api) are named valid-<def>--<label>.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_DIR, listSchemas, loadSchema, validate } from './index.mjs';

const filter = (process.env.SCHEMA_FILTER || '').split(/\s+/).filter(Boolean);
const names = listSchemas().filter((n) => !filter.length || filter.includes(n));
const here = path.dirname(fileURLToPath(import.meta.url));
assert.equal(here, SCHEMA_DIR);

function refs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === '$ref') out.push(v); else refs(v, out); }
  return out;
}

for (const name of names) {
  test(`${name}: schema compiles and every $ref resolves`, () => {
    const schema = loadSchema(name);
    assert.equal(schema.title, name);
    assert.ok(schema.$schema.includes('2020-12'));
    for (const ref of refs(schema)) {
      const m = /^(?:([a-z0-9-]+)\.schema\.json)?(?:#\/\$defs\/([A-Za-z0-9_-]+))?$/.exec(ref);
      assert.ok(m && (m[1] || m[2]), `${name}: bad $ref ${ref}`);
      const target = m[1] ? loadSchema(m[1]) : schema;
      if (m[2]) assert.ok(target.$defs?.[m[2]], `${name}: unresolved $ref ${ref}`);
    }
  });

  const dir = path.join(SCHEMA_DIR, 'examples', name);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const valid = files.filter((f) => f.startsWith('valid-'));
  const invalid = files.filter((f) => f.startsWith('invalid-'));

  test(`${name}: has valid and invalid examples`, () => {
    assert.ok(valid.length > 0, `examples/${name}/ needs at least one valid-*.json`);
    assert.ok(invalid.length > 0, `examples/${name}/ needs at least one invalid-*.json`);
    assert.equal(valid.length + invalid.length, files.length, `examples/${name}/ has a file that is neither valid-* nor invalid-*`);
  });

  for (const file of files) {
    test(`${name}: examples/${name}/${file}`, () => {
      const [prefix] = file.split('-', 1);
      const stem = file.slice(prefix.length + 1, -'.json'.length);
      const def = stem.includes('--') ? stem.split('--')[0] : null;
      const hasRoot = ['type', 'oneOf', 'properties', 'required'].some((k) => k in loadSchema(name));
      assert.ok(def || hasRoot, `${file}: schema ${name} has no root constraint, name the def as ${prefix}-<def>--<label>.json`);
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const result = validate(def ? `${name}#${def}` : name, value);
      if (prefix === 'valid') assert.ok(result.ok, `${file} should be valid: ${result.errors.join('; ')}`);
      else assert.ok(!result.ok, `${file} should be invalid but passed`);
    });
  }
}

if (!filter.length) {
  test('every examples/ folder belongs to a schema', () => {
    const dirs = fs.readdirSync(path.join(SCHEMA_DIR, 'examples'));
    for (const d of dirs) assert.ok(listSchemas().includes(d), `examples/${d} has no ${d}.schema.json`);
  });
  test('intake-api: at least 13 endpoint examples', () => {
    const files = fs.readdirSync(path.join(SCHEMA_DIR, 'examples', 'intake-api')).filter((f) => f.startsWith('valid-') && f.includes('--'));
    const endpoints = new Set(files.map((f) => f.split('--')[1].replace('.json', '').replace(/-done$/, '')).filter((l) => l !== 'any-error'));
    assert.ok(endpoints.size >= 13, `found ${endpoints.size} endpoints`);
  });
}
