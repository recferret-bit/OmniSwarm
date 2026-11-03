# infra/

**Track:** Infra (I)
**Owning waves:** W12 (remote host and deploy).
**Owned subpaths:** `infra/` (`compose/`, `nginx/`, `systemd/`, `deploy/`, `env/`, `check/`, `bin/`, `test/`), plus `apps/api/Dockerfile` and `apps/web/Dockerfile`.
**Gate command:** `npm run check:infra` (`bash infra/check.sh`).
**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine (AGENTS.md, "Tracks and boundaries"). The sandbox never receives a key.

## What runs where

One Linux VM (OD-13):

| Process | Runs as | Defined in | Scales by |
|---|---|---|---|
| nginx (TLS, edge rate limits, reports origin) | compose `nginx` | `compose/compose.yml`, `nginx/` | 1 |
| API (`npm start -w @omniswarm/api`) | compose `api` | `apps/api/Dockerfile` | `OMNI_API_REPLICAS` / `--scale api=N` |
| migrations (`db:migrate`, advisory-locked) | compose `migrate`, one-shot | `apps/api/Dockerfile` | once per deploy |
| web (Next.js standalone) | compose `web` | `apps/web/Dockerfile` | 1 (rolled like api) |
| Postgres 16 | compose `postgres`, `127.0.0.1:5432` only | `compose/compose.yml` | 1 |
| review worker (`npm run worker -w @omniswarm/api`) | systemd `omniswarm-worker@N` on the host | `systemd/omniswarm-worker@.service` | M instances × `WORKER_CONCURRENCY` |
| backups, certificate renewal | systemd timers | `systemd/omniswarm-{backup,certbot-renew}.*` | |

API containers have no host port. nginx resolves `api` and `web` through Docker's DNS on every request (`resolver 127.0.0.11 valid=2s`, `proxy_pass http://$omni_api`), so new replicas get traffic without a reload, and a stopping replica's refused connections are retried on another one. The edge rate limits (`limit_req`) live in nginx, so they hold for any number of API replicas. nginx overwrites `X-Forwarded-For`/`X-Real-IP` with the client address, which is why the API runs with `TRUST_PROXY=true`. The admin listener is `ADMIN_HOST=127.0.0.1` inside the api container: it is never published or proxied, and `/api/admin` is denied at the edge. Reach it with `docker compose exec api ...`.

### Docker access (why the worker is a systemd unit)

The worker spawns `./bin/audit`, which builds and runs the review sandbox on the host's Docker daemon. Membership in the `docker` group is root-equivalent. Putting the worker in a container would mean mounting `/var/run/docker.sock` into it, which gives root on the host to the container image and every dependency in it. The worker therefore runs on the host as `omniswarm` with `SupplementaryGroups=docker`, and that is the only process with Docker access. Compose policy fails the gate if any container mounts the socket. Mitigations in the unit: `NoNewPrivileges`, `ProtectSystem=strict` with only `/srv/omniswarm/{work,reports}` writable, `ProtectHome`, an empty capability bounding set, `@system-service` syscall filter, `MemoryMax`/`CPUQuota`/`TasksMax`. The engine's staging dirs are bind-mounted into the sandbox, and dockerd resolves those paths in the host namespace, so the unit uses `TMPDIR=/srv/omniswarm/work/tmp` and not `PrivateTmp`. The sandbox containers run under dockerd's cgroup with the engine's own `--memory`/`--cpus` limits. A dedicated single-purpose VM with no other users is assumed.

## Files

| Path | What |
|---|---|
| `compose/compose.yml` | the stack, shared by every profile |
| `compose/compose.prod.yml` | prod: `80/443` public, Postgres `127.0.0.1:5432`, certbot (run-only profile) |
| `compose/compose.dev.yml` | dev: loopback ports from `env/dev.env.example` |
| `compose/compose.stub.yml` | check only: stub api/web (`test/stub/`) |
| `compose/dev-env.sh`, `compose/local.sh` | local state (random secrets, self-signed cert) and `up`/`down`/`reset` |
| `nginx/nginx.conf`, `nginx/templates/`, `nginx/snippets/` | edge config. The template is rendered by the nginx image (`OMNI_*` names only) |
| `systemd/` | worker template + target, backup and renewal timers |
| `env/*.env.example` | the env contract (below) |
| `deploy/deploy.sh` | owner machine → host: `git archive` + rsync + ssh → `release.sh` |
| `deploy/release.sh` | on the host: activate / rollback a release |
| `deploy/smoke.sh` | outside-in smoke test of a running stack |
| `deploy/backup.sh`, `deploy/restore.sh`, `deploy/certbot.sh` | backups, restore drill/live restore, TLS |
| `deploy/lib.sh` | shared helpers (compose wrapper, rolling restart, dry-run) |
| `bin/exec-script.sh` | runs a package.json script by `exec`, so node is the main PID and gets SIGTERM (`npm run` exits at once on SIGTERM without waiting for its child) |
| `check.sh`, `check/` | the gate |

