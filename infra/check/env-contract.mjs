// Env contract (W12-01): every variable the stack reads is declared in exactly
// the infra/env/*.example file that owns it, examples carry no real secret,
// and every variable apps/api/.env.example declares is delivered to the API
// container or the worker.
//
//   node infra/check/env-contract.mjs --compose-json <prod config json>
//   node infra/check/env-contract.mjs --print-required
//
// Exit 1 on an error. Variables infra hands to the API that apps/api does not
// declare are warnings, or errors with OMNI_ENV_CONTRACT=strict.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INFRA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(INFRA, '..');

// Set by infra/deploy/lib.sh (release id), never by an env file.
export const RUNTIME_VARS = new Set(['OMNI_RELEASE']);
// Set by the worker unit or the image for the process itself, not app config.
export const PROCESS_VARS = new Set(['NODE_ENV', 'HOME', 'TMPDIR', 'AUDIT_TMP', 'DOCKER_CONFIG', 'HOSTNAME']);
export const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|_KEY$|_KEY_)/;
export const PROVIDER_NAME = /^[A-Z0-9]+_(API_KEY|BASE_URL)$/;

export function parseEnv(text) {
  const vars = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) throw new Error(`not KEY=value: ${line}`);
    vars.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return vars;
}

// ${NAME}, ${NAME:?msg}, ${NAME:-x}; `$${...}` is a literal dollar in compose.
// Full-line YAML comments are skipped.
export function composeRefs(text) {
  const refs = new Map();
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  for (const m of code.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[?+-])?/g)) {
    const required = (m[2] || '').includes('?');
    refs.set(m[1], (refs.get(m[1]) || false) || required);
  }
  return refs;
}

export function unitEnv(text) {
  const names = new Set();
  for (const m of text.matchAll(/^Environment=([A-Z0-9_]+)=/gm)) names.add(m[1]);
  return names;
}

function serviceEnv(composeJson, service) {
  return new Set(Object.keys(composeJson.services?.[service]?.environment || {}));
}

export function checkContract(input) {
  const { stack, dev, worker, providers, apiExample, baseRefs, devRefs, workerUnitEnv, composeJson } = input;
  const errors = [];
  const warnings = [];
  const declared = (name, file) => `${name} (${file})`;

  for (const name of baseRefs.keys()) {
    if (!RUNTIME_VARS.has(name) && !stack.has(name)) errors.push(`compose reads ${name}, not declared in infra/env/stack.env.example`);
  }
  for (const name of devRefs.keys()) {
    if (!RUNTIME_VARS.has(name) && !baseRefs.has(name) && !dev.has(name)) errors.push(`compose.dev.yml reads ${name}, not declared in infra/env/dev.env.example`);
  }
  for (const name of stack.keys()) {
    if (!baseRefs.has(name)) errors.push(`${declared(name, 'stack.env.example')} is declared but no compose file reads it`);
  }
  for (const name of dev.keys()) {
    if (!stack.has(name) && !devRefs.has(name)) errors.push(`${declared(name, 'dev.env.example')} is neither a stack variable nor read by compose.dev.yml`);
  }

  for (const [file, vars] of [['stack.env.example', stack], ['worker.env.example', worker], ['providers.env.example', providers], ['dev.env.example', dev], ['ops.env.example', input.ops || new Map()]]) {
    for (const [name, value] of vars) {
      if (SECRET_NAME.test(name) && value !== '') errors.push(`${declared(name, file)} has a value; secrets in examples must be empty`);
    }
  }

  for (const name of providers.keys()) {
    if (!PROVIDER_NAME.test(name)) errors.push(`${declared(name, 'providers.env.example')} is not a provider variable (<PROVIDER>_API_KEY or _BASE_URL)`);
  }
  for (const [service, def] of Object.entries(composeJson.services || {})) {
    for (const name of Object.keys(def.environment || {})) {
      if (providers.has(name) || PROVIDER_NAME.test(name)) errors.push(`compose service ${service} receives provider variable ${name}; keys belong to the worker only`);
    }
  }

  checkOps(input, errors);

  const api = serviceEnv(composeJson, 'api');
  const delivered = new Set([...api, ...serviceEnv(composeJson, 'migrate'), ...worker.keys(), ...providers.keys(), ...workerUnitEnv]);
  for (const name of apiExample.keys()) {
    if (!delivered.has(name)) errors.push(`apps/api/.env.example declares ${name}; no infra env file or compose service delivers it`);
  }
  for (const name of new Set([...api, ...worker.keys(), ...workerUnitEnv])) {
    if (!apiExample.has(name) && !PROCESS_VARS.has(name)) warnings.push(`infra sets ${name} for the api/worker, but apps/api/.env.example does not declare it`);
  }
  return { errors, warnings };
}

