# Fixes on `review/full-pass` (2026-11-03)

Audit findings are in this folder (paths there are pre-move; see the path map in [`../README.md`](../README.md)).

## Layout after the review

```
bin/        ./bin/audit (public contract, unchanged)
apps/       api (Fastify + pg-boss), web (Next.js 16 + Zustand)
packages/   schemas (JSON Schemas, canonical message/JSON, NEP-413), guard (+ demo/attack)
engine/     scripts (flat), docker, native, skills, runtime, eval, omniswarm.config.example.json
contracts/  review-registry (near-sdk 5.30)
infra/      compose, nginx, systemd, deploy, env examples, check
tests/e2e/  engine, intake, landing
tools/      gate, wave, worktree-env, screener, secret sweep
docs/       plan, spec, hackathon, RULES.md
```

## What each track fixed

| Track | Branch merged | Headline |
|---|---|---|
| Layout | lead pre-step | non-engine tracks to `apps/`, `packages/`, `tests/`; shared canonical-json + NEP-413 helpers replace the backend/frontend copies; native admission path relic fixed |
| NEAR | fix/near | near-sdk 5.30, storage-cost check and reserve, transfer callbacks that restore state, two-step owner + treasury rotation, attest validation, paginated views, NEP-297 events, binding proof (`confirm_binding`), working deploy script; guard decision engine on the real receiver/payees with awaited lookups |
| Web | fix/web | Next.js 16 App Router + Zustand stores, components by area, `@hot-labs/near-connect`, API client generated from the schema, MSW mocks only in mock mode, nonce from `/api/challenge`, base64 NEP-413, on-chain hash check, bundle guard, axe + 360 px e2e |
| API | fix/api | layered modular monolith; pg-boss queue (singleton per request, heartbeat, retry, dead letter) enqueued in the payment tx; exactly-once attest under crash; Postgres rate-limit store and LISTEN/NOTIFY SSE across replicas; near-api-js ChainPort (FINAL, view_access_key, failover); live GitHub port; loopback admin that never signs; allow-listed engine env; advisory-locked migrations |
| Infra | fix/infra | non-root digest-pinned images, scalable compose, nginx TLS + admin deny + SSE + edge rate limit, `omniswarm-worker@` units, secrets refuse to default, backups + restore drill, deploy/release/smoke dry runs, a gate that brings the real stack up |
| Engine core | fix/engine-core | assignment-aware report contract (matrix runs validate), fail-closed digest and identity, OpenRouter ids, budgets/prices on the Docker path, one shared pass loop, usage + budget health, god functions split, helper dedup, native admission shared |
| Engine report | fix/engine-report | debate on the run's real claims, debater/orchestrator bridge roles, adjudicate + general-review phases with a cross-vendor judge, `finalStatus` in data, six distinct golden repos with computed union/majority, sectioned report v2, reviewer pages with working filters and per-render nonce, screener on exit codes and real output, secret sweep with provider-key patterns |
| Engine sandbox | fix/engine-sandbox | worker runtime mounted as its import closure, root-owned `node_modules` seal, generic plan names, harness/sandbox-lib split; Docker suite 14/33 → 34/34 |
| Debate wiring | fix/debate-wiring | debate/judge/general-review sessions through the real bridge, submission ids for the new roles, debate in the host demo, `--debate-*` flags, plan-time `scripted_judge_demo_only` |
| Contract peer rule | lead step | the report contract now expects cross-checks only from another vendor, the same rule the orchestrator uses; the Docker demo had ended INCOMPLETE because same-vendor scripted reviewers "owed" cross-checks nobody launched |
| Engine move | lead step | engine under `engine/`; `bin/audit` sets REPO_ROOT and AUDIT_ROOT; reports and config stay at the repo root |

## Second round (2026-11-04)

| Track | Branch merged | Headline |
|---|---|---|
| Demo | fix/demo-green | fixture lockfiles + client suite; image provisions cargo-near 0.22.0 and wasm32 (go-w cargo dirs); catalogued `near-build`/`near-clippy` checks; demo-only "verification limited by design" verdict (real targets still exit 2); deterministic eval RESULTS.md; sandbox-inside split |
| Quality | fix/quality (+ audit-plans split) | flat `report-section-*` modules; report-contract, worker-supervisor, audit-plans split; helper dedup; dead exports removed; judge brief, per-role forced submit and missing-turn trace fixes |
| NEAR | fix/near2 | contract v0.3.0 abuse-report blocklist (`report_address`, `is_reported`, …); near-workspaces sandbox suite (6 scenarios); guard `registryReader` and optional account-age port |
| API | fix/api2 | SIGTERM keeps the job's retry; payment replay `{status, position\|null}`; cost ledger; disk hygiene; guard reports with owner approval and worker-signed `report_address`; `GET /api/reports/:id`; mock tables only in mock mode |
| Infra | fix/infra2 | idempotent provisioning + nftables firewall; SECURITY.md; secrets check; health/prune/log-hygiene timers; dispatch-only CI deploy; UPTIME/COST/OWNER_TASKS docs |
| Docs | fix/docs | README and SUBMISSION from code, generated eval table, RULES.md from code, wave ticks matching reality |
| Sync / final | fix/sync, fix/final | web mocks and INTAKE spec match the API; scrubbed API logs; run-wide per-reviewer cost ceiling ($25); shared secret shapes |

## Gates at the end (HEAD of review/full-pass)

`check:w00` … `check:w14` all exit 0 (W02 with `OMNI_REQUIRE_HARDENING=1`): schemas 164, tools 23, engine 473, intake 73 + 1 live-only skip, intake e2e 6/7, web 57 + e2e 5, contract 86 + clippy + dry run, guard 84, infra ok. `npm run test:docker` 34/34. `infra/check.sh --apps=real` ok. `npm run test:contract:sandbox` 6/6. `./bin/audit demo --surface s1` (Docker) exits 0 with the single by-design NEAR sandbox gap. `tools/screener-check.sh` ok (gitleaks clean).

## Still open (owner steps: docs/ops/OWNER_TASKS.md)

- Testnet deploy of the registry, re-issue of the operator key with `report_address`, and a live run of the NEAR adapter.
- Native Codex/Grok admission (`node engine/native/{codex,grok}-review/admit.mjs --admit`) — builds the pinned upstream sources; never admitted before.
- Dogfood review with real models, the video, SUBMISSION.md owner fields, SECURITY.md contact address, real contract ids and domains in the env files.
- Binding proof shows account control, not code provenance (needs a reproducible-build check).
- Host-only W12 steps (w12-check.md 2–10), off-box backups, a measured cost run.
- Guard-report jobs that hit `ERR_RESERVE` have no alert; account age via NearBlocks is off by default and its response shape is unverified.
