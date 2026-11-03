// Policy over the resolved compose model (`docker compose config --format json`),
// so it judges what compose would actually run, after overlays and interpolation.
//
//   node infra/check/compose-policy.mjs <profile> <config.json>
//
// Rules:
//   - api and web are scalable: no host ports, no container_name.
//   - Only nginx publishes on non-loopback addresses; Postgres is 127.0.0.1-only.
//   - App containers (api, migrate, web, nginx) are read-only, drop all caps,
//     set no-new-privileges, and none mounts the Docker socket or is privileged.
//   - Long-running services restart unless stopped; migrate never restarts.
//   - Each secret reaches only the services that read it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCALABLE = ['api', 'web'];
export const HARDENED = ['api', 'migrate', 'web', 'nginx'];
export const LONG_RUNNING = ['postgres', 'api', 'web', 'nginx'];
// secret variable -> services allowed to receive it (by name, or inside a URL).
export const SECRET_SCOPE = {
  // api and migrate receive it inside DATABASE_URL.
  POSTGRES_PASSWORD: ['postgres', 'api', 'migrate'],
  DATABASE_URL: ['api', 'migrate'],
  SESSION_SECRET: ['api'],
  ADMIN_TOKEN: ['api'],
  GITHUB_TOKEN: ['api'],
};

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function hasDockerSocket(def) {
  return (def.volumes || []).some((v) => /docker\.sock/.test(typeof v === 'string' ? v : v.source || ''));
}

function checkPorts(name, def, errors) {
  const ports = def.ports || [];
  if (SCALABLE.includes(name) && ports.length) errors.push(`${name} publishes ports; replicas would collide (use expose + the nginx upstream)`);
  if (SCALABLE.includes(name) && def.container_name) errors.push(`${name} sets container_name; it cannot scale`);
  for (const p of ports) {
    const ip = p.host_ip || '';
    if (name !== 'nginx' && !LOOPBACK.has(ip)) errors.push(`${name} publishes ${p.published}/${p.protocol || 'tcp'} on ${ip || 'all interfaces'}; only nginx may be public`);
  }
}

function checkHardening(name, def, errors) {
  if (hasDockerSocket(def)) errors.push(`${name} mounts the Docker socket`);
  if (def.privileged) errors.push(`${name} is privileged`);
  if (!HARDENED.includes(name)) return;
  if (def.read_only !== true) errors.push(`${name} is not read_only`);
  if (!(def.cap_drop || []).includes('ALL')) errors.push(`${name} does not drop all capabilities`);
  if (!(def.security_opt || []).some((o) => /^no-new-privileges(:true)?$/.test(o))) errors.push(`${name} lacks no-new-privileges`);
}

function checkRestart(name, def, errors) {
  if (LONG_RUNNING.includes(name) && def.restart !== 'unless-stopped') errors.push(`${name} restart is '${def.restart || 'no'}', want unless-stopped`);
  if (name === 'migrate' && def.restart && def.restart !== 'no') errors.push(`migrate restart is '${def.restart}'; a one-shot must not loop`);
}

function checkSecrets(services, errors) {
  for (const [secret, allowed] of Object.entries(SECRET_SCOPE)) {
    const value = services[allowed[0]]?.environment?.[secret];
    for (const [name, def] of Object.entries(services)) {
      if (allowed.includes(name)) continue;
      const env = def.environment || {};
      if (secret in env) errors.push(`${name} receives ${secret}`);
      if (value && Object.values(env).some((v) => typeof v === 'string' && v.includes(value))) {
        errors.push(`${name} receives the value of ${secret} under another name`);
      }
    }
  }
}

export function checkPolicy(config) {
  const errors = [];
  const services = config.services || {};
  for (const required of ['postgres', 'migrate', 'api', 'web', 'nginx']) {
    if (!services[required]) errors.push(`service ${required} is missing`);
  }
  for (const [name, def] of Object.entries(services)) {
    checkPorts(name, def, errors);
    checkHardening(name, def, errors);
    checkRestart(name, def, errors);
  }
  if (services.api && !services.api.depends_on?.migrate) errors.push('api does not wait for migrate');
  if (services.api?.depends_on?.migrate && services.api.depends_on.migrate.condition !== 'service_completed_successfully') {
    errors.push('api must wait for migrate to complete successfully');
  }
  checkSecrets(services, errors);
  return errors;
}

function main([profile, file]) {
  const errors = checkPolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const e of errors) console.log(`  error: ${e}`);
  console.log(`  compose policy (${profile}): ${errors.length ? 'FAILED' : 'ok'}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
