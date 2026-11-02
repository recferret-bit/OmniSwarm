// Dependency-free validator for the draft 2020-12 subset the OmniSwarm schemas use:
// type, required, properties, enum, const, pattern, items, oneOf, anyOf,
// additionalProperties (boolean or schema), minimum/maximum, minLength/maxLength,
// minItems/maxItems, and $ref ("#/$defs/<name>", "<schema>.schema.json", "<schema>.schema.json#/$defs/<name>"). Anything else in a schema
// is annotation (title, description, $schema, $id, examples) and is ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

export function listSchemas() {
  return fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).map((f) => f.slice(0, -'.schema.json'.length)).sort();
}

export function loadSchema(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid schema name: ${name}`);
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')));
  return cache.get(name);
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Returns {schema, root}. Forms: "#/$defs/x", "other.schema.json", "other.schema.json#/$defs/x".
function resolveRef(ref, root) {
  const m = /^(?:([a-z0-9-]+)\.schema\.json)?(?:#\/\$defs\/([A-Za-z0-9_-]+))?$/.exec(ref);
  if (!m || (!m[1] && !m[2])) throw new Error(`unresolvable $ref: ${ref}`);
  const target = m[1] ? loadSchema(m[1]) : root;
  const schema = m[2] ? target.$defs?.[m[2]] : target;
  if (!schema) throw new Error(`unresolvable $ref: ${ref}`);
  return { schema, root: target };
}

function check(schema, value, at, root, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { errors.push(`${at}: not allowed`); return; }
  if (schema.$ref) { const r = resolveRef(schema.$ref, root); return check(r.schema, value, at, r.root, errors); }
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) { errors.push(`${at}: expected ${types.join('|')}, got ${typeOf(value)}`); return; }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items !== undefined) value.forEach((item, i) => check(schema.items, item, `${at}[${i}]`, root, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}: missing required "${key}"`);
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) if (key in value) check(sub, value[key], `${at}.${key}`, root, errors);
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      for (const key of Object.keys(value)) {
        if (key in props) continue;
        if (schema.additionalProperties === false) errors.push(`${at}: unexpected property "${key}"`);
        else check(schema.additionalProperties, value[key], `${at}.${key}`, root, errors);
      }
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => { const e = []; check(sub, value, at, root, e); return !e.length; }).length;
    if (matches !== 1) errors.push(`${at}: must match exactly one of oneOf (matched ${matches})`);
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => { const e = []; check(sub, value, at, root, e); return !e.length; })) errors.push(`${at}: must match at least one of anyOf`);
}

// validate('run-config', value) or validate('intake-api#quote-request', value)
export function validate(name, value) {
  const [schemaName, def] = name.split('#');
  const root = loadSchema(schemaName);
  const schema = def ? resolveRef(`#/$defs/${def}`, root).schema : root;
  const errors = [];
  check(schema, value, '$', root, errors);
  return { ok: errors.length === 0, errors };
}
