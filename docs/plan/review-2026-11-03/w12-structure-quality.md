# OmniSwarm audit: W12 (remote host and deploy), repo structure, code quality

Repo `<repo>`, branch `review/full-pass` (HEAD `8fd7065`), read-only pass on 2026-11-03.
Nothing in the repo was edited. No provider calls, no Docker-marked tests, no ssh. The only commands with side effects were `npm run check:infra` (it pulls and runs `nginx:alpine` and `koalaman/shellcheck` throwaway containers) and read-only `npm outdated` / `npm audit` registry queries.

---

## 1. W12: Remote Host and Deploy

### 1.1 What landed

The wave shipped as two identical commits (`c592b15`, merge `fab4844`, tag `wave-12`). It added 8 files and 128 lines:

| File | Lines | Content |
|---|---|---|
| `infra/check.sh` | 23 | compose config, shellcheck on 3 files, `nginx -t`, systemd-analyze if present (otherwise `test -f`) |
| `infra/compose/docker-compose.yml` | 23 | `postgres:16-alpine` + `api` on stock `node:24-alpine` |
| `infra/nginx/omniswarm.conf` | 20 | two `listen 80` servers |
| `infra/systemd/omniswarm-api.service` | 15 | API unit |
| `infra/systemd/omniswarm-worker.service` | 16 | "worker" unit |
| `infra/deploy/deploy.sh` | 9 | prints one line, or exits 2 when given a host |
| `infra/deploy/smoke.sh` | 9 | always exits 2 |
| `docs/plan/checks/w12-check.md` | 12 | describes the skeleton above |

Missing entirely: `infra/env/`, `infra/hosts/`, `infra/docker/`, `infra/OWNER_TASKS.md`, `.github/workflows/deploy.yml`, the `stack:local` npm scripts, and any timer or backup/restore/log-hygiene/secrets script. `infra/README.md:11` still says "Nothing is built here yet (W00 lands the folder only)."

### 1.2 Static check: issue rows against code

| ID | Gate (from plan) | Where it is (file:line) | Verdict |
|---|---|---|---|
| W12-01 | `infra/env/*.env.example` for every variable. `check:infra` fails on an undeclared variable | No `infra/env/`. `infra/check.sh:1-23` never looks at env vars. Only `backend/intake/.env.example:1-9` exists, and it lacks `ADMIN_TOKEN`, `REPORTS_ROOT`, `ENGINE_ROOT`, provider, chain and GitHub vars | **missing** |
| W12-02 | `stack.yml`: pg healthcheck, named volume, 127.0.0.1, api `env_file`, read-only rootfs, tmpfs, no socket, nginx + certbot, internal network, restart policies | `infra/compose/docker-compose.yml:1-23`: named volume yes, pg unpublished yes. No healthcheck, no `restart:`, no `env_file`, no `read_only`, no tmpfs, no network, no nginx or certbot service. The api has **no `build:` and no volume**, so `/srv/omniswarm/current` is empty in the container (`:11-13`) | **partial (does not run)** |
| W12-03 | `infra/docker/Dockerfile.api`: non-root, `npm ci --omit=dev`, HEALTHCHECK, <300 MB | Not present. Compose uses `image: node:24-alpine` (`:11`) | **missing** |
| W12-04 | TLS, HSTS, redirect, SSE 1 h timeout, reports origin CSP with `frame-ancestors`, nosniff, CORS, `limit_req`, `client_max_body_size 16k`, `/api/admin/` from 127.0.0.1 only | `infra/nginx/omniswarm.conf`: `/api/` with `proxy_buffering off` (`:6-9`) and a reports server with a CSP (`:14-19`). The CSP allows `style-src 'unsafe-inline'` and has no `frame-ancestors`. No TLS, HSTS, `proxy_read_timeout`, `limit_req`, body limit, admin ACL, CORS, nosniff or `X-Forwarded-For`. `server_name reports.localhost` only | **partial** |
| W12-05 | certbot webroot, renewal timer, staging switch | none | **missing** |
| W12-06 | `infra/hosts/provision.sh` (idempotent) | none | **missing** |
| W12-07 | worker unit with `EnvironmentFile`×4, MemoryMax/CPUQuota/TasksMax, ProtectSystem=strict, ReadWritePaths, ProtectHome, PrivateTmp, TimeoutStopSec=120 | `infra/systemd/omniswarm-worker.service:1-16` has only User, WorkingDirectory, `Restart=on-failure` and `NoNewPrivileges`. **`ExecStart` (`:11`) starts the API (`backend/intake/src/server.ts`), not the worker** (`backend/intake/scripts/worker.ts`) | **partial (wrong binary)** |
| W12-08 | `infra/hosts/SECURITY.md`, `daemon.json` (no-new-privileges, icc false, log-opts) | none | **missing** |
| W12-09 | ufw, sshd key-only, fail2ban | none | **missing** |
| W12-10 | `infra/deploy/secrets.sh`, root 0600 env files, no key in the api container | none. Compose puts secrets inline with insecure defaults: `POSTGRES_PASSWORD:-omniswarm` (`:6`), `SESSION_SECRET:-dev-session-secret` (`:16`) | **missing** |
| W12-11 | `REPORTS_ROOT=/srv/omniswarm/reports`, nginx read-only mount, retention timer, disk alarm | The worker unit sets no `REPORTS_ROOT`, so `scripts/worker.ts:13` falls back to `<repo>/reports/worker`. nginx serves `/var/www/reports` (`omniswarm.conf:17`), and nothing links the two | **missing** |
| W12-12 | nightly `pg_dump` + tar, `restore-drill.sh` | none (the cut list, HACKATHON_CUT §5 step 6, allows dropping backups) | **missing (cut-eligible)** |
| W12-13 | journald/docker/nginx rotation, `log-hygiene.sh` | none | **missing** |
| W12-14 | `deploy.sh <host> <tag> [--rollback]` | `infra/deploy/deploy.sh:4-9`: echo, or `exit 2`. HACKATHON_CUT step 6 keeps "manual deploy script only" in scope even after cuts | **missing** |
| W12-15 | `deploy.yml` workflow_dispatch | none (H+, deferred by the plan) | **missing (deferred, OK)** |
| W12-16 | `smoke.sh <host>`: 8 checks | `infra/deploy/smoke.sh:4-9` exits 2 in every branch | **missing** |
| W12-17 | `omniswarm-health.timer`, external uptime, `UPTIME.md` | none | **missing** |
| W12-18 | `infra/hosts/COST.md` from one hosted run | none | **missing** |
| W12-19 | `infra/OWNER_TASKS.md` | none | **missing** |
| W12-20 | `npm run stack:local` / `stack:local:down` | not in `package.json` | **missing** |
| W12-21 | `w12-check.md` written from the real host, tag | `docs/plan/checks/w12-check.md` describes the 2-minute local skeleton and says outright that no host is used. Tag `wave-12` exists | **done-differently** |

Tally: 0 done, 4 partial (02, 04, 07, and 21 done-differently), 17 missing. None of the Wave DoD bullets is met: smoke on host, no key in containers or logs, uptime live, COST.md.

### 1.3 Dynamic check: what `npm run check:infra` actually validates

I ran it. It exits 0 and prints `infra check ok`. What each step does:

