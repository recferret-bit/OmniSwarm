# infra/

**Track:** Infra (I)
**Owning waves:** W12 (remote host and deploy).
**Owned subpaths:** `infra/` (`compose/`, `nginx/`, `systemd/`, `hosts/`, `deploy/`, `env/`, `check/`, `bin/`, `test/`), `.github/workflows/deploy.yml`, `docs/ops/`, `SECURITY.md`, plus `apps/api/Dockerfile` and `apps/web/Dockerfile`.
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
| health check + repair + alerts, retention, log hygiene | systemd timers | `systemd/omniswarm-{health,prune,log-hygiene}.*` | |
| host firewall (nftables) | systemd `omniswarm-firewall` | `hosts/omniswarm.nft`, installed by `deploy/provision.sh` | |

API containers have no host port. nginx resolves `api` and `web` through Docker's DNS on every request (`resolver 127.0.0.11 valid=2s`, `proxy_pass http://$omni_api`), so new replicas get traffic without a reload, and a stopping replica's refused connections are retried on another one. The edge rate limits (`limit_req`) live in nginx, so they hold for any number of API replicas. nginx overwrites `X-Forwarded-For`/`X-Real-IP` with the client address, which is why the API runs with `TRUST_PROXY=true`. The admin listener is `ADMIN_HOST=127.0.0.1` inside the api container: it is never published or proxied, and `/api/admin` is denied at the edge. Reach it with `docker compose exec api ...`.

### Docker access (why the worker is a systemd unit)

The worker spawns `./bin/audit`, which builds and runs the review sandbox on the host's Docker daemon. Membership in the `docker` group is root-equivalent. Putting the worker in a container would mean mounting `/var/run/docker.sock` into it, which gives root on the host to the container image and every dependency in it. The worker therefore runs on the host as `omniswarm` with `SupplementaryGroups=docker`, and that is the only process with Docker access. Compose policy fails the gate if any container mounts the socket. Mitigations in the unit: `NoNewPrivileges`, `ProtectSystem=strict` with only `/srv/omniswarm/{work,reports}` writable, `ProtectHome`, an empty capability bounding set, `@system-service` syscall filter, `MemoryMax`/`CPUQuota`/`TasksMax`. The engine's staging dirs are bind-mounted into the sandbox, and dockerd resolves those paths in the host namespace, so the unit uses `TMPDIR=/srv/omniswarm/work/tmp` and not `PrivateTmp`. The sandbox containers run under dockerd's cgroup with the engine's own `--memory`/`--cpus` limits. A dedicated single-purpose VM with no other users is assumed.

## Files

| Path | What |
|---|---|
| `compose/compose.yml` | the stack, shared by every profile |
| `compose/compose.prod.yml` | prod: `80/443` public, Postgres `127.0.0.1:5432`, certbot (run-only profile) |
| `compose/compose.dev.yml` | dev: loopback HTTP port from `env/dev.env.example` |
| `compose/compose.stub.yml` | check only: stub api/web (`test/stub/`) |
| `compose/dev-env.sh`, `compose/local.sh` | local state (random secrets) and `up`/`down`/`reset`. The local edge is HTTP |
| `nginx/nginx.conf`, `nginx/templates/`, `nginx/snippets/` | edge config. The template is rendered by the nginx image (`OMNI_*` names only) |
| `systemd/` | worker template + target; backup, renewal, health, prune and log-hygiene timers |
| `hosts/` | host config `provision.sh` installs: `daemon.json`, `omniswarm.nft` + its unit, sshd, fail2ban, journald, unattended-upgrades |
| `env/*.env.example` | the env contract (below) |
| `deploy/provision.sh`, `deploy/provision-lib.sh` | fresh VM → ready host, idempotent; on the host or `--remote <ssh-host>` |
| `deploy/secrets.sh`, `deploy/secrets-check.mjs` | owner machine → `/etc/omniswarm/` (root 0600) after a consistency check |
| `deploy/deploy.sh` | owner machine → host: `git archive` + rsync + ssh → `release.sh` |
| `deploy/release.sh` | on the host: activate / rollback a release |
| `deploy/smoke.sh` | outside-in smoke test of a running stack |
| `deploy/backup.sh`, `deploy/restore.sh`, `deploy/certbot.sh` | backups, restore drill/live restore, TLS |
| `deploy/health.sh`, `deploy/prune.sh`, `deploy/log-hygiene.sh` | the host timers (below) |
| `deploy/lib.sh` | shared helpers (compose wrapper, rolling restart, dry-run, alert hook) |
| `bin/exec-script.sh` | runs a package.json script by `exec`, so node is the main PID and gets SIGTERM (`npm run` exits at once on SIGTERM without waiting for its child) |
| `check.sh`, `check/` | the gate |

