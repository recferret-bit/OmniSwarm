# W09 — Queue & Worker

> **Track:** Intake (B) · **Tag:** `wave-09` · **Check:** `npm run check:w09` (unit + Postgres integration + `e2e/intake/w09.spec.ts`)
> **Depends on waves:** W08 (DB, `ChainPort` + mock, `enqueueReview` stub, request statuses, `sid`). Soft: W03 `scripted` family and `--preset` (until it lands the worker runs a **mock engine runner**; the real engine runs with the `scripted` preset as soon as W03 is in `main`, and the hosted preset per OD-04 after W04/W06); W05 `reviewers/*/usage.json` (cost ledger reads it when present); W10 testnet `ChainPort` (attest/refund go real when it lands).
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §1, §3 steps 7–10, §5 · [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §1 (presets), §6 (report layout) · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-04, OD-07, OD-13
> **Owned paths:** `backend/intake/src/{queue,worker,publish,ledger}/**`, `backend/intake/migrations/*_w09_*.sql`, `backend/intake/test/{queue,worker,publish,ledger}/**`, `backend/intake/test/fixtures/engine-report/**`, `e2e/intake/w09.spec.ts`, `docs/plan/checks/w09-check.md`. Uses without owning: W08 paths (one hook: W09-02 replaces the `enqueueReview` stub body — agreed hand-off point), `infra/**` (W12 packages the worker as a systemd unit).
> **Change requests to the lead:** CR-09a `shared/schemas/job.schema.json` fields `{requestId, requestHash, repo, commitSha, preset, network, outDir}` and the engine exit contract (exit code + `meta.json.finalized` + `report-health.json.state`); CR-09b root script `check:w09`.

## Goal

A paid request becomes a **durable pg-boss job**. One worker process takes it, runs the engine as a black box (`./bin/audit run --github <repo> --ref <sha> --preset <preset> --out <dir>`, argv array, no shell), streams progress into Postgres and SSE, publishes the report read-only, computes a canonical `reportSha256`, and then **attests** it through `ChainPort` — or **refunds** on infra failure (OD-07). A crash at any point is recovered without double runs, double attestations or double refunds.

## Demo story (the check in words)

1. Run W08's demo to step 6 (a `queued` request), then `npm run worker -w backend/intake` with `ENGINE_RUNNER=mock` → within seconds the request goes `queued → running`, `GET /api/requests/:id/events` streams `{phase:"review", reviewer:"scripted-baseline", pass:1, percent:40}` … `{phase:"report", percent:100}`.
2. The request reaches `done`: `reportUrl` points at `/reports/<requestId>/report.html`, `reportSha256` is 64 hex, `attestTx` is a `mock:` hash; `/dev/chain` (mock table) shows `review_attested` with the same hash.
3. `node backend/intake/scripts/report-hash.ts reports/<requestId>` → prints the same `reportSha256` (anyone can recompute it).
4. `ENGINE_RUNNER=real HOSTED_PRESET=scripted` with Docker running (needs W03 in `main`) → the same flow with the real engine on the W08 demo repo; `reviewers/index.json` appears in the published folder.
5. Make the mock engine exit with `sandbox_failed` (`MOCK_ENGINE_FAIL=infra`) → status `failed → refunded`, `refundTx` set, the mock chain shows `review_refunded`. With `MOCK_ENGINE_FAIL=findings` (a completed run with critical findings) → `done`, no refund.
6. Kill the worker (`kill -9`) mid-run, restart it → the job resumes or re-runs once (pg-boss retry), the request ends `done` with exactly **one** attestation; killing it between "attest sent" and "status written" also ends with one attestation (idempotent by `request_hash`).
7. Enqueue 3 requests with `WORKER_CONCURRENCY=1` → they run one at a time, `GET /api/requests/:id` shows `position` 1, 2, 3 decreasing.
8. `GET /api/ledger` → per-request rows `{requestId, repo, priceYocto, costUsd, reviewers, status}` and totals (H+, track 04).
9. `curl -X POST localhost:<port>/api/admin/requests/:id/refund -H "x-admin-token: …"` on a `done` request → `409 REFUND_NOT_ALLOWED`; on a stuck `running` request → refunded.

## Hackathon slice

- **The hackathon check covers demo steps:** 1, 2, 3, 5, 6, 7, 9 with the mock engine; step 4 runs in the D10 gate once W03 is in `main`. `e2e/intake/w09.spec.ts` tags them `@hack`.
- **Deferred:** step 8 (ledger, `H+`), cancellation by the requester, priority queues, multi-host workers.
- **Still true:** the engine is invoked with argv only; the worker never passes `--rpc` or any flag outside an allow-list; keys reach only the engine process env named by the preset (ORCHESTRATION §1.1), never Postgres or logs.

## Features covered

- [x] Job contract and engine exit contract (CR-09a) — W09-01
- [x] pg-boss bootstrap with long-job settings; `enqueueReview` in the payment transaction — W09-02, W09-03
- [ ] Engine runner interface; mock runner writing a fixture report; real runner spawning `./bin/audit` with argv — W09-04, W09-05, W09-06
- [x] Preset resolution (`scripted` → hosted per OD-04) and per-preset env allow-list — W09-07
- [x] Progress from `meta.json`/`workers.json`/`reviewers/*/usage.json` into `request_progress`; SSE endpoint — W09-08, W09-09
- [x] Publish: copy, read-only permissions, canonical `reportSha256` — W09-10, W09-11
- [x] Attest via `ChainPort` (`mark_running`, `attest`) with idempotency — W09-12
- [x] Failure classification and refund policy OD-07 — W09-13, W09-14
- [x] Concurrency, queue position, crash recovery — W09-15, W09-16
- [x] Admin refund — W09-17
- [ ] Cost ledger and public ledger data (H+) — W09-18
- [ ] Engine disk hygiene (old run dirs, Docker leftovers) — W09-19
- [x] Wave check, owner guide, tag — W09-20

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W09-01 | Contract: job payload and engine exit contract (CR-09a): `job.schema.json` validated on enqueue and dequeue; exit mapping `exit 0 + finalized + state∈{COMPLETE,INCOMPLETE}` → `completed`; known infra causes (`sandbox_failed`, `provider_unavailable`, `timeout`, `docker_unavailable`) → `infra_failed`; anything else → `engine_error` | contract | S | H | — | `npm run test:intake -- job-contract` → valid/invalid payload fixtures pass/fail; the 6 exit fixtures map to the 3 outcomes | INTAKE §3 steps 8–10 |
| W09-02 | pg-boss bootstrap (`src/queue/boss.ts`): schema `pgboss` in the same DB, queue `review`, `expireInSeconds: 7200`, `heartbeatSeconds: 30`, `retryLimit: 1`, `retryDelay: 60`; replace W08's `enqueueReview` stub with `boss.send(…, {singletonKey: requestHash})` inside the caller's DB transaction | server | M | H | W09-01 | Integration test: enqueue the same `requestHash` twice → one job; rolling back the payment transaction leaves no job | INTAKE §3 step 7 |
| W09-03 | Queue position and depth: `position` = rank among `queued` by `created_at`; `queueDepth` used by W08 quote now counts pg-boss `created+active` | server | S | H | W09-02 | Enqueue 3 → `GET /api/requests/:id` shows positions 1, 2, 3; after one completes they show 1, 2 | INTAKE §4 |
| W09-04 | `EngineRunner` interface (`run(job, onProgress, signal) → {outcome, outDir, cause}`) and `MockEngineRunner`: copies `test/fixtures/engine-report/` (a real report v2 shape: `meta.json`, `reviewers/`, `debate/`, `general-review.*`, `findings-and-scores.json`, `report.html`) into `outDir` with timed progress; `MOCK_ENGINE_FAIL=infra|findings|crash` | server | M | H | W09-01 | Unit test: the mock runner produces the fixture tree and 5 progress callbacks; `MOCK_ENGINE_FAIL=infra` → `{outcome:"infra_failed", cause:"sandbox_failed"}` | ORCHESTRATION §6 |
| W09-05 | `RealEngineRunner`: `spawn(ENGINE_ROOT + "/bin/audit", ["run","--github",repo,"--ref",sha,"--preset",preset,"--out",outDir], {shell:false, env: presetEnv})`; argv built from validated fields only; a fixed flag allow-list (`run --github --ref --preset --out`) asserted in a unit test; SIGTERM → SIGKILL on abort; stdout/stderr to `outDir/../worker.log` (host-only) | server | M | H | W09-04, W09-07 | Unit test with a fake `bin/audit` that echoes argv → exactly the 8 expected args, `shell:false`; an injected `--rpc` in any field is impossible (validation rejects it before spawn) | INTAKE §1, PRODUCT_WAVES §1.6 |
| W09-06 | Real-engine smoke: `ENGINE_RUNNER=real HOSTED_PRESET=scripted` on the bundled engine fixture repo (needs W03 `scripted` family in `main`; skipped with a clear message before that) | test | S | H | W09-05 | With Docker and W03 landed, `npm run test:intake -- real-engine-smoke` → one `completed` run whose out dir has `reviewers/index.json`; without W03 → test reports `skipped: needs W03 scripted family` | ORCHESTRATION §1 |
| W09-07 | Preset resolution (`src/worker/preset.ts`): `HOSTED_PRESET` name → engine `--preset` plus the env allow-list for that preset's families (e.g. `ZAI_API_KEY`, `OPENROUTER_API_KEY`), read from the process env loaded from `/etc/omniswarm/worker.env`; refuses any `cli:*` reviewer in a hosted preset (OD-04) | security | S | H | W09-01 | Unit test: preset `hosted` → env has only the 2 allow-listed keys + `PATH`/`HOME`; a preset containing `cli:claude:opus` → `PRESET_NOT_ALLOWED_HOSTED` | OD-04, ORCHESTRATION §1.1 |
| W09-08 | Progress tailer: poll `outDir/meta.json`, `workers.json`, `reviewers/*/usage.json`, `debate/round-*` every 5 s; map to `{phase, reviewer, pass, percent, message}` with a fixed phase weight table; write `request_progress` rows and heartbeat the pg-boss job | server | M | H | W09-04 | Run the mock runner → `request_progress` has ≥ 5 rows with monotonically increasing `percent`, ending at 100 | INTAKE §3 step 8 |
| W09-09 | `GET /api/requests/:id/events` SSE: replays existing progress rows then streams new ones (Postgres `LISTEN/NOTIFY` on `request_progress`), closes on a terminal status; 15 s keep-alive | server | S | H | W09-08 | `curl -N /api/requests/:id/events` during a mock run → events arrive live and the stream ends with `{status:"done"}` | INTAKE §4 |
| W09-10 | Publish (`src/publish/`): copy the run dir to `REPORTS_ROOT/<requestId>/` excluding `sessions/`, `harness/sandbox-run/`, `*.log`; files `0444`, dirs `0555`; write `published.json {requestId, repo, commitSha, preset, reportSha256, files[]}` | server | M | H | W09-04 | After a mock run → `REPORTS_ROOT/<id>/report.html` exists, no `sessions/` folder, `stat` shows read-only modes | INTAKE §3 step 9 |
| W09-11 | Canonical `reportSha256`: sha256 over canonical JSON (sorted keys, UTF-8, no whitespace) of `findings-and-scores.json` followed by `general-review.json` (empty object when absent); `scripts/report-hash.ts` CLI that anyone can run on a published folder | server | S | H | W09-10 | Demo step 3 → the CLI prints the stored hash; reformatting the JSON files (pretty-print) does not change it; changing one finding title does | INTAKE §3 step 9 |
| W09-12 | Attest: on job start `ChainPort.markRunning(hash)`; after publish read `deployed` code hash via `viewCodeHash` (if set), compute `max_severity` of `CONFIRMED`/`LIKELY` clusters, `ChainPort.attest(...)`; idempotent — before sending, `getRequest(hash)`; if already `Done` with the same `report_sha256`, just record it | chain | M | H | W09-11, W09-08 | Demo step 2 and step 6 (kill between attest and status write, restart) → exactly one `review_attested` event in the mock chain and status `done` | INTAKE §3 step 9, §6 |
| W09-13 | Failure classification: map runner results (W09-01) + `report-health.json` to `completed | infra_failed | engine_error`; `engine_error` gets one retry, then is treated as `infra_failed` | server | S | H | W09-04 | Fixtures: `sandbox_failed` → refund path; `INCOMPLETE` report with 1 failed reviewer → `completed` (published, attested, marked incomplete in the UI); a crash twice → refund path | OD-07 |
| W09-14 | Refund (OD-07): `infra_failed` → `ChainPort.refund(hash)` (idempotent: skip if already `Refunded`), status `refunded`, `refundTx`; never refunds `completed` | chain | S | H | W09-13 | Demo step 5 → `refunded` with a `mock:` refund tx; `MOCK_ENGINE_FAIL=findings` → `done`, no refund row | OD-07, INTAKE §3 step 10 |
| W09-15 | Concurrency: `WORKER_CONCURRENCY` (default 1, max 2) via `boss.work(…, {batchSize:1, localConcurrency})`; each job gets its own `outDir` under `RUNS_ROOT/<requestId>/<attempt>` | server | S | H | W09-02 | Demo step 7 with concurrency 1 → start times strictly sequential; with 2 → two overlapping runs, separate out dirs | INTAKE §3 step 8 |
| W09-16 | Crash recovery: on worker start, for requests stuck `running` with an expired pg-boss job, inspect the last out dir: finalized → resume from publish; not finalized → let the pg-boss retry run it again with a new attempt dir; never attest or refund twice | server | M | H | W09-12, W09-14, W09-15 | Demo step 6 (`kill -9` mid-run and between publish and attest) → each case ends `done` with one attestation | INTAKE §3 |
| W09-17 | Admin refund `POST /api/admin/requests/:id/refund` (token `ADMIN_TOKEN`, and the route is bound to `127.0.0.1` only; nginx never proxies `/api/admin`): allowed for `queued|running|failed`, `409 REFUND_NOT_ALLOWED` for `done|refunded`; writes `audit_log` | server | S | H | W09-14 | Demo step 9 → `409` for `done`; refund succeeds for a stuck `running` request; without the token → `401` | INTAKE §4 |
| W09-18 | Cost ledger: after each run sum `reviewers/*/usage.json` cost (OpenRouter `usage.cost`, estimated cost for others, 0 for `scripted`) into `request_cost`; `GET /api/ledger` public JSON (no accounts, only request ids, repo, price, cost, status) for the W11 ledger page (track 04) | server | M | H+ | W09-10 | Demo step 8 → ledger rows for the 3 requests, totals match the sum of rows; no account id appears | TRACKS 04, OD-01 |
| W09-19 | Disk hygiene: keep the last `KEEP_RUNS` (default 20) run dirs, delete older `RUNS_ROOT` attempts (never `REPORTS_ROOT`); after each run `docker ps -a --filter label=omniswarm.run=<id>` must be empty, else log `engine_leftover` | infra | S | H+ | W09-15 | Run 25 mock jobs → 20 run dirs remain, all 25 published reports remain | — |
| W09-20 | Wave check: `e2e/intake/w09.spec.ts` drives demo steps 1, 2, 3, 5, 6, 7, 9 with the mock runner and mock chain; `checks/w09-check.md`; tag `wave-09` | test | M | H | all above (H) | `npm run check:w09` → green; the guide lists the worker and API ports | — |

## Wave DoD

- `npm run check:w09` and `npm run check:w08` pass; `npm test` and the harness self-test still pass.
- With the mock chain, every terminal path (done, refunded, crash-recovered) produces **at most one** attestation or refund per `request_hash` (asserted in the e2e).
- The engine is spawned with `shell:false` and the asserted argv allow-list; no key appears in Postgres, logs or `published.json` (grep test).
- The published folder recomputes to the attested `reportSha256` with `scripts/report-hash.ts`.
- Tag `wave-09` on the merge commit.
