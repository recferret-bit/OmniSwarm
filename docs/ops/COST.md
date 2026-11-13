# Running cost of the hosted demo

Two costs fall on the owner: the VM and the disk the reviews fill. Provider calls do not. A hosted review runs only on the signed-in account's own NEAR AI Cloud key, so that account pays NEAR AI Cloud for its tokens, and OmniSwarm charges users nothing (DECISIONS.md OD-26). Optional NEAR USDC donations help with the VM, the domain and coffee (README "Support the project"). The provider numbers below are **budgets** from the engine config. Nothing here is measured yet: no hosted run has happened (W12-18). The last section says how to measure, and where to write the numbers.

## Host

| Item | Size | Why |
|---|---|---|
| vCPU | 8 or more | One review sandbox gets `--cpus 2` (`AUDIT_SANDBOX_CPUS`). The worker unit gets `CPUQuota=200%`. api ×2, web, nginx and Postgres need about 1 more. Image builds during a deploy use the rest |
| RAM | 32 GB | One sandbox gets `--memory 8g` (`AUDIT_SANDBOX_MEMORY`), and the worker unit gets `MemoryMax=2G`. The stack needs about 2 GB. Swap is off (`provision.sh`), so `--memory` is a hard ceiling. At `WORKER_CONCURRENCY=2` (or two worker units), two sandboxes need 16 GB |
| Disk | 200 GB SSD | See "Storage" |
| OS | Debian 12/13 or Ubuntu 22.04/24.04 | What `infra/deploy/provision.sh` supports |

This is the OD-13 size (`docs/spec/DECISIONS.md`). One worker at concurrency 1 fits in 4 vCPU / 16 GB / 120 GB if money is tight. In that case, set `OMNI_API_REPLICAS=1`. Rent by the hour and stop the VM after 2026-11-25 (`docs/ops/UPTIME.md`).

## Provider calls per review

Who pays: the account whose NEAR AI key runs the review. The operator puts no provider key on the host (`infra/env/providers.env.example` is empty), so a hosted review costs the owner only VM time and disk.

A dashboard review runs preset `account-nearai`: the models the account chose, the first one orchestrating. Its limits:

| Setting | Value | Source |
|---|---|---|
| Reviewers | the account's chosen NEAR AI Cloud models (`nearai:<model>`) | the request's model snapshot |
| Orchestrator / alternate judge | the first model / the second model | `account-nearai` |
| Assignment | matrix, 2 passes | `apps/api/src/worker/account-config.ts` |
| Tool budget | 30 tool turns per reviewer per pass, plus a short grace | `account-config.ts` |
| Debate | 2 rounds, at most 25 clusters, 12 tool turns per debate turn | config `debate` defaults |
| Cost ceiling | `maxCostUsd: 25` per reviewer, whole run, but it binds only on a priced reply: no `prices.nearai.<model>` is configured, and whether NEAR AI Cloud returns `usage.cost` is unverified | `account-config.ts`, `docs/providers.md` "Cost" |

How much one review can call:
- **Reviewer tool loops:** each model × 2 passes, each at most 30 turns. Every turn resends the conversation so far, so input tokens grow with each turn.
- **Debate and judging:** up to 2 rounds over at most 25 clusters, plus the orchestrator and the judge.
- **Price reference:** take each model's price from NEAR AI Cloud's model list when you measure. Do not guess it.

**Ceiling, read carefully.**
- The ceiling is per reviewer for the whole run: every API turn adds its `usage.cost` to `spentUsd` in `harness/budget-<reviewer>.json` under the budget lock (`docs/spec/ORCHESTRATION.md` §3).
- A reply without `usage.cost` and a model without a configured price add nothing, so the ceiling does not bind a NEAR AI model until `prices.nearai.<model>` is set.
- The hard stop is the balance or limit on the account's own NEAR AI key.