// ops.env.example feeds the host timers (health, prune, log hygiene), never a
// container: every name is OMNI_*, owned by no other file, read by an
// infra/deploy script, and URLs (webhooks carry tokens) stay empty.
function checkOps({ ops = new Map(), stack, hostScripts = '' }, errors) {
  for (const [name, value] of ops) {
    const where = `${name} (ops.env.example)`;
    if (!name.startsWith('OMNI_')) errors.push(`${where} is not an OMNI_* host setting`);
    if (stack.has(name)) errors.push(`${where} is also declared in stack.env.example`);
    if (!new RegExp(`\\b${name}\\b`).test(hostScripts)) errors.push(`${where} is declared but no infra/deploy script reads it`);
    if (/_URL$/.test(name) && value !== '') errors.push(`${where} has a value; URLs in examples must be empty`);
  }
}

// Required compose variables whose example value is empty: the owner must set
// them, and check.sh proves compose refuses to start without each one.
export function requiredUnset(stack, baseRefs) {
  return [...baseRefs].filter(([name, required]) => required && stack.get(name) === '').map(([name]) => name).sort();
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadInput(composeJsonPath) {
  const base = read('infra/compose/compose.yml') + read('infra/compose/compose.prod.yml');
  return {
    stack: parseEnv(read('infra/env/stack.env.example')),
    dev: parseEnv(read('infra/env/dev.env.example')),
    worker: parseEnv(read('infra/env/worker.env.example')),
    providers: parseEnv(read('infra/env/providers.env.example')),
    ops: parseEnv(read('infra/env/ops.env.example')),
    hostScripts: fs.readdirSync(path.join(INFRA, 'deploy')).filter((f) => f.endsWith('.sh')).map((f) => read(`infra/deploy/${f}`)).join('\n'),
    apiExample: parseEnv(read('apps/api/.env.example')),
    baseRefs: composeRefs(base),
    devRefs: composeRefs(read('infra/compose/compose.dev.yml')),
    workerUnitEnv: unitEnv(read('infra/systemd/omniswarm-worker@.service')),
    composeJson: composeJsonPath ? JSON.parse(fs.readFileSync(composeJsonPath, 'utf8')) : { services: {} },
  };
}

function main(argv) {
  const input = loadInput(argv.includes('--compose-json') ? argv[argv.indexOf('--compose-json') + 1] : null);
  if (argv.includes('--print-required')) {
    process.stdout.write(`${requiredUnset(input.stack, input.baseRefs).join('\n')}\n`);
    return 0;
  }
  const { errors, warnings } = checkContract(input);
  const strict = process.env.OMNI_ENV_CONTRACT === 'strict';
  for (const w of warnings) console.log(`  ${strict ? 'error' : 'warn'}: ${w}`);
  for (const e of errors) console.log(`  error: ${e}`);
  const failed = errors.length + (strict ? warnings.length : 0);
  console.log(`  env contract: ${failed ? 'FAILED' : 'ok'} (${errors.length} errors, ${warnings.length} warnings${strict ? ', strict' : ''})`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
