# W09 — Queue & Worker: owner check

Wave file: [`../waves/W09-queue-worker.md`](../waves/W09-queue-worker.md). About 5 minutes. Same throwaway Postgres as W08 (`export DATABASE_URL=…/postgres`); mock engine, mock chain, no Docker review and no provider key.

```sh
npm run check:w09          # npm test -w apps/api + tests/e2e/intake/w09.spec.ts (real API and worker processes)
```

The worker is `npm run worker -w @omniswarm/api`: a long-running process. Run as many as the host allows; each takes `WORKER_CONCURRENCY` jobs. The queue is pg-boss in the intake database (`pgboss` schema, installed by `npm run db:migrate`): queue `review`, policy `exclusive` with `singletonKey = requestHash`, `expireInSeconds 7200`, `heartbeatSeconds 30`, `retryLimit 1`, `retryDelay 60`, dead-letter queue `review-dead`.

## Steps (what `w09.spec.ts` prints)

1. A queued request and a worker with `ENGINE_RUNNER=mock`: `GET /api/requests/:id/events` (SSE) replays and streams `{status, progress:{phase, reviewer, pass, percent}, at}` from `request_progress` (`review` with `reviewer:"scripted-baseline"` … `report` 100) and ends with `{status:"done"}`. Events reach any API replica through Postgres `LISTEN/NOTIFY`.
2. `done`: `reportUrl` = `REPORTS_BASE_URL/<id>/report.html`, 64-hex `reportSha256`, `attestTx`; the mock chain has `review_requested`, `review_running`, `review_attested`.
3. `node apps/api/scripts/report-hash.ts <REPORTS_ROOT>/<id>` prints the same hash. The published folder is read-only (dirs 0555, files 0444), has `published.json`, and no `sessions/`, `harness/` or `*.log`.
5. `MOCK_ENGINE_FAIL=infra` (lost sandbox) → `failed` → `refunded`, `refundTx` set, one `review_refunded`. `MOCK_ENGINE_FAIL=findings` → `done` with `max_severity critical`, no refund. `crash` (no report) is retried once, then refunded; `operator` (no `./bin/audit`) is retried once, then left `failed` for an operator, never refunded automatically.
6. `kill -9` the worker mid-run, start another: pg-boss notices the missed heartbeat, the job runs again as attempt 2 in `RUNS_ROOT/<id>/1/`, and the request ends `done` with exactly one attestation. A kill after the attest landed and before the status write also ends with one attestation (`apps/api/test/integration/crash.test.ts`).
6b. SIGTERM a worker mid-run: its engine stops at once, the worker exits 0, and the job is handed back without spending its retry (the interrupted delivery is `completed` with output `{released:true}` and the same job is re-sent under the same `singletonKey` with the retries it still had, in one transaction). Another worker runs it as attempt 2 and attests once. A crashing engine after such a release is still retried once (`crash.test.ts`). A review still running when `WORKER_STOP_TIMEOUT_S` ends is failed by pg-boss and does spend the retry.
7. Three queued requests show `position` 1, 2, 3; with `WORKER_CONCURRENCY=1` the first runs and the others show 1, 2.
8. `GET /api/ledger` (public) → `{entries:[{requestId, repo, status, priceYocto, paidYocto, modelCostUsd, reviewers, refundTx?}], totals:{requests, salesYocto, refundedYocto, modelCostUsd}}` for every paid request, newest first, no account. The model cost is summed from every attempt's `reviewers/*/usage.json` (`totals.cost`, else `passes[].cost`) into `request_cost` when the request is published or refunded; the mock engine's `scripted` reviewer costs 0.
9. Admin listener (127.0.0.1:`ADMIN_PORT`, only when `ADMIN_TOKEN` is set): `POST /api/admin/requests/:id/refund` without the token → `401`; on a `running` request → `202 {status:"refund_queued"}`: the API records it and enqueues a `refund` job, because only workers hold the operator key (`OPERATOR_KEY_FILE`, INTAKE §5). A worker sends the refund, the request becomes `refunded` and its running engine is aborted; asking again → `200 {status:"refunded", refundTx}`. On a `done` request → `409 REFUND_NOT_ALLOWED`. The public port has no admin route.

SIGTERM to a worker forwards SIGTERM to its engines at once (SIGKILL after `ENGINE_KILL_GRACE_S`), exits 0 well within systemd's 180 s, and another worker runs the released job (step 6b).

Disk hygiene (W09-19, the maintenance cron every minute; `test/unit/hygiene.test.ts` and `test/integration/hygiene.test.ts`: 25 mock jobs → 20 run dirs, 25 published reports). `RUNS_ROOT`: a `done` request keeps only the attempt it published; of the finished requests (`done`, `refunded`, `expired`) the newest `KEEP_RUNS` (default 20) keep their dirs. In-flight, `failed` and database-unknown dirs are never touched. `REPORTS_ROOT`: a `done` request's report is never removed; a report orphaned by a refund or expiry goes after `ORPHAN_REPORT_RETENTION_H` (default 168), stale `.staging/` entries after an hour.

`HOSTED_PRESET` defaults to `hosted` and must be set in production. With `ENGINE_RUNNER=cli` the worker exits at startup with one line when the preset is not in `omniswarm.config.json` or uses a family the hosted service does not run (`cli:*`, `scripted`).

DoD grep: a provider key planted in the worker env appears in no Postgres table, process log or published file. The engine is spawned as `./bin/audit run --github <repo> --ref <sha> --preset <preset> --out <dir>` from the repository root with an env built from `PATH`/`HOME`/… plus the preset's provider keys only (`apps/api/test/unit/engine-cli.test.ts`).

## Not in this check

Step 4 (the real engine on Docker with `ENGINE_RUNNER=cli`), and the W09-19 Docker-leftover check (`docker ps -a --filter label=omniswarm.run=<id>` after each run): it needs the real engine and Docker.