The `hosted` preset in `engine/omniswarm.config.example.json` (six NEAR AI models, round-robin, `maxCostUsd: 25`) is not used by dashboard reviews. It would need an operator key, which OmniSwarm does not install.

The API's limits (`MAX_QUEUE`, `REQUESTS_PER_DAY`, the nginx rate limits) are the throttle on VM time.

## Storage

| What | Where | Growth | Bound |
|---|---|---|---|
| Review sandbox image | Docker data root | about 8 GB (measured: `audit-sandbox` is 7.8 GB locally), rebuilt when `engine/docker/` changes | old ones: `docker image prune` (the prune timer removes dangling images after 7 days) |
| api / web images | Docker data root | about 430 MB / 410 MB per release, mostly shared layers | images of pruned releases are removed daily (`prune.sh`) |
| Releases | `/srv/omniswarm/releases` | source about 1.3 MB per release, plus `node_modules` for the api workspace and `engine/runtime` | newest 3 kept (`release.sh`) |
| Published reports | `/srv/omniswarm/reports` | one folder per review (HTML and JSON; a few MB, measure with `du -sh` after the first run) | never pruned: users' report links point at them |
| Private attempt dirs | `/srv/omniswarm/work/runs` | per attempt: the engine's report copy, `result.json`, and `worker.log` (at most `ENGINE_LOG_MAX_BYTES`, 5 MB) | the worker's own hygiene keeps the newest `KEEP_RUNS` (20) finished requests and removes the rest (`apps/api`) |
| Engine staging | `/srv/omniswarm/work/{tmp,targets}` | the target checkout while a review runs (a few hundred MB at most) | crash leftovers pruned after 2 days |
| Postgres | volume `pgdata` | kilobytes per request | none needed at demo scale |
| Backups | `/srv/omniswarm/backup` | 1 database dump + 1 reports tarball per night | newest 7 of each (`backup.sh`); the reports tarball grows with the reports |
| Container logs | Docker data root | json-file | 20 MB × 5 per container (`compose.yml`, `infra/hosts/daemon.json`) |
| Journal | `/var/log/journal` | worker, timers, sshd | 1 GB, 30 days (`infra/hosts/journald.conf`) |
| Docker build cache | Docker data root | each deploy builds api and web | entries older than 7 days pruned daily |

At demo scale (tens of reviews), expect about 20–30 GB used, mostly images. `omniswarm-health.timer` alerts at 80 % used on `/srv/omniswarm` and on Docker's data root (`OMNI_DISK_ALARM_PCT`). There is no automatic fix for a full disk: run `sudo /srv/omniswarm/current/infra/deploy/prune.sh`, then `docker system df` to see what is left.

## Measuring a hosted run (W12-18)

Run this on the host, once, after the first deploy. Each step is an owner action, because it spends real money.

You can rehearse the same steps locally with `OMNI_LIVE=1 npm run stack:local`.

1. Sign in on the dashboard with your own account, save your own NEAR AI Cloud key, and choose the models to measure. The calls are billed to your key. Check the key is present first, on your own machine (offline: prints a fingerprint, makes no call):
   ```sh
   ./bin/audit check-agents --reviewers nearai:<model>,nearai:<model>
   ```
2. Submit one review of a small public repository from the dashboard, as a normal user would.
3. Collect the numbers from the published report:
   - `meta.json`: the reviewers and their budgets
   - each reviewer's usage: calls, input and output tokens, `usage.cost`
   - wall time: `started` to `finished` in the request's timeline (`/api/requests/<id>`)
4. Fill the table and commit it.

| Reviewer | Calls | Input tokens | Output tokens | USD | Minutes |
|---|---|---|---|---|---|
| `nearai:<model 1>` (orchestrator) | | | | | |
| `nearai:<model 2>` (alternate judge) | | | | | |
| orchestrator + judge | | | | | |
| **Total** | | | | | |

The total tells users what a review costs them on NEAR AI Cloud. OmniSwarm adds no fee.
