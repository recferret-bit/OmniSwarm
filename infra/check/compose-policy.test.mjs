import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPolicy } from './compose-policy.mjs';

const hardened = { read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], restart: 'unless-stopped' };

function goodConfig() {
  return {
    services: {
      postgres: { restart: 'unless-stopped', ports: [{ host_ip: '127.0.0.1', published: '5432', target: 5432 }], environment: { POSTGRES_PASSWORD: 'pw' } },
      migrate: { ...hardened, restart: 'no', environment: { DATABASE_URL: 'postgres://o:pw@postgres/o' } },
      api: {
        ...hardened,
        environment: { DATABASE_URL: 'postgres://o:pw@postgres/o', SESSION_SECRET: 's3', ACCOUNT_KEYS_SECRET: 'a7' },
        depends_on: { migrate: { condition: 'service_completed_successfully' } },
      },
      web: { ...hardened, environment: { PORT: '3000' } },
      nginx: { ...hardened, ports: [{ host_ip: '', published: '443', target: 443 }] },
    },
  };
}

test('the shipped shape passes', () => {
  assert.deepEqual(checkPolicy(goodConfig()), []);
});

test('a fixed host port on api is caught (the W12 skeleton had 127.0.0.1:8787:8787)', () => {
  const c = goodConfig();
  c.services.api.ports = [{ host_ip: '127.0.0.1', published: '8787', target: 8787 }];
  assert.match(checkPolicy(c).join('\n'), /api publishes ports; replicas would collide/);
});

test('container_name on a scalable service is caught', () => {
  const c = goodConfig();
  c.services.web.container_name = 'web';
  assert.match(checkPolicy(c).join('\n'), /web sets container_name/);
});

test('Postgres on all interfaces is caught', () => {
  const c = goodConfig();
  c.services.postgres.ports = [{ host_ip: '', published: '5432', target: 5432 }];
  assert.match(checkPolicy(c).join('\n'), /postgres publishes 5432\/tcp on all interfaces/);
});

test('a missing restart policy is caught (the skeleton had none)', () => {
  const c = goodConfig();
  delete c.services.api.restart;
  assert.match(checkPolicy(c).join('\n'), /api restart is 'no', want unless-stopped/);
});

test('a writable root filesystem or kept capabilities are caught', () => {
  const c = goodConfig();
  c.services.web.read_only = false;
  c.services.nginx.cap_drop = [];
  const errors = checkPolicy(c).join('\n');
  assert.match(errors, /web is not read_only/);
  assert.match(errors, /nginx does not drop all capabilities/);
});

test('the Docker socket in any container is caught', () => {
  const c = goodConfig();
  c.services.api.volumes = [{ type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' }];
  assert.match(checkPolicy(c).join('\n'), /api mounts the Docker socket/);
});

test('a secret leaking to another service is caught, by name and by value', () => {
  const c = goodConfig();
  c.services.web.environment.SESSION_SECRET = 's3';
  c.services.nginx.environment = { SOMETHING: 'prefix-a7' };
  const errors = checkPolicy(c).join('\n');
  assert.match(errors, /web receives SESSION_SECRET/);
  assert.match(errors, /nginx receives the value of ACCOUNT_KEYS_SECRET under another name/);
});

test('api starting before migrations finish is caught (the skeleton had depends_on: [postgres])', () => {
  const c = goodConfig();
  c.services.api.depends_on = { migrate: { condition: 'service_started' } };
  assert.match(checkPolicy(c).join('\n'), /api must wait for migrate to complete successfully/);
});