1. `tools/gate.mjs` runs `bash infra/check.sh` because `infra/check.sh` exists.
2. `docker compose -f infra/compose/docker-compose.yml config >/dev/null` checks YAML and schema only. It passes on a service with no source code in it.
3. shellcheck (via the `koalaman/shellcheck:stable` container) runs on `check.sh`, `deploy.sh` and `smoke.sh`. The two deploy scripts are 5-line stubs, so this proves very little.
4. `nginx -t` runs in `nginx:alpine` with the conf mounted as `/etc/nginx/nginx.conf`. The syntax is OK. Nothing checks headers, TLS or rate limits.
5. On macOS, `systemd-analyze` is absent, so this step is `test -f` on the two unit files. Unit contents are never validated.

Reconciliation:
- The gate is a syntax gate. It cannot fail on any W12-01..20 acceptance condition. W12-01's own acceptance ("fails on an undeclared env var") is the gate's specified job, and it is not implemented.
- CI is weaker than the local gate. `.github/workflows/ci.yml` (job `infra`) runs `docker compose config -q` plus `shellcheck` on `infra/**/*.sh`. It has **no `nginx -t`** and no systemd step, so local and CI enforce different things.
- The W12 check doc is honest about being a skeleton. The wave file's DoD requires `smoke.sh <host>` green, so the `wave-12` tag was placed without the wave's gate passing.

### 1.4 Runtime defects (bugs, not just missing rows)

1. **The worker unit runs the API.** `infra/systemd/omniswarm-worker.service:11` has `ExecStart=/usr/bin/node backend/intake/src/server.ts`. It should be `backend/intake/scripts/worker.ts` (`npm run worker --workspace backend/intake`). On a host, both units would try to bind 8787 and the second would crash-loop.
2. **The compose api cannot start.** `docker-compose.yml:10-21` uses stock `node:24-alpine` with `working_dir: /srv/omniswarm/current`, no `build:`, no bind mount, and no `node_modules`. `docker compose up` would fail with "Cannot find module".
3. **The API is unreachable from outside its container.** `backend/intake/src/server.ts:19` has `app.listen({ host: '127.0.0.1' })`. Inside a container that is the container's loopback, so the published `127.0.0.1:8787:8787` (`compose:21`) forwards to nothing. A container needs `HOST=0.0.0.0` (configurable). nginx `proxy_pass http://127.0.0.1:8787` (`omniswarm.conf:7`) only works if nginx runs on the host, which conflicts with W12-02's plan to put nginx in compose.
4. **Two competing API deployments.** `omniswarm-api.service` (host node) and the compose `api` service both target 8787. Pick one. The plan says the API runs in compose and the worker in systemd.
5. **The worker cannot reach Postgres.** The unit sets `DATABASE_URL=postgres://omniswarm@127.0.0.1:5432/omniswarm` (`:9`), with no password. Compose never publishes Postgres (`compose:2-9`). The plan wants pg on `127.0.0.1:5432` only, so add `ports: ["127.0.0.1:5432:5432"]` and put the password in `/etc/omniswarm/worker.env`.
6. **The worker is a batch job, not a daemon.** `backend/intake/scripts/worker.ts:21-28` drains the queue, calls `pool.end()` and exits 0. With `Restart=on-failure`, a clean exit is never restarted, so after the first empty poll no worker is running. It needs a poll/LISTEN loop with backoff, or `Restart=always` plus `RestartSec`, and SIGTERM handling for `TimeoutStopSec`.
7. **`WORKER_CONCURRENCY` is dead config.** It is set in the unit (`:10`) and in INTAKE §3.8, and no code reads it (grep: only the unit and the spec mention it).
8. **The admin token is hard-coded to `dev-admin` in production.** `backend/intake/src/app.ts:52` has `config.adminToken || 'dev-admin'`, and `server.ts:9-18` never passes `adminToken` (no `ADMIN_TOKEN` env read). nginx has no `/api/admin/` allow-127.0.0.1 block. Anyone who can reach `/api/admin/requests/:id/refund` (`app.ts:206-207`) with header `x-admin-token: dev-admin` can trigger refunds (`app.ts:212` → `store.refundOnce`). Today that is a status flip plus a `mock_refund` row; once W10's real chain port is wired it becomes an on-chain `refund`. **This is the most important security finding in W12.** Fix: require `ADMIN_TOKEN` (fail at boot if unset outside tests), and add `location /api/admin/ { allow 127.0.0.1; deny all; }`.
9. **Session secret fallback.** `server.ts:11` falls back to `'dev-session-secret'`, and compose (`:16`) does the same. A misconfigured deployment silently signs cookies with a public constant. Fail closed when `NODE_ENV=production` or `NETWORK` is set.
10. **The rate limit becomes global behind a proxy.** `app.ts:53` constructs Fastify without `trustProxy`, and `app.ts:90` keys the limiter on `request.ip`. Behind nginx every client is 127.0.0.1 or the nginx container IP, so all users share one 30/min bucket, and nginx sets no `X-Forwarded-For`. The "429 after a burst" smoke check would pass for the wrong reason.
11. **Health lies.** `app.ts:79` hard-codes `workers: 0`, and `chain: {rpc: true, contract: true}` is hard-coded. An uptime check on `/api/health` cannot detect a dead worker.
12. **The engine inherits the whole worker environment.** `backend/intake/src/worker.ts:50` has `env: { ...process.env, ...env }`. `DATABASE_URL`, `SESSION_SECRET` and any admin token reach `./bin/audit`. The key policy says the engine strips before spawning reviewers. The intake side should still pass an explicit allow-list (provider vars + PATH/HOME), not the full env.

### 1.5 Horizontal scaling (N API replicas, M workers)

