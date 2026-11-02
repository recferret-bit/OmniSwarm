# W12 — Remote Host & Deploy

> **Track:** Infra (I) · **Tag:** `wave-12` · **Check:** `npm run check:infra` (compose config, shellcheck, `nginx -t` in a container, unit-file lint) and `infra/deploy/smoke.sh <host>` on the real box
> **Depends on waves:** W00 (layout, `shared/schemas/`, root scripts, CI).
> **Soft dependencies:** W08 (API image entry point and migrations; a stub `/api/health` until then), W09 (worker entry point; the engine `./bin/audit demo` stands in for the smoke job), W11 (landing `dist/`; a placeholder page until then), W03 (`key:`/`openrouter:` families for the hosted preset, OD-04), W10 (testnet contract id and operator FC key).
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §1, §2, §5, §6 · [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §1.1 (key policy) · OD-04, OD-08, OD-09, OD-13
> **Owned paths:** `infra/**` (`compose/`, `docker/`, `nginx/`, `systemd/`, `deploy/`, `hosts/`, `env/`), `.github/workflows/deploy.yml`. Does not edit `docker/sandbox.Dockerfile` (engine) or `.github/workflows/ci.yml` (lead).

## Goal

One Linux VM (OD-13) serves the hosted demo from D10 until **2026-11-25** (HACKATHON.md Q-012): nginx with TLS in front of the landing, the intake API and a **separate reports origin**; Postgres and the API in Docker Compose; the **worker as a systemd service on the host** next to the Docker daemon that the engine's sandbox needs; provider keys, the operator function-call key and the GitHub token in root-only env files that never reach Postgres, the repo, the API container or the sandbox. One command deploys a tagged release over SSH and one command proves it works.

## Demo story (the check in words)

1. On a laptop: `npm run check:infra` → compose files validate, shell scripts pass shellcheck, `nginx -t` passes in a throwaway container, `systemd-analyze verify` passes on the unit files.
2. `infra/hosts/provision.sh <host>` on a fresh VM → user `omniswarm`, directories `/srv/omniswarm/{releases,reports,work,backup}`, Docker, firewall (22/80/443 only), unattended upgrades, sshd key-only.
3. `infra/deploy/secrets.sh <host>` → copies `infra/env/*.env` from the owner's machine to `/etc/omniswarm/` as `root:root 0600` and prints only key **names** and fingerprints.
4. `infra/deploy/deploy.sh <host> wave-12` → the tagged release is unpacked to `/srv/omniswarm/releases/<tag>`, the `current` symlink flips, migrations run, the sandbox image is built, services restart.
5. Open `https://<domain>/` → the landing; `https://<domain>/api/health` → `{"ok":true,"network":"testnet",…}`; `https://reports.<domain>/sample/report.html` → the sample report with a strict CSP header.
6. `infra/deploy/smoke.sh <host>` → TLS valid for both names, health ok, CSP present, rate limit answers 429 after a burst on `/api/challenge`, the worker self-test runs `./bin/audit demo` to completion on the host.
7. `infra/deploy/deploy.sh <host> --rollback` → `current` points back to the previous release and the smoke test passes again.
8. Stop the API container → the on-box health timer restarts it within 2 minutes, and the external uptime check sends one alert.

## Hackathon slice

- **All `H` rows land by the D10 gate** (the hosted end-to-end run on testnet). The uptime check runs until 2026-11-25.
- **Deferred:** GitHub Actions deploy (W12-15, `H+`), off-box backup copy, `userns-remap` for the Docker daemon (evaluated in W12-08, adopted only if the sandbox's uid 10001 still works).
- **Still true:** nothing on the host exposes Postgres or the Docker API to the network.

## Features covered

- [ ] Env contract and infra check script — W12-01
- [ ] Compose: Postgres, API, nginx, certbot — W12-02, W12-03, W12-05
- [ ] nginx: TLS, API proxy with SSE, separate reports origin with CSP, rate limits — W12-04
- [ ] Host provisioning, firewall, sshd — W12-06, W12-09
- [ ] Worker systemd unit with limits; Docker-group risk and mitigations — W12-07, W12-08
- [ ] Secrets install, root-only env files, no key in containers — W12-10
- [ ] Report storage and retention — W12-11
- [ ] Backups and a restore drill — W12-12
- [ ] Log rotation and log hygiene — W12-13
- [ ] Deploy and rollback over SSH; optional CI deploy — W12-14, W12-15
- [ ] Smoke test — W12-16
- [ ] Uptime until 2026-11-25 — W12-17
- [ ] Hosted engine readiness and measured cost per run (feeds OD-08) — W12-18
- [ ] Owner tasks — W12-19
- [ ] Local stack for development and the D10 rehearsal — W12-20
- [ ] Wave check guide and tag — W12-21

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W12-01 | Contract: `infra/` layout, env contract `infra/env/{api,worker,providers,chain,github,admin}.env.example` listing every variable from INTAKE §2–§5 and ORCHESTRATION §1.1 with owner, example value and which process may read it (API, worker, nginx; never the sandbox); `npm run check:infra` skeleton | contract | S | H | W00 | Run `npm run check:infra` → it validates that every variable read in `backend/intake` and `infra/` appears in exactly one `.env.example`, and fails on an undeclared one | INTAKE §5; ORCH §1.1 |
| W12-02 | Compose `infra/compose/stack.yml`: `postgres:16` (named volume, healthcheck, bound to `127.0.0.1` only), `api` (W12-03 image, `env_file: /etc/omniswarm/api.env`, read-only rootfs, `tmpfs /tmp`, no Docker socket), `nginx`, `certbot`; one internal network; restart policies | infra | M | H | W12-01 | `docker compose -f infra/compose/stack.yml config` passes; `docker compose up -d` locally → `curl -s localhost:<api>/api/health` answers and `ss -ltn` shows Postgres only on 127.0.0.1 | INTAKE §2 |
| W12-03 | API image `infra/docker/Dockerfile.api`: `node:24-slim`, non-root user, copies only `backend/intake/` and `shared/schemas/`, `npm ci --omit=dev --ignore-scripts`, runs TS by type stripping (OD-12), `HEALTHCHECK` on `/api/health` | infra | S | H | W12-01 | `docker build -f infra/docker/Dockerfile.api .` → image < 300 MB; `docker run --rm <img> id -u` prints a non-zero uid; the image contains no `scripts/`, `docker/` or `.env` | OD-12 |
| W12-04 | nginx `infra/nginx/`: HTTP→HTTPS, HSTS; `<domain>` serves landing `dist/` and proxies `/api/` (SSE path with `proxy_buffering off`, 1 h read timeout); `reports.<domain>` serves `/srv/omniswarm/reports` read-only with `Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-…' kept from the report, style-src 'self'; img-src 'self' data:; frame-ancestors https://<domain>`, `X-Content-Type-Options nosniff`, CORS `GET` for `https://<domain>` only; `limit_req` zones (30 r/m per IP on `/api/challenge` and `/api/quote`, 10 r/m on `/api/requests`), `client_max_body_size 16k` on `/api/`; `/api/admin/` allowed from 127.0.0.1 only | infra | M | H | W12-02 | `nginx -t` in the container passes; locally, 40 rapid `POST /api/challenge` → the tail answers 429; `curl -I https://reports.localhost/sample/report.html` shows the CSP and `frame-ancestors` headers; `/api/admin/…` from outside → 403 | INTAKE §4, §5 |
| W12-05 | TLS: certbot webroot issuance for `<domain>` and `reports.<domain>`, renewal timer that reloads nginx, staging-CA dry run switch | infra | S | H | W12-04, W12-19 (DNS) | On the host, `certbot renew --dry-run` succeeds; `smoke.sh` reports both certificates valid > 60 days | OD-13 |
| W12-06 | Provisioning `infra/hosts/provision.sh <host>` (idempotent, over SSH): Docker engine, unix user `omniswarm` in the `docker` group, `/srv/omniswarm/{releases,reports,work,backup}` owned by `omniswarm`, `/etc/omniswarm/` `root:root 0700`, Node 24, unattended security upgrades, swap off for the sandbox | infra | M | H | W12-01 | Run it twice on a fresh VM → second run changes nothing; `id omniswarm` shows group `docker`; `stat -c %a /etc/omniswarm` prints `700` | OD-13 |
| W12-07 | Worker unit `infra/systemd/omniswarm-worker.service`: `User=omniswarm`, `EnvironmentFile=/etc/omniswarm/worker.env` + `providers.env` + `chain.env` + `github.env` (read by systemd as root, so the files stay `0600 root`), `WorkingDirectory=/srv/omniswarm/current`, `MemoryMax`, `CPUQuota`, `TasksMax`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/srv/omniswarm/reports /srv/omniswarm/work`, `ProtectHome=yes`, `PrivateTmp=yes`, `Restart=on-failure`, `TimeoutStopSec=120` so a running review is cancelled cleanly | infra | S | H | W12-06 | `systemd-analyze verify` passes; on the host `systemctl show omniswarm-worker -p MemoryMax,NoNewPrivileges` shows the limits; `sudo -u omniswarm cat /etc/omniswarm/providers.env` → permission denied | INTAKE §5; ORCH §1.1 |
| W12-08 | Docker-group risk, written down and reduced: `infra/hosts/SECURITY.md` states that membership in `docker` is root-equivalent; mitigations: dedicated single-purpose VM, no other users, Docker API never on TCP, `daemon.json` with `no-new-privileges: true`, `live-restore`, `log-opts max-size`, `icc: false`; keys only in the worker's environment, which the engine already strips before spawning reviewers and never passes to the sandbox (ORCH §1.1); `userns-remap` evaluated against the sandbox's uid 10001 and adopted only if `npm run test:docker` stays green | security | S | H | W12-06 | On the host `docker info --format '{{.SecurityOptions}}'` shows `no-new-privileges`; `ss -ltn` shows no `:2375/:2376`; `SECURITY.md` lists each mitigation with how to verify it | ORCH §1.1 |
| W12-09 | Firewall and SSH: `ufw` default deny incoming, allow 22/80/443; `PasswordAuthentication no`, `PermitRootLogin prohibit-password`; fail2ban on sshd | infra | S | H | W12-06 | From outside, `nmap -Pn <host>` shows only 22, 80, 443 open; a password SSH attempt is refused | — |
| W12-10 | Secrets install `infra/deploy/secrets.sh <host>`: copies `infra/env/*.env` from the owner's machine (`~/.omniswarm/env/`, never the repo) to `/etc/omniswarm/` as `root:root 0600`; prints variable names and `sha256` fingerprints only; post-check that the API container's env has no provider key, no FC key and no admin token beyond what `api.env` declares | security | S | H | W12-07, W12-02 | Run it → output lists names + fingerprints and no value; `docker inspect api --format '{{.Config.Env}}' | grep -E 'OPENROUTER|ZAI_|OPERATOR_KEY'` → nothing | INTAKE §5 |
| W12-11 | Report storage: `REPORTS_ROOT=/srv/omniswarm/reports/<requestId>/` written by the worker, mounted read-only into nginx; `sample/` and `dogfood/` folders; retention: keep all until 2026-12-31, then a timer prunes `failed` runs older than 30 days; disk-usage alarm at 80 % | infra | S | H | W12-04, W12-06 | Copy a report folder into `REPORTS_ROOT/test/` → `https://reports.<domain>/test/report.html` serves it; `touch` from inside the nginx container fails (read-only) | INTAKE §3.9 |
| W12-12 | Backups: nightly timer runs `pg_dump -Fc` and a `tar` of `REPORTS_ROOT` into `/srv/omniswarm/backup/` (7 daily kept); `infra/deploy/restore-drill.sh` restores the latest dump into a scratch database and counts rows | infra | S | H | W12-02, W12-11 | Run the timer once, then `restore-drill.sh` → "restored: N requests, M jobs" with N equal to the live count | — |
| W12-13 | Logs: journald `SystemMaxUse=1G`, Docker `max-size 20m max-file 5`, nginx logrotate (14 days); `infra/deploy/log-hygiene.sh` greps the last 24 h of journald, Docker and nginx logs for signatures, `ed25519:` secrets, `sk-`, `ghp_`, `github_pat_` and fails on a hit | security | S | H | W12-07, W12-04 | Run `log-hygiene.sh` after the smoke job → "clean"; `journalctl --disk-usage` < 1 G | INTAKE §5 |
| W12-14 | Deploy `infra/deploy/deploy.sh <host> <tag> [--rollback]`: `git archive <tag>` → upload → `/srv/omniswarm/releases/<tag>`; `npm ci --ignore-scripts` for `backend/intake` and `runtime/` (hosted preset needs no CLI logins, OD-04); build `docker/sandbox.Dockerfile`; build landing `dist/`; run migrations; flip `current`; restart API and worker (worker waits for the running job up to `TimeoutStopSec`, then the job is retried by pg-boss); keep the last 3 releases; `--rollback` flips back | infra | M | H | W12-06, W12-07, W12-10, W12-11 | `deploy.sh <host> wave-12` then `smoke.sh` → green; `deploy.sh <host> --rollback` → `readlink /srv/omniswarm/current` shows the previous tag and smoke stays green | — |
| W12-15 | CI deploy `.github/workflows/deploy.yml`: `workflow_dispatch` only, input `tag`, SSH key and known-hosts from repo secrets, runs `deploy.sh` then `smoke.sh`; never on push | infra | S | H+ | W12-14, W12-16 | Dispatch with `tag=wave-12` → the job deploys and the smoke step is green; a push to `main` triggers nothing | — |
| W12-16 | Smoke `infra/deploy/smoke.sh <host>`: TLS for both names, `/api/health` ok and `network=testnet`, landing 200, reports CSP header, 429 after a burst, `/api/admin` 403 from outside, worker self-test `sudo -u omniswarm /srv/omniswarm/current/bin/audit demo --out /srv/omniswarm/work/smoke` completes and writes a report (OD-10; no payment, no provider call) | test | M | H | W12-14 | Run it against the host → 8 checks, all "ok", exit 0; stop nginx → it exits non-zero naming the failed check | OD-10 |
| W12-17 | Uptime until 2026-11-25: on-box `omniswarm-health.timer` (every minute: `/api/health`, restart the API container or worker after 2 failures); an external check (free uptime service or a cron on the owner's machine, owner's choice in W12-19) on `/api/health` and `/` with an email alert; `infra/hosts/UPTIME.md` records the end date | infra | S | H | W12-16 | `docker stop api` → within 2 min the timer restarts it and the external check sends one alert, then one recovery | Q-012 |
| W12-18 | Hosted engine readiness: on the host run `./bin/audit check-agents` for the hosted preset (`key:zai:glm-5.3`, `openrouter:qwen/qwen3.8-max`, a third OpenRouter vendor, orchestrator per OD-04) with `OMNI_LIVE=1`, then one real review of a small public repo through the worker; record wall time, tokens and `usage.cost` per reviewer into `infra/hosts/COST.md` to set the mainnet price later (OD-08) | test | M | H | W12-16, W03 key/openrouter families, W09 worker | `infra/hosts/COST.md` has one row per reviewer with calls, tokens, USD and minutes, and the total is below the preset's `--max-cost-usd 15` | OD-04, OD-08 |
| W12-19 | Owner tasks `infra/OWNER_TASKS.md`: VM (OD-13 size), domain + DNS A records for `<domain>` and `reports.<domain>`, Z.ai **pay-as-you-go** key (not the Coding Plan, OD-04), OpenRouter key with a monthly spend limit set on its dashboard, fine-grained GitHub token (public read only), testnet operator account and its function-call key (W10), admin token, uptime check choice, payout mainnet account (W14) | docs | S | H | W12-01 | Open `infra/OWNER_TASKS.md` → each task has where to do it, what to hand over (variable name in which `.env`), and a checkbox; nothing in it contains a real value | OD-04, OD-13 |
| W12-20 | Local stack `npm run stack:local` (compose with self-signed certs for `omniswarm.localhost` / `reports.omniswarm.localhost`, worker in the foreground with `--preset demo`) and `npm run stack:local:down`; used by the D10 rehearsal and W11's real-API e2e before the host exists | infra | S | H | W12-02, W12-04 | `npm run stack:local` → `https://omniswarm.localhost/api/health` ok and a `scripted` job reaches `done` with its report on `https://reports.omniswarm.localhost/` | OD-10 |
| W12-21 | Wave check: write `docs/plan/checks/w12-check.md` from the real host (commands, URLs, expected outputs for demo steps 1–8), gate run, tag | docs | S | H | W12-01..20 (H) | `npm run check:infra` green and `smoke.sh <host>` green; the owner follows `checks/w12-check.md` → every step matches | checks/README |

## Wave DoD

- `npm run check:infra` passes locally and in CI.
- `smoke.sh <host>` passes on the real host after a deploy and after a rollback.
- No provider key, operator key or admin token appears in the repo, in Postgres, in the API container's environment, in logs, or in any sandbox container (W12-10, W12-13).
- The uptime check is live and its end date (2026-11-25) is recorded.
- `infra/hosts/COST.md` has one measured hosted run.
- Tag `wave-12` on the merge commit.
