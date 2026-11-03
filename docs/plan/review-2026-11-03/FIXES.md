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
| Engine move | lead step | engine under `engine/`; `bin/audit` sets REPO_ROOT and AUDIT_ROOT; reports and config stay at the repo root |

## Gates at the end

`npm run check:all` (schemas 149, tools 16, intake 56 + 1 live-only skip, web 53 + typecheck, contract 70, e2e 5, infra, harness self-test, engine 453), `check:w03..w07`, `check:w13`, `eval:golden`, `tools/screener-check.sh`, `infra/check.sh --apps=real` (api ×2, web, nginx, postgres, all smoke checks), sandbox hardening + worker isolation Docker tests 17/17.

## Still open

- Native Codex/Grok admission receipts are invalidated by the engine changes: run `node engine/native/codex-review/admit.mjs --admit` and `node engine/native/grok-review/admit.mjs --admit` once.
- NEAR adapter and contract have not run against testnet; near-workspaces tests need the wasm toolchain and a sandbox binary.
- Guard: no account-age signal (no indexer) and no on-chain `report_address`/`is_reported` yet, so contracts get at most `warn`.
- Binding proof shows account control, not that the deployed code was built from the reviewed commit (needs a reproducible-build check).
- A SIGTERM-interrupted job spends its one retry; `/api/ledger` and report disk hygiene not built.
- W12 rows: provisioning, firewall, SECURITY.md, CI deploy, uptime, COST.md, OWNER_TASKS.md.
- W14 content: README sections (real review, hosted demo, NEAR table, disclosures, eval table), SUBMISSION.md fields, dogfood review + attestation.
- `--no-docker` host demo stays INCOMPLETE by design (no test catalog, scanners or cross-check without the sandbox).
- `eval:golden` rewrites `engine/eval/RESULTS.md` with the current commit on every run.
