# Fixes on `review/full-pass` (2026-11-03)

| Track | Branch merged | Headline |
|---|---|---|
| Layout | (lead pre-step) | `apps/{api,web}`, `packages/{schemas,guard}`, `tests/e2e`; shared canonical-json + NEP-413 helpers |
| NEAR | fix/near | contract on near-sdk 5.30, storage reserve, transfer callbacks, two-step owner, binding proof; guard decision engine |
| Web | fix/web | Next.js 16 + Zustand, near-connect wallet, generated API client, MSW mocks, on-chain hash check |
| API | fix/api | Fastify modular monolith, pg-boss queue, Postgres rate limits, LISTEN/NOTIFY SSE, near-api-js ChainPort, live GitHub port |
| Infra | fix/infra | Dockerfiles, scalable compose, nginx TLS, worker@ units, backups, deploy/smoke dry runs, real gate |
| Engine core | fix/engine-core | assignment-aware contract, one pass loop, budgets on Docker path, OpenRouter ids, split god functions |
| Engine report | fix/engine-report | debate on real claims, judge/general-review phases, real golden eval, sectioned report v2 |
| Engine sandbox | fix/engine-sandbox | worker runtime bundle, node_modules seal, generic plans, harness/sandbox-lib split; docker suite 34/34 |

Open: debate wiring (bridge roles, submission ids, demo debate, `--debate-*` flags), engine move to `engine/`, testnet run of the NEAR adapter, guard account-age/reported signals.
