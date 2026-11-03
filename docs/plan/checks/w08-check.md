# W08 — Intake API: owner check

Wave file: [`../waves/W08-intake-api.md`](../waves/W08-intake-api.md) (old paths: `backend/intake` is now `apps/api`). About 5 minutes. No provider key, no Docker review sandbox, no GitHub API call and no NEAR RPC: the chain is the mock `ChainPort`, GitHub is the recorded adapter.

Postgres: any throwaway server you own. The checks create their own database on it (`t_w08_<random>`) and drop it afterwards; they never truncate an existing database.

```sh
docker run --rm -d --name intake-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55433:5432 postgres:16-alpine
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:55433/postgres
npm run check:w08          # unit + integration (npm test -w apps/api) + tests/e2e/intake/w08.spec.ts
npx tsc --noEmit -p apps/api
```

Without `DATABASE_URL` the database tests report `skipped: DATABASE_URL is not set` and the unit tests still run.

## By hand

```sh
cp apps/api/.env.example apps/api/.env      # fill SESSION_SECRET (>= 32 chars) and DATABASE_URL
npm run db:migrate -w @omniswarm/api         # numbered SQL + pg-boss schema + queues, under an advisory lock
                                             # (+ the mock chain's own tables, only for CHAIN_ADAPTER=mock outside production;
                                             #  in production it drops leftover empty mock_chain_* tables and refuses non-empty ones)
npm run dev -w @omniswarm/api                # HTTP on HOST:PORT; admin on 127.0.0.1:ADMIN_PORT when ADMIN_TOKEN is set
```

## Steps (what `w08.spec.ts` prints as `# step N`)

1. `GET /api/health` → `{ok:true, network:"testnet", queueDepth, workers, chain:{rpc, contract}}` (chain from `ChainPort.health`, cached 30 s). `GET /api/ready` → 200 when the database is reachable, migrations are current and the `review` queue exists. `GET /api/docs` is Swagger UI generated from the route schemas; `apps/api/openapi.json` is committed and checked (`npm run openapi -w @omniswarm/api -- --check`).
2. `POST /api/challenge` → `{nonce (44-char base64), expiresAt (+5 min)}`. The 31st call in a minute from one IP → `429 RATE_LIMITED`. The counter lives in Postgres, so two API replicas share it.
3. `POST /api/quote {"repoUrl":"https://github.com/near/near-sdk-rs","network":"testnet"}` → `normalizedRepo`, a 40-hex `commitSha`, `priceYocto` `1000000000000000000000000`, `preset: "scripted"` (the checks set `HOSTED_PRESET=scripted` for the mock engine; the default is `hosted`, and production must name it). `/tree/<ref>` and `@<ref>` resolve that ref. `private/hidden` → `REPO_PRIVATE`, `archived/old` → `REPO_ARCHIVED`, `huge/repo` → `REPO_TOO_LARGE`, an unknown ref → `REF_NOT_FOUND`, `network: "mainnet"` → `NETWORK_DISABLED`.
4. `node apps/api/scripts/sign-request.ts --account alice.mock --nonce <nonce>` registers a key on the mock chain and prints a body signed as a wallet does (base64 NEP-413 signature). `POST /api/requests` → `201 {requestId, requestHash, priceYocto, contractId}` and an httpOnly, SameSite=Lax `sid` cookie (Secure in production).
5. The same body → `409 NONCE_USED`. One changed character → `401 SIG_INVALID`. `--permission FunctionCall` → `401 KEY_NOT_FULL_ACCESS`. An expired challenge → `401 NONCE_EXPIRED`. A message that is not byte-for-byte the canonical message (extra key, other order, whitespace) → `400 MESSAGE_INVALID`; another preset → `PRESET_NOT_ALLOWED`; a commit that no longer resolves → `409 REF_CHANGED`.
6. `node apps/api/scripts/mock-pay.ts <requestId>` puts a `request_review` on the mock chain. `POST /api/requests/:id/payment {txHash}` with the cookie → `{status:"queued", position:1}` and a pg-boss `review` job sent in the same transaction. Confirming the same tx again is idempotent and answers with the current status and rank (`{status:"running", position:null}` once a worker took it). The same tx on another request → `409 TX_ALREADY_USED`; `--amount 1` → `402 PAYMENT_MISMATCH`; `--signer mallory.mock` → `403 PAYMENT_SIGNER_MISMATCH`.
7. `GET /api/requests/:id` → `status:"queued"`, `position`, redacted `timeline`. `GET /api/requests?mine=1` with the cookie lists it; without (or with a forged cookie) → `401`.
8. Pay with `mock-pay.ts` and skip step 6: `node apps/api/scripts/reconcile.ts` (workers also run it every minute) moves the request to `queued` with `audit_log` event `reconciled`.

Also covered by `npm test -w apps/api` (not printed as steps):

- `GET /api/reports/:id` (public) for a `done` request → `{requestId, reportUrl, reportSha256, reviewers, generalReviewUrl, attestation}`; the attestation is read from the registry. Not done → `404 NOT_FOUND`.
- Guard reports (INTAKE §4, `test/integration/guard-reports.test.ts`): `POST /api/guard/reports {account, evidenceUrl, reason}` needs the `sid` cookie (`401` without) → `202 {queued:true, reportId}`; a resubmission returns the same id. `reason` is 1–280 characters without control characters and `evidenceUrl` https with visible ASCII (the registry's `report_address` rules). On the admin listener: `GET /api/admin/guard/reports?status=pending`, `POST /api/admin/guard/reports/:id/approve` → `202 {status:"approved"}` plus a `guard-report` job; a worker sends `report_address {account_id, evidence_uri, reason}` once and the report becomes `reported`; `/reject` → `rejected`. `GET /api/guard/verdict` then answers `block` with `REPORTED` (registry `is_reported`). `GUARD_ACCOUNT_AGE=nearblocks` turns on the account-age signal (off by default, never in tests).

`audit_log` holds `challenge_issued`, `request_created`, `payment_verified`, `verify_failed` (code only) and every status change; no signature or key.

## Not in this check

Live GitHub (`OMNI_LIVE=1 npm test -w apps/api` runs the live adapter test), the NEAR adapter against testnet (its unit test uses recorded JSON-RPC), and the worker (W09).