## Env contract and secrets

| File on the host (`root:root 0600`) | Example | Read by | Holds |
|---|---|---|---|
| `/etc/omniswarm/stack.env` | `env/stack.env.example` | `docker compose --env-file` only | hostnames, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ADMIN_TOKEN`, `GITHUB_TOKEN`, API settings, web build args (including the optional `NEXT_PUBLIC_DONATION_ACCOUNT` and `NEXT_PUBLIC_DONATION_USDC_CONTRACT`) |
| `/etc/omniswarm/worker.env` | `env/worker.env.example` | systemd, for the worker units | `DATABASE_URL` (127.0.0.1), `WORKER_CONCURRENCY`, `REPORTS_ROOT`, chain settings |
| `/etc/omniswarm/providers.env` | `env/providers.env.example` | systemd, for the worker units | nothing. It stays empty: a hosted review runs only on the account's own NEAR AI key (`account-nearai`), sealed under `ACCOUNT_KEYS_SECRET` (`worker.env`). The file exists because the unit loads it |
| `/etc/omniswarm/operator-key.json` | (W10) | systemd `LoadCredential=` → worker only (`OPERATOR_KEY_FILE=%d/operator-key`) | function-call key |
| `/etc/omniswarm/ops.env` | `env/ops.env.example` | systemd, for the health, prune and log-hygiene timers | alert webhook, heartbeat URL, thresholds |
| `/etc/omniswarm/omniswarm.config.json` (optional) | `engine/omniswarm.config.example.json` | `release.sh` copies it into each release; the worker resolves `HOSTED_PRESET` from it | engine presets (not secret) |

- Empty values in the examples must be set by the owner. Every compose reference to one is `${VAR:?}`, so `docker compose up` refuses to start without it. The gate proves this for each variable separately. The exceptions are optional and read as `${VAR:-}`: `GITHUB_TOKEN`, `ALLOWED_PRESETS`, `ACCOUNT_KEYS_SECRET` (`secrets-check.mjs` requires it only when `ALLOWED_PRESETS` names an `account-` preset, but no account can save its NEAR AI key without it, so set it) and the two donation build args (an empty recipient hides the donation section).
- Compose maps each value into the services that read it. Nothing is passed through wholesale. Provider keys never reach a container, and `SESSION_SECRET`/`ADMIN_TOKEN` reach only `api` (`check/compose-policy.mjs`).
- `check/env-contract.mjs` checks the contract both ways. Every variable a compose file reads is declared, every declared variable is read, examples carry no secret value, and every variable in `apps/api/.env.example` is delivered somewhere. Variables infra sets that `apps/api/.env.example` does not declare are warnings. They become errors with `OMNI_ENV_CONTRACT=strict`.
- `ops.env.example` is in the contract too. Its names are `OMNI_*`, each is read by an `infra/deploy` script, and URLs stay empty.
- Keep the owner's filled copies outside the repo (`~/.omniswarm/env/`). Install them with `infra/deploy/secrets.sh [--dry-run] <ssh-host>`. It runs `secrets-check.mjs` first, which refuses:
  - a missing or empty value (the optional ones above may stay empty)
  - `NEXT_PUBLIC_CONTRACT_ID` different from `CONTRACT_ID`
  - a worker that disagrees with the stack
  - a `DATABASE_URL` without `POSTGRES_PASSWORD`
  - a placeholder contract id
  - a donation recipient on another network than `NETWORK`
  - any variable in `providers.env`
  - short secrets
  - the contract account's key in place of the operator's

  Then it streams each file to `/etc/omniswarm/<name>` (`root:root 0600`, via a temp name and a rename) and compares hashes. It prints names and fingerprints only. At the end it lists any provider or operator variable found inside a running api container: there must be none. `docs/ops/OWNER_TASKS.md` walks through every value.

## Deploy, rollback, scale

```sh
infra/deploy/deploy.sh --dry-run <ssh-host> wave-12          # print the plan, contact nothing
infra/deploy/deploy.sh <ssh-host> wave-12 --api-replicas 2 --workers 2
infra/deploy/smoke.sh --network testnet <domain>              # 10 checks, exit 1 on any failure
infra/deploy/deploy.sh <ssh-host> --rollback
```

`release.sh activate <id>` runs on the host as root and does these steps in order:
1. `npm ci --omit=dev --ignore-scripts` for the host worker and `engine/runtime/`.
2. Installs `omniswarm.config.json` into the release (the owner's `/etc/omniswarm/omniswarm.config.json`, else the release's example), the nginx config to `OMNI_NGINX_DIR`, and the units to `/etc/systemd/system`.
3. `compose build` with tag `<id>`.
4. Issues the first certificate if none exists.
5. `compose run --rm migrate`, once.
6. Flips `/srv/omniswarm/current` atomically.
7. Rolls api and web: it starts N new containers, waits for them to be healthy, then stops the old ones one per DNS refresh, each with a 30 s drain.
8. Re-renders the nginx templates and reloads nginx.
9. Restarts `omniswarm-worker@1..M` one at a time. Each stop waits up to `TimeoutStopSec=180` for the running job.
10. Enables the timers (backup, renewal, health, prune, log hygiene) and keeps the newest 3 releases.

### CI deploy

`.github/workflows/deploy.yml` never runs on pull requests.
- On every push, job `plan` runs the deploy, rollback and smoke dry runs. It has no secrets and contacts nothing.
- On a manual dispatch with input `tag` (or `rollback`), job `deploy` runs in the protected `production` environment. It loads `DEPLOY_SSH_KEY` into an ssh-agent (the key is never written to disk), pins `DEPLOY_KNOWN_HOSTS`, runs `deploy.sh <tag>`, then `smoke.sh`.

Secrets and variables are referenced by name only. `check/workflow-policy.mjs` enforces the rules: no PR trigger, secrets only in the dispatch-only production job, expressions only in `env:`, actions pinned by SHA. Setup: `docs/ops/OWNER_TASKS.md` section 10.

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
- the nginx access-log format: truncated client address, no query string, headers or cookies
- actionlint on every workflow, and `workflow-policy.mjs` on `deploy.yml`
- dry runs of `deploy.sh`, `release.sh`, `smoke.sh`, `certbot.sh`, `backup.sh`, `restore.sh`, `health.sh`, `prune.sh` and `log-hygiene.sh`
- `timers.test.sh`: `health.sh`, `prune.sh` and `log-hygiene.sh` run against stub `curl`/`docker`/`systemctl`/`df`/`journalctl`
- `secrets-check` unit tests and the `secrets.sh` dry run
- `systemd-analyze verify` in a Debian trixie container with the tree at `/srv/omniswarm/current` (the units in `systemd/` and `hosts/`)
- `provision.sh`: its dry runs (local and `--remote`) plan every step. Then the real script runs three times in a Debian trixie container (`check/hosts-provision.test.sh`, `--no-packages`). The checks:
  - without a key it leaves sshd alone
  - the third run reports 0 changes and restarts nothing
  - `sshd -T`, `nft -f` (twice), `fail2ban-client -t` and `visudo -c` accept what it installed
  - modes and owners are as listed under "Host provisioning"

Full mode adds:
- the api image build: under 300 MB, uid 1000, no `engine/`, `bin/` or `.env`, and `/app` read-only
- a bring-up on `127.0.0.1:18480` (Postgres on `55873`) of postgres, migrate, api×2, web and nginx, which runs `smoke.sh --scheme http` against it
- with the stub: a forged `X-Forwarded-For` does not reach the api, SSE events arrive unbuffered, requests reach every replica, and `--scale api=3` gets traffic without a reload
- a rolling restart to a new image with 0 failed requests, then a backup and a restore drill
- teardown with `down --volumes`

The stub (`test/stub/`) stands in for the apps because the bring-up must not depend on other tracks' code. `--apps=real` needs an api that binds `HOST` and serves `/api/ready`, and a web package that builds Next.js `output: 'standalone'` with the server at `.next/standalone/apps/web/server.js` (the web Dockerfile fails its build otherwise).

## Host provisioning

`deploy/provision.sh` takes a fresh Debian 12/13 or Ubuntu 22.04/24.04 VM to a ready host. It is idempotent: every step compares first, and a second run prints `provision: 0 change(s)`. Run it as root on the host, or from the owner's machine with `--remote <ssh-host>`, which ships `infra/` as committed at HEAD. Every run takes `--dry-run`.

| Step | Result |
|---|---|
| packages | Docker Engine with the compose and buildx plugins (download.docker.com), Node 24 (deb.nodesource.com), rsync, git, nftables, fail2ban, unattended-upgrades. The apt keyrings must match the pinned fingerprints, and nothing is piped into a shell |
| users | `omniswarm`: system user, no login shell, group `docker`. The deploy user (`--deploy-user`, default `deploy`): `--deploy-key` in `authorized_keys`, passwordless sudo in `/etc/sudoers.d/omniswarm-deploy` (0440). `deploy.sh` runs `release.sh` as root from the tree it uploads, so this user is root-equivalent by design |
| directories | `/srv/omniswarm` 0755 root, `releases` 0755 root, `reports` 0755 omniswarm (nginx reads it), `work` 0750 omniswarm, `backup` 0700 root, `acme` and `nginx` 0755 root, `/etc/omniswarm` 0700 root |
| swap | off, and fstab entries commented out. The engine starts sandboxes with `--memory` but no `--memory-swap`, so with swap on they could swap as much again |
| Docker | `hosts/daemon.json`: `no-new-privileges`, `live-restore`, `icc: false`, json-file logs at 20 MB × 5. There is no `hosts` key, so the API never listens on TCP |
| journald | `SystemMaxUse=1G`, 30 days |
| upgrades | daily unattended security upgrades, no automatic reboot |
| firewall | `hosts/omniswarm.nft`, loaded by `omniswarm-firewall.service` (see below). An active ufw is turned off |
| sshd | `sshd_config.d/10-omniswarm.conf`: keys only, root by key only, no forwarding, 3 tries. Skipped while no account has an authorized key, so it cannot lock you out. `sshd -t` runs before the reload |
| fail2ban | the sshd jail, read from the journal, bans through nftables. 4 failures in 10 minutes earn a 1 hour ban, growing up to a week |

### Firewall

`hosts/omniswarm.nft` replaces only its own table, `inet omniswarm`, so reloading it never touches Docker's rules.
- **Input** drops by default. It accepts established traffic, loopback, the Docker bridges, DHCP replies, the essential ICMP/ICMPv6 types, and new connections to 80, 443 and 22. Port 22 allows 6 new connections per minute per address (burst 4).
- **Prerouting guard.** Docker's published ports bypass the input chain, because they are DNATed in prerouting and then forwarded. So a guard chain runs at priority -150, after conntrack and before Docker's DNAT. It drops every new TCP connection from outside to a port other than 22, 80 and 443. If Postgres (5432) or the Docker API (2375/2376) were ever published on a public address by mistake, they would still be unreachable. Compose policy already allows only nginx to publish publicly.

### Host hardening (W12-08): mitigation, and how to verify it on the host

| Mitigation | Verify |
|---|---|
| Single-purpose VM. No other login users | `getent passwd \| awk -F: '$3 >= 1000 && $7 !~ /nologin\|false/'` lists only the deploy user |
| `docker` membership (root-equivalent) only for `omniswarm`. No container mounts the socket | `getent group docker`; the compose policy gate |
| Docker API never on TCP | `ss -ltnp \| grep -E ':(2375\|2376)\b'` prints nothing; `grep -c hosts /etc/docker/daemon.json` prints 0 |
| `no-new-privileges`, `live-restore`, `icc: false`, log caps | `docker info --format '{{.SecurityOptions}} {{.LiveRestoreEnabled}}'` shows `name=no-new-privileges` and `true` |
| Postgres on loopback only | `ss -ltn '( sport = :5432 )'` shows `127.0.0.1:5432` only. From outside, `nc -vz <ip> 5432` fails |
| Firewall | `sudo nft list table inet omniswarm`. From outside, `nmap -Pn <ip>` shows only 22, 80 and 443 |
| sshd keys only | `sudo sshd -T \| grep -E '^(passwordauthentication\|permitrootlogin\|kbdinteractiveauthentication)'` shows `no`, `without-password`, `no`. From outside, `ssh -o PubkeyAuthentication=no <host>` is refused |
| fail2ban | `sudo fail2ban-client status sshd` |
| Secrets root-only | `sudo stat -c '%a %U' /etc/omniswarm /etc/omniswarm/*` shows `700 root` and `600 root`. `sudo -u omniswarm cat /etc/omniswarm/providers.env` is denied |
| Keys never in a container | `secrets.sh` post-check; `docker inspect` of the api container lists no `*_API_KEY` or operator key |
| Swap off | `swapon --show` prints nothing |
| Unattended security upgrades | `systemctl is-enabled unattended-upgrades`; `/var/log/unattended-upgrades/` |

`userns-remap` is not adopted. The engine bind-mounts host staging dirs, owned by `omniswarm`, into a sandbox that runs as uid 10001. With remapping, that uid maps to an unprivileged subordinate uid, and the bind mounts would need re-owning on every run. It stays deferred until it can be tried against `npm run test:docker` on a real host (W12-08).

## Health, retention and log hygiene

`release.sh` enables three timers. All three read `/etc/omniswarm/ops.env` (`env/ops.env.example`) and send alerts through `omni_alert` in `deploy/lib.sh`: an `ALERT` journal line, plus a JSON POST to `OMNI_ALERT_WEBHOOK_URL`. Webhook and heartbeat URLs reach curl on stdin, never in argv.

| Timer | Script | Does |
|---|---|---|
| `omniswarm-health.timer`, every minute | `deploy/health.sh` | Checks `/api/health` and `/api/ready` through nginx on 127.0.0.1, the worker units and pg-boss's live-worker count, and disk use (alarm at 80 %). After 2 failed runs in a row it restarts unhealthy containers, starts stopped ones (`up --no-recreate`) or resets failed workers, and alerts once. It alerts once more on recovery. Green runs ping `OMNI_HEARTBEAT_URL`. See `docs/ops/UPTIME.md` |
| `omniswarm-prune.timer`, daily | `deploy/prune.sh` | Removes engine staging leftovers older than 2 days, images of releases no longer on disk, and dangling images and build cache older than 7 days. `RUNS_ROOT` and orphaned published reports are left to the worker's own hygiene (`apps/api`, `KEEP_RUNS`) |
| `omniswarm-log-hygiene.timer`, daily | `deploy/log-hygiene.sh` | Searches 24 h of the `omniswarm-*` journal, every compose container's log, and recent engine `worker.log` files. It looks for the exact values of the secrets in `/etc/omniswarm` (and the operator key), and for GitHub-token, provider-key, env-assigned provider-key (`tools/secret-shapes.txt`), NEAR-secret-key and PEM shapes. It prints `HIT <rule> in <source>`, never the text, and alerts |

Log retention:
- **Containers:** json-file, 20 MB × 5 each (compose, and `daemon.json` for the sandbox containers). nginx logs to stdout, so this cap covers it: there is no logrotate.
- **Journal:** 1 GB, 30 days.
- **nginx access log:** the path without the query string, the client address truncated to /24 (IPv4) or /48 (IPv6), and no headers, cookies or referrers. The gate rejects any other format.

## Not here yet (W12 rows)

- `docs/ops/COST.md` has budgets but no measured hosted run yet (W12-18). That needs the host and real provider spend.
- Off-box backup copy (deferred in the W12 hackathon slice).
- `userns-remap` (above).
- Smoke and checks against the real host: `docs/plan/checks/w12-check.md` steps 2–8 wait for the VM and domain (`docs/ops/OWNER_TASKS.md`).