| Concern | API ×N | Worker ×M |
|---|---|---|
| Process model | compose has a fixed host port `127.0.0.1:8787:8787` (`compose:21`), so `--scale api=N` fails with a port collision. Needs `expose:` plus nginx `upstream` with N servers, or published port ranges | The worker is a one-shot drain (§1.4 #6). systemd needs a template unit `omniswarm-worker@.service` with `%i`, enabled M times |
| Shared state | Sessions are HMAC cookies, so they are stateless (fine if `SESSION_SECRET` is shared). The **rate limiter is an in-process `Map`** (`app.ts:51`, `lib.ts:209-218`), so each replica allows 30/min and the effective limit is N×30. Move it to nginx `limit_req` (single edge) or Postgres | Job claim uses `SELECT … FOR UPDATE SKIP LOCKED` (`store.ts:172-193`), so it is safe for M claimers |
| Startup | `createApp` runs `store.migrate(pool)` on **every** boot (`app.ts:43`), as does the worker (`scripts/worker.ts:12`). There is no `schema_migrations` table and no advisory lock, and every `.sql` runs every start (`store.ts:14-18`). Concurrent `CREATE TABLE IF NOT EXISTS` from N+M processes can race (`pg_type` unique violation). Run migrations once in deploy, or wrap them in `pg_advisory_lock` | `recoverInFlight` (`worker.ts:104-113`) **re-runs every `running` row on startup**, including jobs that another live worker owns. With M>1, a restarting worker duplicates in-flight reviews. There is no owner/lease/heartbeat column (`migrations/001_init.sql` request table). Needs `claimed_by` + `heartbeat_at`, and reclaim only after the lease expires |
| Output collisions | n/a | Duplicate runs write the same `REPORTS_ROOT/<id>` (`worker.ts:70`). Attest is idempotent (`attestOnce` ON CONFLICT), but the report dir can be clobbered mid-write |
| Queue | Spec says pg-boss (INTAKE §2, §3.7). The implementation uses a `job_stub` table + status polling (`store.ts:95`), with no retry, expiry or heartbeat | same |
| Docker host | n/a | Every worker spawns the sandbox on the same Docker daemon. M is bounded by host RAM/CPU, and there is no per-unit `MemoryMax`/`CPUQuota` to keep M workers from starving each other |

Verdict: **neither axis scales today.** M workers is the closer of the two (the DB claim is correct). It needs a lease column, a long-running loop and a template unit. N API replicas needs nginx upstream + `trustProxy` + an edge or shared rate limiter + single-shot migrations.

### 1.6 Healthchecks, restarts, secrets, backups, TLS

- **Healthchecks:** none in compose (neither `pg_isready` nor an api HTTP check), no Dockerfile HEALTHCHECK, no health timer. `depends_on: [postgres]` (`compose:18-19`) has no `condition: service_healthy`, so the api can start before pg accepts connections and then crash on `migrate`.
- **Restart policies:** compose has none (it defaults to `no`). The systemd units have `Restart=on-failure` without `RestartSec` or `StartLimit*`. As shown above, the worker exit-0 path never restarts.
- **Secrets:** inline env with public defaults in compose. A password-less `DATABASE_URL` sits inside a world-readable unit file. No `EnvironmentFile=`, and `/etc/omniswarm` is never created. The hard-coded admin token is in §1.4 #8. INTAKE §5 ("root 0600 env files") is not implemented.
- **Backups:** none. The `pgdata` named volume is the only copy.
- **TLS:** none (`listen 80` only). No HSTS, no certbot, no `reports.` cert. The reports origin's CSP is weaker than spec. The separate-origin isolation for reports only means something once both names get their own TLS hostnames.
- **Hardening missing on both units:** `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `ReadWritePaths`, `MemoryMax`, `TasksMax`, `CapabilityBoundingSet`. The API unit even `Requires=docker.service` (`omniswarm-api.service:4`), and the API has no use for Docker.

### 1.7 Minimum to make W12 real (in order)

1. Fix the worker `ExecStart`, make the worker long-running, and add `REPORTS_ROOT`/`ENGINE_ROOT`/`EnvironmentFile=`.
2. Add `infra/docker/Dockerfile.api` (copy `backend/intake` + `shared/schemas` + `packages/guard`, `npm ci --omit=dev`, non-root, HEALTHCHECK), add `HOST` env to `server.ts`, give compose `build:`, `env_file:`, `restart: unless-stopped`, healthchecks, `read_only` + tmpfs, and pg on `127.0.0.1:5432`.
3. Require `ADMIN_TOKEN` and `SESSION_SECRET` (fail closed), set `trustProxy`, add the nginx admin ACL, TLS server blocks, `limit_req` and the full reports CSP.
4. Make `check:infra` assert the env contract (grep `process.env.X` in `backend/intake` against `infra/env/*.env.example`), and add `nginx -t` to CI.
5. Write real `deploy.sh` and `smoke.sh` (the cut list keeps them). Add a lease column, then the `@`-template worker unit.

---

## 2. Root layout

### 2.1 Current map (tracked files per top-level entry, 592 tracked total)

| Entry | Files | What it is | Track | Referenced by path from (code, not docs) |
|---|---|---|---|---|
| `.claude/` | 1 | Claude-discoverable copy of the reviewer skill | E/Lead | `scripts/report-contract.test.mjs:367`, `ci.yml` `cmp`. **Cannot move** |
| `.github/` | 1 | CI | Lead | GitHub. **Cannot move** |
| `.grok/` | 1 | `workflows/near-tooling-research.rhai`, a Grok research workflow | none | **nothing references it** |
| `backend/` | 18 | `backend/intake/` Fastify API + worker | B | root `package.json` workspaces/`test:intake`/`check:w08/09`; `e2e/intake/w08.spec.ts:6-10`, `w09.spec.ts:9-11,92,123`; `e2e/landing/flow.test.mjs:7-8`; `infra/compose/docker-compose.yml:13`; both systemd units `:10/11`; `ci.yml` |
| `bin/` | 2 | `audit` CLI + `omniswarm` symlink | E | `package.json` `bin`, `check`; `backend/intake/src/worker.ts:17` argv `./bin/audit`; `e2e/engine/w03..w07`; `native/*/build.mjs` `nativeIdentity` (`codex:31`, `grok:52`); SKILL.md (both copies, line 108); AGENTS/INTAKE boundary text |
| `contracts/` | 6 | NEAR `review-registry` crate | C | `package.json` `test:contract`/`check:w10`; `ci.yml` |
| `demos/` | 3 | `attack/run.mjs` (guard demo), `dogfood/README.md` | S | `package.json` `check:w13`; `demos/attack/run.mjs:5` imports `../../packages/guard` |
| `docker/` | 5 | sandbox image + prepare scripts | E | `scripts/sandbox.sh:160` (`$AUDIT_ROOT/docker`) |
| `docs/` | 47 | operator docs, plan, spec, hackathon | Lead | SKILL.md:124 (`docs/live-model.md`), `tools/wave.mjs`, several scripts' comments |
| `e2e/` | 12 | engine/intake/landing e2e, own `package.json` + lockfile (not a workspace) | mixed | `package.json` `test:e2e` (`--prefix e2e`), `check:w03..w09` |
| `eval/` | 16 (+ignored `runs/`) | golden fixtures + runner | E | `package.json` `eval:golden`; `e2e/engine/w06:13,24,38`, `w07:110` (`eval/golden/near-escrow`); `scripts/debate-scripted.test.mjs`; `.gitignore:27` |
| `frontend/` | 18 | `landing/` Vite + React | F | `package.json` workspaces/`test:landing`/`check:w11`; `e2e/landing/flow.test.mjs:12`; `ci.yml` |
| `infra/` | 8 | compose/nginx/systemd/deploy | I | `package.json` `check:infra`; `ci.yml` |
| `native/` | 34 (+ignored `.cache/`) | Codex/Grok native admission crates + build/admit scripts | E | `bin/audit:78`; `scripts/model-cli-{codex-native,grok-native,grok-docker}.mjs` (`../native/...`); 6 tests; `.gitignore:6` |
| `packages/` | 4 | `@omniswarm/guard` | S | workspaces; `backend/intake/src/app.ts:4` and `demos/attack/run.mjs:5` **by relative path** |
| `runtime/` | 3 (+ignored `node_modules/`) | lockfile-pinned ACP adapters | E | `scripts/provider-cli.mjs:25` (`../runtime`); `.gitignore:2` |
| `scripts/` | 281 | the engine (111 modules, 64 unit tests, docker tests, fixtures) | E | `bin/audit` (≈15 paths), `package.json` (≈10 scripts), `native/*/build.mjs` (`../../scripts`), `e2e/engine/*`, `eval/run.mjs:6`, SKILL.md:108, `shared/schemas/reviewer-report.schema.json:5` (description) |
| `shared/` | 113 | `shared/schemas` JSON Schemas + canonical message | Lead | workspaces; `test:schemas`; **relative imports** in `backend/intake/src/{app,lib}.ts:3/4`, `frontend/landing/src/{wallet.ts:1,flow.test.ts:8}`, `e2e/landing/flow.test.mjs:9`, `scripts/{debate-run,report-contract,reviewer-registry,reviewer-reports,run-config}.mjs` + `debate-schema.test.mjs`; `tools/check-w00.mjs:22-23` |
| `skills/` | 2 | canonical reviewer skill + evals | E | `scripts/agent-launch.mjs:8` (`HERE/../skills/...`); `scripts/report-contract.test.mjs:366,371`; `ci.yml` `cmp` |
| `tools/` | 8 | lead dev tooling (gate, wave, worktree-env, secret sweep) | Lead | `package.json` (`gate.mjs` in 6 scripts, `check:w00`, `check:w14`); `ci.yml` (`tools/*.test.mjs`); `.gitignore` |
| `AGENTS.md`, `CLAUDE.md` | | agent rules | Lead | keep at root (tool discovery) |
| `README.md`, `LICENSE` | | | | keep |
| `RULES.md` | | swarm rules prose | Lead | `README.md:194`, `AGENTS.md:135`, `tools/check-w00.mjs:23` |
| `omniswarm.config.example.json` | | run-config example | E | `bin/audit:192` (help text), `scripts/run-config.mjs:13-14,60,68` (looks up `ROOT/omniswarm.config.json` with `ROOT = scripts/..`), `.gitignore:25` |
| `package.json`, `package-lock.json`, `.gitignore` | | | | keep |

Two engine rules are already broken today:
- `scripts/` contains module subfolders: `scripts/report-sections/*.mjs`, 8 modules loaded by `report-sections/registry.mjs:52`. AGENTS.md:98 says "Do not add subfolders under `scripts/` for modules". It works only because those modules' tests are flat (`scripts/report-section-*.test.mjs`).
- `native/codex-review/admit.mjs:9,47` and `native/grok-review/admit.mjs:9,34` set `ROOT = HERE/../../..` (the directory **above** the repo) and then use `ROOT/audit/scripts`. That is a relic of the repo's old name. `<repo>/../audit` does not exist, so the admission `node`/`docker` gates would `readdirSync` a missing directory. **The native admission is broken independent of any move** (unless the operator's checkout sits next to a sibling directory named `audit`). Fix: `ROOT = HERE/../..`, `scripts = ROOT/scripts`.

### 2.2 Target tree (root goes from 17 dirs + 6 loose files to 9 dirs + the files tools require)

```
.
├── .claude/skills/security-audit/SKILL.md   # cannot move (Claude discovery + cmp)
├── .github/workflows/ci.yml                 # cannot move
├── AGENTS.md  CLAUDE.md  README.md  LICENSE # agent/tool discovery
├── package.json  package-lock.json  .gitignore
├── bin/               # audit, omniswarm -> audit   (kept: public contract "./bin/audit")
├── apps/
│   ├── api/           # was backend/intake   (@omniswarm/intake)
│   └── web/           # was frontend/landing (@omniswarm/landing)
├── engine/
│   ├── scripts/       # flat, unchanged inside (fixtures subdirs stay)
│   ├── docker/
│   ├── native/
│   ├── skills/security-audit/
│   ├── runtime/
│   ├── eval/          # engine-owned (AGENTS track E), golden fixtures + runner
│   └── omniswarm.config.example.json
├── packages/
│   ├── schemas/       # was shared/schemas (@omniswarm/schemas)
│   └── guard/         # + demo/attack (was demos/attack)
├── contracts/review-registry/
├── infra/
├── tests/e2e/         # was e2e/ (own package.json stays)
├── tools/
└── docs/              # + RULES.md, + hackathon/dogfood (was demos/dogfood)
```

Notes on choices:
- **`bin/` stays at root.** `./bin/audit` is a documented contract: AGENTS.md "Tracks and boundaries" bullet 2, INTAKE §1, README screener, both SKILL.md copies, and the worker argv check `worker.ts:17,43`. Only `AUDIT_ROOT` inside it changes (`bin/audit:17` becomes `"$SCRIPT_DIR/../engine"`). Do **not** move `bin/audit` into `engine/bin` behind a root symlink: `bin/audit:16` resolves `BASH_SOURCE` without `readlink -f`, so a symlinked entry computes the wrong root.
- **`eval/` goes to `engine/eval`, not `tests/eval`.** It is engine-track-owned (AGENTS.md:84), `e2e/engine/*` and `scripts/debate-scripted.test.mjs` point at it, and the golden fixtures are inputs to `debate-run.mjs`, not a test runner.
- **`demos/` dissolves.** `attack/` becomes `packages/guard/demo/attack/` (only `check:w13` runs it), and `dogfood/README.md` becomes `docs/hackathon/dogfood.md`.
- **`.grok/`**: unreferenced. Delete it, or move it to `tools/research/near-tooling-research.rhai` (owner's call; Grok CLI may expect `.grok/` at the root to discover workflows).

### 2.3 Prerequisite (do before any move, near-zero risk)

Replace relative cross-package imports with workspace package names so that later moves don't touch them:
- `'../../../shared/schemas/canonical-message.mjs'` → `'@omniswarm/schemas/canonical-message'` in `backend/intake/src/app.ts:3`, `backend/intake/src/lib.ts:4`, `frontend/landing/src/wallet.ts:1`, `frontend/landing/src/flow.test.ts:8`, `e2e/landing/flow.test.mjs:9` (e2e is not a workspace, so it needs a dep or stays relative).
- `'../shared/schemas/index.mjs'` → `'@omniswarm/schemas'` in `scripts/{debate-run.mjs:10, report-contract.mjs:11, reviewer-registry.mjs:6, reviewer-reports.mjs:7, run-config.mjs:9, debate-schema.test.mjs:3}`. Caveat: the engine is copied into the sandbox and native recipes hash `scripts/*.mjs`. Confirm that engine code resolving `node_modules/@omniswarm/schemas` works inside `/trusted` (`worker-supervisor.mjs:13,75` bind-mounts individual files). If not, keep the engine's import relative.
- `'../../../packages/guard/index.mjs'` → `'@omniswarm/guard'` in `backend/intake/src/app.ts:4`, `demos/attack/run.mjs:5`.

### 2.4 Move list, ranked by risk (lowest first)

| # | Move | References to rewrite | Risk |
|---|---|---|---|
| 1 | `RULES.md` → `docs/RULES.md` | `README.md:194`, `AGENTS.md:135`, `tools/check-w00.mjs:23`, `docs/plan/waves/W14-submission-pack.md:7` (plan doc, optional) | trivial |
| 2 | `.grok/` → delete or `tools/research/` | none | trivial |
| 3 | `demos/dogfood/README.md` → `docs/hackathon/dogfood.md` | W14 wave doc only | trivial |
| 4 | `demos/attack/` → `packages/guard/demo/attack/` | `package.json` `check:w13`; `run.mjs:5` import (→ `../../index.mjs`, or the package name after §2.3); `AGENTS.md:89` track table; `packages/README.md:6`; `docs/hackathon/TRACKS.md:44`; W13 docs | low |
| 5 | `omniswarm.config.example.json` → `engine/` | `scripts/run-config.mjs:68` message; `bin/audit:192` help; `.gitignore:25`. Decide where `omniswarm.config.json` is looked up: if `run-config.mjs:13` `ROOT` stays `HERE/..`, after the engine move it becomes `engine/omniswarm.config.json`. Either accept that and update the help, or point `ROOT` at the repo root | low |
| 6 | `e2e/` → `tests/e2e/` | `package.json` `test:e2e` (`--prefix tests/e2e`, probe `tests/e2e/package.json`), `check:w03..w09` (7 scripts); every `ROOT = …'../..'` becomes `'../../..'` in `e2e/engine/w03:9, w04:10, w05:9, w06:10, w07:11`, `e2e/intake/w08:9, w09:13`, `e2e/landing/flow.test.mjs:11`; relative imports `'../../scripts/…'` (w04:8, w06:8, w07:8-9), `'../../backend/…'` (w08:6-7, w09:9-11, flow:7-8), `'../../shared/…'` (flow:9); `flow.test.mjs:17` `node_modules/vite/bin/vite.js`; `e2e/run.mjs` if it computes paths; AGENTS.md:87,133; CLAUDE.md (`test:e2e -- landing`) | low-medium (mechanical, all caught by `check:all`) |
| 7 | `shared/schemas` → `packages/schemas` | `package.json` workspaces + `test:schemas`; after §2.3 only path-based uses remain: `tools/check-w00.mjs:22-23`, `shared/schemas/index.mjs` `SCHEMA_DIR` (self-relative, fine); **CLAUDE.md** ("Edit `shared/schemas/**` only as the lead") + AGENTS.md:90,97,99,126 + `backend/README.md`, `frontend/README.md`, `contracts/README.md`, `eval/README.md`, `packages/README.md`; `docs/spec/*` mentions. Lead-only path (wave pre-step per CLAUDE.md) | medium (governance-owned, many docs) |
| 8 | `frontend/landing` → `apps/web` | workspaces glob (`apps/*`); `test:landing` probe + `--workspace`; `check:w11`; `ci.yml` landing job probe path; `e2e/landing/flow.test.mjs:12`; relative `../../../shared` in `wallet.ts:1`, `flow.test.ts:8` (depth unchanged, `apps/web/src` → `../../../` still hits root, but `shared/` is gone after #7, so do §2.3); `scripts/stack-detect.mjs:3` comment only; AGENTS.md:87,129, CLAUDE.md | medium |
| 9 | `backend/intake` → `apps/api` | workspaces; `test:intake`, `check:w08`, `check:w09`; `ci.yml` intake probe; **`backend/intake/src/worker.ts:11` `REPO_ROOT = HERE/../../..`** (depth unchanged at `apps/api/src`, but verify); `infra/compose/docker-compose.yml:13`, `infra/systemd/*.service:10/11`; `e2e/intake/*`, `e2e/landing/flow.test.mjs:7-8`; `tools/worktree-env.mjs` (per-worktree DB) if it names the path; `backend/README.md`, AGENTS.md:85,127, INTAKE.md, CLAUDE.md track list; several `scripts/*.test.mjs` use `backend/` as a *target fixture path* (`stack-detect.test`, `review-workflow.test`, `verification-health.test`…). Those name directories in synthetic target repos, not ours. Leave them | medium |
| 10 | `bin/`,`scripts/`,`docker/`,`native/`,`skills/`,`runtime/`,`eval/` → `engine/` as **one unit** (`bin/` stays at root) | **Internal anchors survive** (`agent-launch.mjs:8` `HERE/../skills`, `provider-cli.mjs:25` `../runtime`, `model-cli-*.mjs` `../native/.cache`, `sandbox.sh:11,160` `SCRIPT_DIR/..` + `/docker`, `orchestrate.sh:20`, `generate-html-report.mjs:29` / `report-pdf.mjs:37` / `verify-and-adjudicate.mjs:31` `scripts/../reports` → `engine/reports`, `audit-demo.mjs:20,101`, `run-config.mjs:13`). **Must rewrite:** `bin/audit:17-19` (`AUDIT_ROOT`, `source …/scripts/resolve-target.sh`) and every `$AUDIT_ROOT/scripts`/`native` line (`:78-142`); root `package.json` `main`, `test` (`engine/scripts/*.test.mjs`), `test:docker`, `check`, `pdf`, `eval:golden`, `check:w01`, `check:w02`, `check:w06`, `check:w07` (≈12 strings); `ci.yml` engine job (`node engine/scripts/harness.mjs`, `cmp engine/skills/… .claude/skills/…`); **`scripts/report-contract.test.mjs:366-371`** reads `root/skills/…` and `root/.claude/skills/…` from one `root`. After the move the two live under different roots, so the test needs `ENGINE_ROOT` and `REPO_ROOT`; `e2e/engine/*` paths; `eval/run.mjs:6` (`../scripts`, survives inside engine); `.gitignore` (`engine/runtime/node_modules/`, `engine/native/.cache/`, `engine/eval/runs/`, `reports/` location); `backend/intake/src/worker.ts` keeps spawning `./bin/audit` (root), fine; SKILL.md:108 mentions `scripts/generate-html-report.mjs` (**edit both copies identically**); `shared/schemas/reviewer-report.schema.json:5` description; CLAUDE.md + AGENTS.md (every `scripts/…` mention: Commands, Stack routing, Layout table, "New engine modules stay flat in `scripts/`"); README; docs/how-it-works.md, docs/live-model.md | **high** |
| 11 | (part of #10) native admission identity | `native/codex-review/build.mjs:26,31` and `native/grok-review/build.mjs:47,52` hash `../../scripts/*.mjs` and `../../bin/audit`. Inside `engine/native/`, `../../scripts` becomes `engine/scripts` (fine) but `../../bin/audit` becomes `engine/bin/audit` (**wrong**; use `../../../bin/audit`). Every existing admission receipt is invalidated (expected, so re-admit once). Fix the `admit.mjs` `ROOT/audit/scripts` relic at the same time (§2.1) | **high** (silent receipt mismatch → native reviewers refuse to start) |

Must not move: `.claude/skills/security-audit/SKILL.md`, `.github/`, `AGENTS.md`, `CLAUDE.md`, root `package.json` / lockfile. Also keep `skills/security-audit/SKILL.md` and its `.claude` twin byte-identical through every step (`ci.yml` `cmp` + `report-contract.test.mjs`).

Invariants to re-check after each move:
1. `npm test` still globs a **flat** engine test dir (`engine/scripts/*.test.mjs`).
2. `agent-launch.mjs` still stages the canonical SKILL.md (`HERE/../skills` survives only if `skills/` moves together with `scripts/`).
3. The two skill copies stay identical.
4. `docker build` context is still `…/docker` only (no repo leak into the image).
5. The intake worker still spawns `./bin/audit run` with `cwd` = repo root.
6. `node engine/scripts/harness.mjs --self-test` passes.
7. `npm run check:all` passes.

Rollout: do §2.3, then moves 1-6 in one lead pre-step commit, 7-9 in a second, 10-11 alone in a third with a native re-admit. Do not rewrite closed wave docs under `docs/plan/waves/` (372 `scripts/` mentions). Add a path-map table to `docs/plan/README.md` instead.

---

## 3. God files and god functions

Method: TypeScript compiler API over 227 tracked `.mjs/.js/.ts/.tsx` files (fixtures excluded). File thresholds use `wc -l`.

### 3.1 Production files over 350 lines

| File | Lines | Note |
|---|---|---|
| `scripts/harness.mjs` | 946 | lead-pattern tables + scanner. No function over 80 lines, so the size is pattern data. Split: `harness-patterns-{solana,near,rust,python,js}.mjs` data modules + `harness.mjs` engine |
| `scripts/sandbox-lib.mjs` | 639 | multi-command CLI (`main` 601-635) mixing copy-tree, OSV seeding, SBF artifact export, deploy compare, RPC allow-list fetch (`:561`). Split by command (`sandbox-copy`, `sandbox-osv`, `sandbox-artifacts`) |
| `scripts/audit-plans.mjs` | 625 | surface/domain spec tables (`DOMAIN_SPECS`, `PYTHON_CHECKS`) + renderers. Split data from rendering |
| `scripts/docker-agent-orchestrator.mjs` | 597 | contains the largest function in the repo (below) |
| `scripts/bridge-tools-common.mjs` | 585 | path policy, digests, exec-in-container, and the 198-line `runCommonTool` switch |
| `scripts/sandbox-inside.mjs` | 581 | in-container setup, `main` 475-576 |
| `scripts/sandbox.sh` | 538 | bash. Candidates to extract: image build/cache, network attach/detach, export |
| `scripts/generate-html-report.mjs` | 374 | top-level script (no `main`), so it is hard to test. Duplicates `findingCard` from `report-cards.mjs` |
| `contracts/review-registry/src/lib.rs` | 405 | outside the requested scope (Rust contract); mentioned for completeness |

Test files over 350 lines (acceptable, listed for completeness): `scripts/docker-mcp-bridge.test.mjs` 626, `scripts/report-contract.test.mjs` 493, `scripts/docker-agent-orchestrator.test.mjs` 444.

`backend/`, `frontend/`, `packages/`, `tools/`: no file over 350 lines. The largest are `app.ts` 235, `store.ts` 227 and `lib.ts` 225.

### 3.2 Production functions over 80 lines

| Lines | Location | Function | Suggested split |
|---|---|---|---|
| 320 | `scripts/docker-agent-orchestrator.mjs:260-579` | `runOrchestratedAudit` | phases are already pluggable (`orchestrator-phases.mjs`). Move setup / per-surface launch / resume / finalize into phase files |
| 198 | `scripts/bridge-tools-common.mjs:385-582` | `runCommonTool` | one handler per tool name (`list_files`, `read_file`, `search_code`, `list_existing_tests`, `run_existing_tests`) in a map, like the role files already do |
| 178 | `backend/intake/src/app.ts:41-218` | `createApp` | Fastify plugins per route group: `routes/challenge-quote.ts`, `routes/requests.ts`, `routes/admin.ts`, `routes/guard.ts` |
| 163 | `scripts/agent-session.mjs:57-219` | `runReviewSession` | |
| 153 | `scripts/worker-supervisor.mjs:126-278` | `runIsolated` | |
| 143 | `scripts/verify-and-adjudicate.mjs:48-190` | `adjudicate` | |
| 138 | `scripts/report-sections/registry.mjs:138-275` | `v2Extras` | |
| 133 | `scripts/model-cli-codex-native.mjs:52-184` | `createNativeReviewAdapter` (inner `withSession` 55-182, 128) | |
| 112 | `native/grok-review/build.mjs:127-238` | `prepare` | |
| 102 | `scripts/sandbox-inside.mjs:475-576` | `main` | |
| 100 | `scripts/report-contract.mjs:204-303` | `loadAuditors` | |
| 100 | `scripts/reviewer-reports.mjs:147-246` | `deriveReviewerReports` | |
| 97 | `native/grok-review/overlays.mjs:20-116` | `transformSource` | |
| 97 | `scripts/terminal-relay.mjs:8-104` | `createTerminalRelay` | |
| 97 | `scripts/worker-isolation.mjs:52-148` | `createSnapshot` | |
| 86 | `scripts/provider-openai-compat.mjs:82-167` | `runToolLoop` | |
| 86 | `scripts/review-host.mjs:29-114` | `runHostReview` | |
| 85 | `scripts/stack-detect.mjs:76-160` | `detectEcosystems` | |
| 84 | `scripts/debate-run.mjs:36-119` | `runDebate` | |
| 82 | `scripts/native-acp-agent.mjs:64-145` | `prompt` | |

Test-harness bodies over 80 lines (anonymous `test(...)` callbacks): `docker-mcp-bridge.test.mjs:376-597` (222), `e2e/intake/w08.spec.ts:22-160` (139), `sandbox-hardening.docker.mjs:32-146` (115), `e2e/landing/flow.test.mjs:47-142` (96), `grok-docker.docker.mjs:13-100` (88), `e2e/intake/w09.spec.ts:60-145` (86). These are single giant `test()` blocks. Split them into named subtests so failures localize.

---

## 4. Duplication (cluster → locations → proposed shared module)

| # | Cluster | Locations | Proposal |
|---|---|---|---|
| D1 | **Canonical JSON (sorted keys)**. Byte-identical bodies. The attestation hash depends on these agreeing | `backend/intake/src/worker.ts:22-29` `canonicalJson`; `frontend/landing/src/report-doc.ts:9-16` `canonicalJson` (same hash `canonicalJson`/339 chars); `scripts/audit-submission.mjs:8` `stable` (key-sort variant); `shared/schemas/canonical-message.mjs:7` `canonicalRequestMessage` (field-specific) | add `canonicalJson` to `shared/schemas/canonical-message.mjs` (isomorphic, already the cross-track contract) with test vectors. Import from api, web, and (if the sandbox import works) engine |
| D2 | **reportSha256** = sha256(canonical(findings) ‖ canonical(general ?? {})) | `backend/intake/src/worker.ts:31-33` (node `crypto`); `frontend/landing/src/report-doc.ts:18-22` `digestReport` (WebCrypto) | one isomorphic `reportSha256` in `@omniswarm/schemas` (async, WebCrypto works in Node 24). A drift here silently breaks on-chain verification |
| D3 | **NEP-413 payload + borsh + base58** | `backend/intake/src/lib.ts:56-76` `b58encode` ≡ `frontend/landing/src/nep413.ts:32-52` (identical body); `borshString` lib.ts:99 / nep413.ts:18; `nep413Payload` lib.ts:106 / nep413.ts:25 (Buffer vs Uint8Array); `TAG` const in both; `b58decode` only in lib.ts:78 | `packages/schemas/nep413.mjs` (or new `packages/near-auth`) on `Uint8Array`, so it works in both. Keep ed25519 verify in api |
| D4 | **Native admission** (codex vs grok) | `admittedBinary`: `scripts/model-cli-codex-native.mjs:25-44` ≈ `scripts/model-cli-grok-native.mjs:22-43` (same lstat/O_NOFOLLOW receipt read, binary stat, streamed sha256, identity); `matchesAdmission`: `native/codex-review/admit.mjs:25-31` ≈ `native/grok-review/admit.mjs:14-20`; streamed file hash: `codex admit.mjs:36-40` `digestFile` ≡ `grok admit.mjs:25-29` `hashFile` ≡ inline in both model-cli files (`:40`, `:36`); receipt writer: `codex admit.mjs` `writeReceipt` ≡ `grok admit.mjs:21-24` `write`; `privateDirectory`: `codex build.mjs:20`, `grok build.mjs:56`, `grok docker.mjs:15`; `nativeIdentity` (codex build.mjs:25-39 / grok build.mjs:45-55), `overlayLock`, `overlayManifest`, `command`, `testNative`, `hash` one-liners in both build.mjs | `native/admission-common.mjs` (`readPrivateReceipt`, `verifyAdmittedBinary(profile)`, `matchesAdmission(receipt, identity, gates, extra)`, `sha256File`, `privateDirectory`, `writePrivateJson`). `codex-review/build.mjs` already exports `openPrivateOutput`/`runGate` to grok. Finish that consolidation. Note: these files are inputs to `recipeDigest`, so the refactor forces re-admission |
| D5 | **sha256 hex one-liner** | `scripts/agent-session-store.mjs:9` `digest`, `scripts/terminal-review-contract.mjs:7` `digest`, `scripts/review-workflow.mjs:10` `hash`, `scripts/worker-isolation.mjs:24` `hash` (exported), `scripts/audit-submission.mjs:9` `fingerprint`, `scripts/verification-health.mjs:36` inline, `scripts/sandbox-lib.mjs:526` inline, `native/codex-review/build.mjs:18`, `native/grok-review/build.mjs:36`; plus 6 inline `createHash('sha256')` in `bridge-tools-common.mjs`, 2 in `report-contract.mjs`, 3 in `review-workflow.mjs` | `scripts/report-hash.mjs` (or `util-hash.mjs`; keep flat with a prefix) exporting `sha256Hex(bytes|string)` and `sha256Json(value)` (the canonical variant). `worker-isolation.mjs` already exports `hash`, so callers could reuse it today |
| D6 | **Atomic write (tmp + rename)** | `scripts/agent-session-store.mjs:30`, `scripts/audit-submission.mjs:35`, `scripts/report-contract.mjs:51` (in `writeReportFile`), `scripts/sandbox-lifecycle.mjs:53` | route all through `report-contract.mjs` `writeReportFile`, or one `atomicWriteFile(dir, name, data, mode)` |
| D7 | **Newest report dir** | `scripts/generate-html-report.mjs:28-35`, `scripts/verify-and-adjudicate.mjs:30-38` (both filter on `auditors/`), `scripts/report-pdf.mjs:37-43` (filters on `report.html`, exported) | export one `newestReportDir(root, marker)` from `report-contract.mjs`. `bin/audit` already has `report_dir_arg`, so consider resolving there only |
| D8 | **JSON file reader with fallback** | `readJson`: `scripts/generate-html-report.mjs:52`, `scripts/reviewer-reports.mjs:22`, `scripts/sandbox-lib.mjs:387`, `scripts/scripted-strategies.mjs:9`; `read`: `scripts/report-sections/registry.mjs:59`, `scripts/stack-detect.mjs:57`; raw `JSON.parse(fs.readFileSync(...))` in 24 production files (top: `docker-agent-orchestrator.mjs` 5, `reviewer-reports.mjs` 3, `bridge-tools-common.mjs` 3) | `report-contract.mjs` already has the size-capped `readReportJson`. Add `readJsonOr(root, rel, fallback, maxBytes)` there and use it everywhere a report-dir file is read. Report dirs contain target-influenced data, so the size cap matters |
| D9 | **Recursive directory walk** | `scripts/harness.mjs:273` `walk`, `scripts/sandbox-lib.mjs:131` `walk`, `scripts/stack-detect.mjs:42` `walk`, `frontend/landing/scripts/guard-bundle.mjs:21` `walk`; skip lists repeated in `audit-plans.mjs:25` and `stack-detect.mjs:13` | one `walkFiles(root, {skip, maxFiles, followSymlinks:false})` + one exported `SKIP_DIRS` in the engine. The three engine copies differ in symlink handling, so unify carefully (security-relevant) |
| D10 | **ACP agent shell** | `scripts/api-acp-agent.mjs:75-123` vs `scripts/native-acp-agent.mjs:16-60` (`update`, `save`, `initialize` reply, `session/new`/`load`/`cancel` state, `send`); stdin JSON-RPC line loop `api-acp-agent.mjs:174-194` ≈ `native-acp-agent.mjs:148-169`; MCP child client inside `api-acp-agent.mjs:30-73` (spawn, pending map, `request`) duplicates `scripts/agent-rpc.mjs:20-92` | `acp-agent-base.mjs` (`class AcpAgentBase` with session lifecycle + `serveStdio(agent)`), with `api`/`native` subclasses implementing `prompt`. Reuse `agent-rpc.mjs`'s client for the MCP child |
| D11 | **Finding card HTML** | `scripts/generate-html-report.mjs:252-265` `findingCard` vs `scripts/report-cards.mjs:13-33` `findingCard` | `generate-html-report.mjs` should import `report-cards.mjs` |
| D12 | **CLI flag parsing** | `backend/intake/scripts/mock-pay.ts:5-8` ≡ `sign-request.ts:4-7` `arg()` (identical); `scripts/harness.mjs:260` `parseArgs`, `scripts/run-config.mjs` `parseFlags`, `scripts/session-smoke.mjs:81-84` manual loop, `scripts/audit-demo.mjs` `flag()`, `scripts/docker-mcp-bridge.mjs` `parseBridgeArgs`, `scripts/terminal-model-connector.mjs` `parseConnectorArgs`, `scripts/static-cli-review.mjs` `parseStaticReview` | Use `node:util` `parseArgs` (built-in since Node 18.3, `strict: true` rejects unknown flags, which suits the "reject caller args" policy). At minimum share the backend `arg()` |
| D13 | **Test helpers** | `e2e/engine/w03.test.mjs:10` ≡ `w04.test.mjs:11` `run`; `scripts/report-contract.test.mjs:38` ≡ `scripts/verify-and-adjudicate.test.mjs:29` `save`; `scripts/grok-docker-login.test.mjs:7` ≡ `:16` `prepareRuntime` (same file, twice); `terminal-model-connector.test.mjs:77` ≡ `:123` | `e2e/engine/_helpers.mjs`; a `scripts/test-helpers.mjs` (non-`.test` name so it is not run as a test) |
| D14 | **Briefs** | `scripts/orchestrator-briefs.mjs:15` `renderBrief` vs `scripts/review-briefs.mjs:14` `renderBrief`. These are *different templates* with the same name, and one is dead (see §5) | delete or wire `orchestrator-briefs.mjs` |

Negative findings:
- **HTTP helpers across `provider-*.mjs` / `model-cli-*.mjs` are not duplicated.** There are only two `fetch(` call sites in the whole engine: `scripts/http-replay.mjs:69` (record/replay wrapper) and `scripts/sandbox-lib.mjs:561` (allow-listed RPC). `provider-key.mjs`, `provider-openrouter.mjs` and `provider-scripted.mjs` are 28-42-line family descriptors that delegate to `provider-api-launch.mjs` + `provider-openai-compat.mjs`. The family *shape* repeats (`installed`, `available`, `envAllowlist`, `vendorOf`) because it is an interface, not copy-paste.
- `loadUsage`/`money` in `report-sections/registry.mjs:119,134` vs `reviewer-reports.mjs:51,99` share names only. The bodies and data sources differ. Rename one to avoid confusion.

---

## 5. Dead code

Exclusion rule: modules loaded dynamically by a registry are not dead even with zero static importers. That covers `provider-*.mjs` (via `reviewer-families.mjs:22` `import(file)`), `bridge-tools-*.mjs` (`bridge-tools-registry.mjs:23-26` `readdirSync`), `orchestrator-phase-*.mjs` (`orchestrator-phases.mjs:25-28`), `report-sections/*.mjs` (`registry.mjs:52`) and `frontend/landing/vite.config.ts` (Vite convention). Their interface exports (`family`, `role`, `toolDefinitions`, `handlers`, `phase`) and CLI entry functions (`main`, `runDemo`, `runHostReview`…) are live too. Exports used only by tests (about 120 of them, e.g. `sandbox-lib.mjs` `copyTree`, `seedOsv`) are a deliberate test seam and are not listed.

Truly dead or unwired:

| Item | Evidence | Action |
|---|---|---|
| `scripts/orchestrator-briefs.mjs` (whole module: `renderBrief`, `briefIds`, `BRIEF_HEADINGS`, 8 templates) | Imported only by `scripts/orchestrator-briefs.test.mjs`. The debate code (`debate-run.mjs`, `debate-scripted.mjs`, `orchestrator-phase-debate.mjs`) never renders these briefs. `docs/spec/ORCHESTRATION.md:128` claims they are used | wire it into the debate prompts or delete it, and fix the spec line |
| `zod` dependency in `backend/intake/package.json` | `grep -rn zod backend/intake/{src,scripts,test}` finds nothing. Validation is hand-written. It also carries a **high** advisory (GHSA-mrhx-c7xc-m3w5) | remove it (or actually adopt zod v4 for request validation, as INTAKE §5 says) |
| `store.queuedIds` (`backend/intake/src/store.ts:153`) | no caller anywhere | delete |
| `store.reset` (`store.ts:20`) | no caller in `backend/intake/{src,scripts}`; only `e2e/intake/w08.spec.ts`/`w09.spec.ts` import it. A TRUNCATE-everything function exported from production code | move to a test helper |
| `lib.ts` `normalizeRepoUrl`, `publicKeyFromRaw`, `rawFromKey`, `signNep413` exported but only used inside `lib.ts` | static search | drop `export` |
| `mock-wallet.ts` `connectorName`, `formatPublicKey`; `flow.ts` `PHASES` exported, used internally only | static search | drop `export` |
| `WORKER_CONCURRENCY` (unit file + spec) | never read | wire or delete |
| `app.ts:79` `workers: 0`, `chain: {rpc:true, contract:true}` constants | placeholder data in a health endpoint | compute or remove |
| Mock tables `mock_key`, `mock_request`, `mock_tx`, `mock_attestation`, `mock_refund` in **production** migrations (`001_init.sql`, `002_worker.sql`) | the API and worker read them as the "chain" (`store.ts:116-227`). W10's real `ChainPort` was never wired, so attest/refund in prod write mock rows | out of scope for dead code, but flag it: the hosted path never touches the real contract |
| `.grok/workflows/near-tooling-research.rhai` | nothing references it | delete or move to `tools/` |
| `infra/README.md:11` "Nothing is built here yet", `backend/README.md:11` same | stale text | update |
| `bin/omniswarm` | symlink to `audit`, documented in AGENTS.md:9 | keep |
| `native/*/admit.mjs` `ROOT/audit/scripts` | dead path (directory does not exist) | fix (§2.1) |

---

## 6. Dependencies

| Manifest | Dep | Declared | Installed | Latest (npm, 2026-11-03) | Issue |
|---|---|---|---|---|---|
| `backend/intake` | `fastify` | `^5.3.3` | 5.12.8 | 5.x | fine. `^` range on a production service; INTAKE §2 said "pin in W08" |
| `backend/intake` | `pg` | `^8.16.3` | 8.23.1 | 8.x | fine |
| `backend/intake` | `zod` | `^3.25.76` | 3.25.76 | 4.6.7 | **unused**, and has a **high** advisory GHSA-mrhx-c7xc-m3w5 (<4.6.6). Remove it |
| `backend/intake` | *(missing)* `pg-boss`, `@fastify/rate-limit`, `@fastify/swagger`, `near-api-js` | INTAKE §2 stack | none | | the hand-rolled substitutes are a `job_stub` table + polling (no retry/expiry/heartbeat), an in-memory `Map` limiter (breaks with N replicas), an HTML `<pre>` of the OpenAPI object (`app.ts:83-85`), hand-written base58/NEP-413 with a **mock** FullAccess check (`app.ts:135` calls `store.keyPermission`, which reads the `mock_key` table, not RPC `view_access_key`). The first three are production-grade gaps |
| `frontend/landing` | `react`, `react-dom` | `^19.2.0` | 19.3.1 | 19.x | fine |
| `frontend/landing` (dev) | `vite` | `^7.1.12` | 7.3.7 | 8.3.5 | one major behind |
| `frontend/landing` (dev) | `vitest` | `^3.2.4` | 3.2.7 | 5.1.0 | two majors behind. **critical** `tinypool` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) + moderate `@vitest/mocker` advisories. Dev-only, but they run on developer machines and CI |
| `frontend/landing` (dev) | `@vitejs/plugin-react` | `^5.1.0` | 5.2.0 | 6.2.1 | one major behind (moves with vite 8) |
| `frontend/landing` (dev) | `typescript` | `^5.9.3` | 5.9.3 | 7.0.2 | major behind. Only used for `@types`/editor; no `tsc` step in any gate |
| `e2e` | `playwright-core` | `^1.56.1` | 1.56.1 | 1.64.1 | in range but stale lock; `npm update` |
| `runtime` | `@agentclientprotocol/claude-agent-acp` | `0.92.0` exact | (not installed here) | 0.100.0 | exact pin is right for the engine. Bump deliberately with `setup-agents` |
| `runtime` | `@agentclientprotocol/codex-acp` | `2.2.2` exact | (not installed) | 2.5.0 | same |
| `contracts/review-registry` | `near-sdk` | `=5.5.0` with `features = ["legacy", "unit-testing"]` | | | `unit-testing` belongs in `[dev-dependencies]`. As a normal dependency feature it pulls test-only code into the contract build. Exact pin is fine. 5.5.0 is old within the 5.x line, so run `cargo outdated` |
| `contracts/review-registry` | `borsh "1.5"`, `serde_json "1"` | caret | | | fine |
| root `package.json` | | | | | **no `"private": true`**, yet it declares `bin` + `main`, so an accidental `npm publish` would ship the engine. Root has no devDependencies, and CI shellcheck relies on the runner image. `engines` not declared, while the code needs Node ≥ 24 (type stripping in backend, `ci.yml` uses 24); only `runtime/package.json` has `engines: >=22` |
| `packages/guard`, `shared/schemas` | none | | | | dependency-free, good |

`npm audit` (root workspace): 4 vulnerabilities (2 critical, 1 high, 1 moderate). All come from `vitest`/`tinypool`/`@vitest/mocker` (dev) and `zod` (unused prod dep). `e2e`: 0.

Other dependency-adjacent notes:
- `e2e/` is not a workspace and has its own `package-lock.json`, so there are two lockfiles to keep current. Either make it a workspace (`tests/e2e` in `workspaces`) or document why it is separate (playwright download size).
- `infra/compose` uses floating tags `postgres:16-alpine`, `node:24-alpine`, and `check.sh` uses `nginx:alpine`, `koalaman/shellcheck:stable`. Pin by digest for a reproducible deploy and gate.
- The GitHub Actions use major tags (`actions/checkout@v4`, `setup-node@v4`, `dtolnay/rust-toolchain@stable`). Pin by SHA to match the engine's lockfile discipline.