## Env contract and secrets

| File on the host (`root:root 0600`) | Example | Read by | Holds |
|---|---|---|---|
| `/etc/omniswarm/stack.env` | `env/stack.env.example` | `docker compose --env-file` only | hostnames, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ADMIN_TOKEN`, `GITHUB_TOKEN`, API settings |
| `/etc/omniswarm/worker.env` | `env/worker.env.example` | systemd, for the worker units | `DATABASE_URL` (127.0.0.1), `WORKER_CONCURRENCY`, `REPORTS_ROOT`, chain settings |
| `/etc/omniswarm/providers.env` | `env/providers.env.example` | systemd, for the worker units | `ZAI_API_KEY`, `OPENROUTER_API_KEY` |
| `/etc/omniswarm/operator-key.json` | (W10) | systemd `LoadCredential=` → worker only (`OPERATOR_KEY_FILE=%d/operator-key`) | function-call key |

- Empty values in the examples must be set by the owner. Every compose reference to one is `${VAR:?}`, so `docker compose up` refuses to start without it. The gate proves this for each variable separately.
- Compose maps each value into the services that read it. Nothing is passed through wholesale. Provider keys never reach a container, and `SESSION_SECRET`/`ADMIN_TOKEN` reach only `api` (`check/compose-policy.mjs`).
- `check/env-contract.mjs` checks the contract both ways. Every variable a compose file reads is declared, every declared variable is read, examples carry no secret value, and every variable in `apps/api/.env.example` is delivered somewhere. Variables infra sets that `apps/api/.env.example` does not declare are warnings. They become errors with `OMNI_ENV_CONTRACT=strict`.
- Keep the owner's filled copies outside the repo (`~/.omniswarm/env/`). Install them as `install -o root -g root -m 0600 <file> /etc/omniswarm/`.

## Deploy, rollback, scale

```sh
infra/deploy/deploy.sh --dry-run <ssh-host> wave-12          # print the plan, contact nothing
infra/deploy/deploy.sh <ssh-host> wave-12 --api-replicas 2 --workers 2
infra/deploy/smoke.sh --network testnet <domain>              # 10 checks, exit 1 on any failure
infra/deploy/deploy.sh <ssh-host> --rollback
```

`release.sh activate <id>` runs on the host as root and does these steps in order:
1. `npm ci --omit=dev --ignore-scripts` for the host worker and `engine/runtime/`.
2. Installs the nginx config to `OMNI_NGINX_DIR` and the units to `/etc/systemd/system`.
3. `compose build` with tag `<id>`.
4. Issues the first certificate if none exists.
5. `compose run --rm migrate`, once.
6. Flips `/srv/omniswarm/current` atomically.
7. Rolls api and web: it starts N new containers, waits for them to be healthy, then stops the old ones one per DNS refresh, each with a 30 s drain.
8. Re-renders the nginx templates and reloads nginx.
9. Restarts `omniswarm-worker@1..M` one at a time. Each stop waits up to `TimeoutStopSec=180` for the running job.
10. Enables the timers and keeps the newest 3 releases.

`rollback` flips `current` back to the previous release and runs the same roll. Migrations are not undone, so each migration must stay compatible with the previous release: expand first, then contract one release later.

Scale on the host without deploying: `docker compose ... up -d --no-deps --scale api=N --wait api` for the API, and `systemctl enable --now omniswarm-worker@{1..M}` for the workers.

## TLS

`deploy/certbot.sh issue` gets one certificate for `OMNI_DOMAIN` and `OMNI_REPORTS_DOMAIN` (cert name `OMNI_DOMAIN`). It runs in standalone mode on :80 before nginx owns the port, and `--staging` or `OMNI_ACME_STAGING=1` switches to the staging CA. `omniswarm-certbot-renew.timer` renews twice a day through the `/.well-known/acme-challenge/` webroot that nginx serves on :80, then reloads nginx. Port 80 otherwise redirects to https. On :443, unknown hostnames are refused at the TLS handshake.

## Backups and restore

`omniswarm-backup.timer` runs `deploy/backup.sh` nightly (03:15 UTC ± 15 min). It writes `pg_dump -Fc` to `/srv/omniswarm/backup/db-<stamp>.dump` and a tarball of the reports dir to `reports-<stamp>.tar.gz`, and keeps the newest 7 of each (`OMNI_BACKUP_KEEP`). Backups stay on the same VM: an off-box copy is deferred (W12 hackathon slice). Copy the newest dump off the host by hand before risky work.

- **Drill (no downtime):** run `sudo /srv/omniswarm/current/infra/deploy/restore.sh drill`. It restores the newest dump into the scratch database `omniswarm_restore_drill`, prints `restored from db-…: <table>=<rows> …` next to the live counts, and drops the scratch database. The gate runs this drill against the local stack on every check.
- **Real restore:**
  1. Run `sudo infra/deploy/backup.sh` first. It takes a fresh dump of the state you are about to replace.
  2. Run `sudo infra/deploy/restore.sh live /srv/omniswarm/backup/db-<stamp>.dump --yes`. It stops `omniswarm-workers.target` and the api, runs `pg_restore --clean --if-exists --single-transaction` into `omniswarm`, then starts the api and the workers again. A failed restore rolls back as one transaction, and the old data stays.
  3. Restore the reports with `tar -xzf reports-<stamp>.tar.gz -C /srv/omniswarm` (the dir is `reports/`).
  4. Run `infra/deploy/smoke.sh <domain>`.
- Every script takes `--dry-run`.

## The gate

```sh
npm run check:infra                 # static + api image + local bring-up with stub apps (~70 s warm)
bash infra/check.sh --static        # static only (~15 s)
bash infra/check.sh --apps=real     # bring-up builds apps/api and apps/web instead of the stub
```

Static checks:
- `compose config` for prod, dev and dev+stub
- compose policy and env contract
- compose refuses to start when any one of the required values is blank
- `nginx -t` on the real config and templates for prod and dev hostnames, with assertions on the rendered config
- shellcheck and hadolint, from pinned images
- final Dockerfile stages run as non-root, every base image is digest-pinned, and every Dockerfile has a `HEALTHCHECK`
- unit tests of the checkers, and the exec wrapper's SIGTERM test
- `deploy.sh`, `release.sh` and `smoke.sh` dry runs
- `systemd-analyze verify` in a Debian trixie container with the tree at `/srv/omniswarm/current`

Full mode adds:
- the api image build: under 300 MB, uid 1000, no `engine/`, `bin/` or `.env`, and `/app` read-only
- a bring-up on `127.0.0.1:18480/18443` (Postgres on `55873`) of postgres, migrate, api×2, web and nginx, which runs `smoke.sh` against it
- with the stub: a forged `X-Forwarded-For` does not reach the api, SSE events arrive unbuffered, requests reach every replica, and `--scale api=3` gets traffic without a reload
- a rolling restart to a new image with 0 failed requests, then a backup and a restore drill
- teardown with `down --volumes`

The stub (`test/stub/`) stands in for the apps because the bring-up must not depend on other tracks' code. `--apps=real` needs an api that binds `HOST` and serves `/api/ready`, and a web package that builds Next.js `output: 'standalone'` with the server at `.next/standalone/apps/web/server.js` (the web Dockerfile fails its build otherwise).

## Not here yet (W12 rows)

These rows are not built yet:
- host provisioning, firewall and sshd hardening (`hosts/provision.sh`, W12-06, W12-09)
- `daemon.json` and `SECURITY.md` (W12-08)
- `secrets.sh` (W12-10). Install the files with `install -m 0600` as above for now.
- report retention and the disk alarm (W12-11)
- log rotation and the log-hygiene grep (W12-13). Docker logs are already capped at 20 MB × 5 per container.
- CI deploy (W12-15, `H+`)
- the uptime timer and external check (W12-17)
- `COST.md` (W12-18), which needs one hosted run
- `OWNER_TASKS.md` (W12-19)
