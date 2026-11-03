# Running cost of the hosted demo

Three costs: the VM, the provider calls each review makes, and the disk the reviews fill. The provider numbers below are **budgets** taken from the engine presets. Nothing here is measured yet: no hosted run has happened (W12-18). The last section says how to measure, and where to write the numbers.

## Host

| Item | Size | Why |
|---|---|---|
| vCPU | 8 or more | One review sandbox gets `--cpus 2` (`AUDIT_SANDBOX_CPUS`). The worker unit gets `CPUQuota=200%`. api ×2, web, nginx and Postgres need about 1 more. Image builds during a deploy use the rest |
| RAM | 32 GB | One sandbox gets `--memory 8g` (`AUDIT_SANDBOX_MEMORY`), and the worker unit gets `MemoryMax=2G`. The stack needs about 2 GB. Swap is off (`provision.sh`), so `--memory` is a hard ceiling. At `WORKER_CONCURRENCY=2` (or two worker units), two sandboxes need 16 GB |
| Disk | 200 GB SSD | See "Storage" |
| OS | Debian 12/13 or Ubuntu 22.04/24.04 | What `infra/deploy/provision.sh` supports |

This is the OD-13 size (`docs/spec/DECISIONS.md`). One worker at concurrency 1 fits in 4 vCPU / 16 GB / 120 GB if money is tight. In that case, set `OMNI_API_REPLICAS=1`. Rent by the hour and stop the VM after 2026-11-25 (`docs/ops/UPTIME.md`).

## Provider calls per review

The hosted preset is `hosted` in `engine/omniswarm.config.example.json`. The operator's `omniswarm.config.json` overrides it.

| Setting | Value | Source |
|---|---|---|
| Reviewers | `key:zai:glm-5.3` and, through OpenRouter, `qwen/qwen3.8-max-0902`, `anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, `x-ai/grok-4.7`, `google/gemini-4-argon` | preset `reviewers`, OD-04 |
| Orchestrator / alternate judge | `openrouter:anthropic/claude-opus-5.5` / `openrouter:openai/gpt-6.1-sol` | preset |
| Assignment | round-robin, 2 passes | preset `assign`, `passes` |
| Tool budget | 30 tool turns per reviewer per pass, plus a short grace | preset `toolBudget` |
| Debate | 2 rounds, at most 25 clusters, 12 tool turns per debate turn | config `debate` defaults |
| Cost ceiling | `maxCostUsd: 25` | preset |

How much one review can call:
- **Reviewer tool loops:** 6 reviewers × 2 passes = 12 loops, each at most 30 turns. Every turn resends the conversation so far, so input tokens grow with each turn.
- **Debate and judging:** up to 2 rounds over at most 25 clusters, plus the orchestrator and the judge.
- **Price reference:** Opus is $4 per million input tokens and $20 per million output tokens (OD-04). Take the other models' prices from the OpenRouter catalog and the Z.ai price list when you measure. Do not guess them.

**Ceiling, read carefully.**
- `maxCostUsd` stops a tool loop once the `usage.cost` it has summed reaches $25 (`engine/scripts/provider-openai-compat.mjs`, `runToolLoop`).
- `docs/spec/ORCHESTRATION.md` describes it as a cap for the whole run. As implemented, each loop counts only its own spend. So 12 reviewer loops plus the debate and judge calls can, in the worst case, add up to many times $25.
- Until that is settled, the hard stops are the monthly spend limit on the OpenRouter key (set it on the OpenRouter dashboard) and the prepaid balance on the Z.ai pay-as-you-go key. Set both before the first hosted run (`docs/ops/OWNER_TASKS.md`).
- The W12 wave file (W12-18) asks for a total under `--max-cost-usd 15`, but the preset says 25. One of the two needs to change. That is the lead's call.

Testnet requests pay 1 testnet NEAR (OD-08), which is worth nothing. Every review is a real cost to the owner, and the API's limits (`MAX_QUEUE`, `REQUESTS_PER_DAY`, the nginx rate limits) are the only throttle on it.

## Storage

| What | Where | Growth | Bound |
|---|---|---|---|
| Review sandbox image | Docker data root | about 8 GB (measured: `audit-sandbox` is 7.8 GB locally), rebuilt when `engine/docker/` changes | old ones: `docker image prune` (the prune timer removes dangling images after 7 days) |
| api / web images | Docker data root | about 430 MB / 410 MB per release, mostly shared layers | images of pruned releases are removed daily (`prune.sh`) |
| Releases | `/srv/omniswarm/releases` | source about 1.3 MB per release, plus `node_modules` for the api workspace and `engine/runtime` | newest 3 kept (`release.sh`) |
| Published reports | `/srv/omniswarm/reports` | one folder per review (HTML and JSON; a few MB, measure with `du -sh` after the first run) | never pruned: attestations point at them |
| Private attempt dirs | `/srv/omniswarm/work/runs` | per attempt: the engine's report copy, `result.json`, and `worker.log` (at most `ENGINE_LOG_MAX_BYTES`, 5 MB) | the worker's own hygiene keeps the newest `KEEP_RUNS` (20) finished requests and removes the rest (`apps/api`) |
| Engine staging | `/srv/omniswarm/work/{tmp,targets}` | the target checkout while a review runs (at most `MAX_REPO_KB`, 200 MB) | crash leftovers pruned after 2 days |
| Postgres | volume `pgdata` | kilobytes per request | none needed at demo scale |
| Backups | `/srv/omniswarm/backup` | 1 database dump + 1 reports tarball per night | newest 7 of each (`backup.sh`); the reports tarball grows with the reports |
| Container logs | Docker data root | json-file | 20 MB × 5 per container (`compose.yml`, `infra/hosts/daemon.json`) |
| Journal | `/var/log/journal` | worker, timers, sshd | 1 GB, 30 days (`infra/hosts/journald.conf`) |
| Docker build cache | Docker data root | each deploy builds api and web | entries older than 7 days pruned daily |

At demo scale (tens of reviews), expect about 20–30 GB used, mostly images. `omniswarm-health.timer` alerts at 80 % used on `/srv/omniswarm` and on Docker's data root (`OMNI_DISK_ALARM_PCT`). There is no automatic fix for a full disk: run `sudo /srv/omniswarm/current/infra/deploy/prune.sh`, then `docker system df` to see what is left.

## Measuring a hosted run (W12-18)

Run this on the host, once, after the first deploy. Each step is an owner action, because it spends real money.

1. Check that every reviewer of the preset finds its key. This is offline: it prints key fingerprints and makes no call. systemd reads the env file, so no key appears in a command line:
   ```sh
   sudo systemd-run --pipe --wait --uid=omniswarm -p EnvironmentFile=/etc/omniswarm/providers.env \
     -p WorkingDirectory=/srv/omniswarm/current /srv/omniswarm/current/bin/audit check-agents --reviewers \
     key:zai:glm-5.3,openrouter:qwen/qwen3.8-max-0902,openrouter:anthropic/claude-opus-5.5,openrouter:openai/gpt-6.1-sol,openrouter:x-ai/grok-4.7,openrouter:google/gemini-4-argon
   ```
2. Submit one review of a small public repository through the web app, as a normal user would.
3. Collect the numbers from the published report:
   - `meta.json`: the reviewers and their budgets
   - each reviewer's usage: calls, input and output tokens, `usage.cost`
   - wall time: `started` to `finished` in the request's timeline (`/api/requests/<id>`)
4. Fill the table and commit it.

| Reviewer | Calls | Input tokens | Output tokens | USD | Minutes |
|---|---|---|---|---|---|
| `key:zai:glm-5.3` | | | | | |
| `openrouter:qwen/qwen3.8-max-0902` | | | | | |
| `openrouter:anthropic/claude-opus-5.5` | | | | | |
| `openrouter:openai/gpt-6.1-sol` | | | | | |
| `openrouter:x-ai/grok-4.7` | | | | | |
| `openrouter:google/gemini-4-argon` | | | | | |
| orchestrator + judge | | | | | |
| **Total** | | | | | |

The total sets the mainnet price later (OD-08).
