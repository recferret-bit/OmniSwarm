# W08 — Intake API

> **Track:** Intake (B) · **Tag:** `wave-08` · **Check:** `npm run check:w08` (unit + Postgres integration + `e2e/intake/w08.spec.ts`)
> **Depends on waves:** W00 (layout, `shared/schemas/intake-api.schema.json`, `job.schema.json`, root scripts `test:intake`, per-worktree `.env.worktree`, CI).
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §1–§5 · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-06, OD-08, OD-09, OD-12
> **Owned paths:** `backend/intake/package.json`, `backend/intake/tsconfig.json`, `backend/intake/src/{api,auth,quote,requests,github,chain/ports,chain/mock,db,config}/**`, `backend/intake/migrations/**`, `backend/intake/test/**`, `backend/intake/.env.example`, `e2e/intake/w08.spec.ts`, `docs/plan/checks/w08-check.md`. Uses without owning: `shared/schemas/**` (lead; change requests below), `backend/intake/src/chain/adapters/near/**` (W10), `backend/intake/src/{queue,worker,publish}/**` (W09).
> **Change requests to the lead (W00 pre-step or a mid-wave pre-step):** CR-08a `shared/schemas/canonical-message.mjs` — the canonical request-message builder and `requestHash()` used by both the API (W08) and the landing (W11), with its test vectors; CR-08b error-code enum in `intake-api.schema.json` (§4 list); CR-08c `npm run check:w08` in root `package.json`.

## Goal

A user who holds a NEAR testnet key can go **challenge → quote → signed request → payment confirmation** against a real HTTP API. The signature check is real (NEP-413 through `near-api-js` `verifyMessage`, including the FullAccess-key check), the GitHub check is real-shaped (recorded fixtures in CI, the live API with `OMNI_LIVE=1`), and the chain is a **mock `ChainPort`** with a contract suite that W10 re-runs against testnet. The queue hand-off is a stub that W09 replaces.

## Demo story (the check in words)

1. `npm run dev -w backend/intake` → `GET /api/health` returns `{ok:true, network:"testnet", chain:{rpc:"mock", contract:"review-registry.mock"}}`; `GET /api/docs` shows the OpenAPI UI generated from the zod/JSON schemas.
2. `POST /api/challenge` → `{nonce, expiresAt}`; a 31st call in one minute from the same IP → `429 RATE_LIMITED`.
3. `POST /api/quote {repoUrl:"https://github.com/near/near-sdk-rs"}` → `{normalizedRepo:"near/near-sdk-rs", commitSha:<40 hex>, priceYocto:"1000000000000000000000000", contractId, queueDepth:0, preset:"scripted", etaMinutes}`; a private or archived fixture repo → `REPO_PRIVATE` / `REPO_ARCHIVED`; a too-large one → `REPO_TOO_LARGE`.
4. `node backend/intake/scripts/sign-request.ts --account alice.mock` (dev script: generates or loads a dev keypair registered as FullAccess in the mock chain, builds the canonical message, signs the NEP-413 payload) → prints a JSON body; `POST /api/requests` with it → `{requestId, requestHash, …}` and a `sid` cookie.
5. Replay the same body → `409 NONCE_USED`; tamper one char of `message` → `401 SIG_INVALID`; sign with a key the mock chain lists as FunctionCall → `401 KEY_NOT_FULL_ACCESS`; wait past expiry (dev `ClockPort` advance) → `401 NONCE_EXPIRED`.
6. `node backend/intake/scripts/mock-pay.ts <requestHash>` writes a `Pending` request into the mock chain and returns a mock tx hash; `POST /api/requests/:id/payment {txHash}` with the `sid` cookie → `{status:"queued", position:1}`; the same `txHash` on another request → `409 TX_ALREADY_USED`; an underpaid mock tx → `402 PAYMENT_MISMATCH`.
7. `GET /api/requests/:id` → `status: "queued"`; `GET /api/requests?mine=1` with the cookie lists it; without the cookie → `401`.
8. Kill the client before step 6's confirm, run `npm run reconcile -w backend/intake` → the reconciler finds the mock `review_requested` record and moves the request to `queued`.

## Hackathon slice

- **The hackathon check covers demo steps:** 1–8 (all). `e2e/intake/w08.spec.ts` tags them `@hack`.
- **Deferred:** live GitHub calls in CI (recorded fixtures only), deny-list admin UI, structured log shipping.
- **Still true:** nothing in `scripts/` is touched; the API never spawns the engine (W09 does).

## Features covered

- [x] Package skeleton, config loader (zod env schema), Fastify app factory, error shape — W08-01, W08-02
- [x] Postgres migrations and DB layer: `nonce`, `request`, `payment`, `request_progress`, `audit_log` — W08-03, W08-04
- [x] Ports + mocks + contract suites: `ChainPort`, `GitHubPort` (recorded fixtures), `ClockPort` — W08-05..08
- [x] Canonical message builder + `requestHash` shared with the landing (CR-08a) — W08-09
- [x] NEP-413 verification with generated test vectors — W08-10, W08-11
- [x] `POST /api/challenge` — W08-12
- [x] `POST /api/quote` with repo normalization, GitHub checks, queue-depth and account limits — W08-13, W08-14
- [x] `POST /api/requests` + `sid` session cookie — W08-15, W08-16
- [x] `POST /api/requests/:id/payment` with tx and `get_request` checks, enqueue stub — W08-17
- [x] `GET /api/requests/:id`, `GET /api/requests?mine=1`, `GET /api/health` — W08-18
- [x] Rate limits and input guards — W08-19
- [x] OpenAPI at `/api/docs` — W08-20
- [x] Payment reconciler — W08-21
- [x] Per-worktree database and dev scripts (`sign-request`, `mock-pay`) — W08-22
- [x] Audit log of state changes — W08-23
- [x] Wave check, owner guide, tag — W08-24

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W08-01 | Contract: wire `shared/schemas/intake-api.schema.json` (W00) into zod via a small `schema.ts` adapter (DTOs for all §4 endpoints, error-code enum CR-08b, status enum); file CR-08a/08c with the lead | contract | S | H | — | `npm run test:intake -- schema` → every §4 request/response fixture in `test/fixtures/dto/` validates, and an unknown error code fails | INTAKE §4 |
| W08-02 | Package skeleton: `backend/intake/package.json` (Fastify 5, zod, pg, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/swagger(-ui)`, `near-api-js@7.4.0`), Node 24 type-stripping start script, `src/app.ts` factory, `src/config/env.ts` zod env schema, `.env.example`, one error handler mapping `AppError(code)` → `{error:{code,message,retryable}}` and HTTP status | server | M | H | W08-01 | `npm run dev -w backend/intake` with `.env.example` → `GET /api/health` returns 200; a missing `DATABASE_URL` exits with a one-line zod error naming the key | INTAKE §2, OD-12 |
| W08-03 | Migrations (`node-pg-migrate` or plain SQL runner): `nonce(nonce PK, created_at, expires_at, used_at, ip)`, `request(id uuid PK, account, repo, commit_sha, network, preset, deployed, request_hash UNIQUE, price_yocto, status, created_at, updated_at)`, `payment(tx_hash UNIQUE, request_id FK, amount_yocto, signer, verified_at)`, `request_progress(request_id, ts, phase, reviewer, pass, percent, message)`, `audit_log(id, ts, actor, request_id, event, data jsonb)` | server | M | H | W08-02 | `npm run db:migrate -w backend/intake` on an empty DB → all 5 tables exist; running it twice is a no-op; a duplicate `request_hash` insert fails with a unique violation | INTAKE §3 |
| W08-04 | DB repositories (`src/db/`): nonce (issue, consume-once with `UPDATE … WHERE used_at IS NULL RETURNING`), request (create, transition with allowed-transition table), payment, progress; integration tests on the per-worktree DB | server | M | H | W08-03 | Integration test: two concurrent `consume(nonce)` → exactly one succeeds; transition `awaiting_payment → done` throws `INVALID_TRANSITION` | INTAKE §3 steps 2, 5, 7 |
| W08-05 | `ChainPort` interface (`src/chain/ports/chain.ts`): `verifyMessage`, `getTx`, `getRequest`, `attest`, `refund`, `markRunning`, `viewAccount`, `viewCodeHash`, `getAttestationForAccount`, `isReported`, `health`; result and error types (`PAYMENT_NOT_FOUND`, `CHAIN_UNAVAILABLE`) | contract | S | H | W08-01 | `npm run typecheck -w backend/intake` → the mock (W08-06) and a compile-only stub of the W10 adapter both satisfy the interface | INTAKE §5 Ports |
| W08-06 | `MockChainAdapter` on Postgres (`mock_chain_*` tables): accounts with keys (FullAccess/FunctionCall), requests by hash, txs with deterministic `mock:<sha256>` hashes, events list, latency and failure injection (`MOCK_CHAIN_FAIL_RATE`) | server | M | H | W08-05, W08-03 | Unit test: `getRequest` after a mock `request_review` returns `{account, deposit, status:"Pending"}`; with fail rate 1.0 every call throws `CHAIN_UNAVAILABLE` | INTAKE §5 |
| W08-07 | `ChainPort` contract suite (`test/contract/chain.contract.ts`): one table of behaviours both adapters must pass (pay → getTx FINAL success; wrong signer; underpaid; unknown hash; attest then getAttestationForAccount; refund twice rejected); runs against the mock in CI, against testnet in W10 with `OMNI_LIVE=1` | test | M | H | W08-06 | `npm run test:contract:chain -w backend/intake` → all cases pass on the mock; the runner prints `adapter=mock` | INTAKE §5 |
| W08-08 | `GitHubPort` + recorded-fixture adapter + live adapter (token from env, `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/commits/{ref}`), and `ClockPort` (system + controllable test clock) | server | M | H | W08-05 | `npm run test:intake -- github` → fixtures for public, private (404 without token), archived, too-large and unknown-ref repos map to `ok`, `REPO_PRIVATE`, `REPO_ARCHIVED`, `REPO_TOO_LARGE`, `REF_NOT_FOUND`; with `OMNI_LIVE=1` the same suite passes on 2 real public repos | INTAKE §3 step 3, §5 |
| W08-09 | Canonical message (CR-08a, implemented in `shared/schemas/canonical-message.mjs` by the lead from this issue's spec and vectors): sorted-key, no-whitespace JSON of `{account, commit, deployed, network, nonce, preset, repo, v:1}`, `requestHash = sha256 hex`; reject extra keys | contract | S | H | W08-01 | Run the shared vectors from both `backend/intake` and a plain Node script → identical message strings and hashes; a message with an extra key is rejected | INTAKE §3 step 4 |
| W08-10 | NEP-413 test-vector generator (`test/nep413/vectors.ts`): generate ed25519 keypairs, borsh-serialize `Payload{message, nonce[32], recipient, callbackUrl: None}`, prefix u32 tag **2147484061**, sha256, sign; vectors for valid, tampered message, wrong recipient, wrong nonce, wrong key | test | S | H | W08-09 | `npm run test:intake -- nep413-vectors` → 5 vectors written to `test/fixtures/nep413.json`; re-running reproduces them from fixed seeds | NEP-413 |
| W08-11 | `src/auth/verify.ts`: parse and validate the message, check `account == accountId`, `recipient == INTAKE_RECIPIENT`, nonce match, then `ChainPort.verifyMessage` (real adapter calls `near-api-js/nep413` `verifyMessage`; the mock checks the signature locally with the same borsh payload and its key table) | server | M | H | W08-10, W08-06 | Unit test over W08-10 vectors → valid passes; tampered → `SIG_INVALID`; wrong recipient → `SIG_INVALID`; FunctionCall key → `KEY_NOT_FULL_ACCESS` | INTAKE §3 step 5 |
| W08-12 | `POST /api/challenge`: 32 random bytes base64, `expiresAt = now + 5 min` from `ClockPort`, stored with IP | server | S | H | W08-04 | `POST /api/challenge` twice → two different 44-char base64 nonces; both rows exist with `expires_at` 5 min ahead | INTAKE §3 step 2 |
| W08-13 | Quote service: normalize `repoUrl` (https, `github.com/<o>/<r>(.git)?`, optional `@ref`/`/tree/<ref>`), regex guard, allow-list mode (`REPO_ALLOWLIST`), deny-list, GitHub checks, resolve ref → commit SHA | server | M | H | W08-08 | `POST /api/quote` with `https://github.com/near/near-sdk-rs/tree/master` → `normalizedRepo:"near/near-sdk-rs"` and a 40-hex `commitSha`; `git@github.com:x/y` → `400 REPO_URL_INVALID` | INTAKE §3 step 3, §5 Repo rules |
| W08-14 | Quote limits: queue depth from the request table (`queued+running`) vs `MAX_QUEUE` → `503 QUEUE_FULL` before any payment; per-account active and daily limits when `accountId` is given; price from `PRICE_YOCTO_<NETWORK>` (testnet 1 NEAR, mainnet disabled → `NETWORK_DISABLED`, OD-08); `preset` from `HOSTED_PRESET` (default `scripted` until W03) and `etaMinutes` | server | S | H | W08-13, W08-04 | With `MAX_QUEUE=1` and one queued request → `POST /api/quote` returns `503 QUEUE_FULL`; with `NETWORK=mainnet` → `NETWORK_DISABLED` | INTAKE §5, OD-04, OD-08 |
| W08-15 | `POST /api/requests`: verify (W08-11), consume nonce, re-run quote checks for the signed repo/commit, insert `awaiting_payment` with `request_hash` and `price_yocto`, write `audit_log` | server | M | H | W08-11, W08-12, W08-14 | Body from `scripts/sign-request.ts` → `201 {requestId, requestHash}`; the same body again → `409 NONCE_USED`; a signed commit that no longer resolves → `409 REF_CHANGED` | INTAKE §3 step 5 |
| W08-16 | Session: httpOnly, `Secure` (except localhost), `SameSite=Lax` `sid` cookie (HMAC-signed, `SESSION_SECRET`), 24 h, bound to `accountId`; `requireSession` hook | server | S | H | W08-15 | After W08-15 the response sets `sid`; `GET /api/requests?mine=1` with it → the request; with a cookie for another account → empty list; with a forged cookie → `401` | INTAKE §4 |
| W08-17 | `POST /api/requests/:id/payment`: `getTx(txHash)` FINAL + success + `signer == account` + `receiver == contractId`; `getRequest(requestHash)` deposit ≥ price, `Pending`; `payment.tx_hash` unique; in one DB transaction set `queued` and call `enqueueReview(tx, requestId, requestHash)` (interface owned by W09; here a stub that inserts a row in `job_stub`) | server | M | H | W08-15, W08-16, W08-07 | Demo step 6 → `{status:"queued", position:1}`; reused `txHash` → `409 TX_ALREADY_USED`; underpaid → `402 PAYMENT_MISMATCH`; tx by another signer → `403 PAYMENT_SIGNER_MISMATCH` | INTAKE §3 step 7 |
| W08-18 | Read endpoints: `GET /api/requests/:id` (public, UUIDv4), `GET /api/requests?mine=1` (session), `GET /api/health` (`{ok, network, queueDepth, workers:0, chain}` from `ChainPort.health`) | server | S | H | W08-17 | `GET /api/requests/<random uuid>` → `404 REQUEST_NOT_FOUND`; the real id → `status:"queued"`; health shows `queueDepth:1` | INTAKE §4 |
| W08-19 | Guards: `@fastify/rate-limit` (challenge/quote 30/min/IP; requests 5/day/account and 1 active), body limit 16 KB, `trustProxy` only for the nginx hop, CORS limited to `LANDING_ORIGIN`, security headers | security | S | H | W08-18 | `autocannon` 40 req to `/api/challenge` in a minute → the last 10 get `429 RATE_LIMITED`; a 20 KB body → `413`; a request from another origin gets no CORS headers | INTAKE §5 |
| W08-20 | OpenAPI: `@fastify/swagger` from the zod schemas, served at `/api/docs`; `npm run openapi -w backend/intake` writes `backend/intake/openapi.json` (W11 generates its client and MSW mocks from it) | docs | S | H | W08-18 | Open `/api/docs` → all §4 W08 endpoints listed with schemas; `openapi.json` validates with `@apidevtools/swagger-parser` | INTAKE §4 |
| W08-21 | Reconciler (`npm run reconcile`, also an in-process interval every 60 s): for `awaiting_payment` requests younger than 24 h, `ChainPort.getRequest(hash)`; if `Pending` with enough deposit, mark paid (tx hash from the event or `reconciled:<hash>`) and enqueue; older than 24 h → `expired` | server | M | H+ | W08-17 | Demo step 8 → the request moves to `queued` and `audit_log` shows `event:"reconciled"` | INTAKE §3 step 7 |
| W08-22 | Per-worktree DB and dev scripts: `.env.worktree` → `DATABASE_URL=…/omniswarm_<branch>`, `npm run db:reset -w backend/intake`; `scripts/sign-request.ts` and `scripts/mock-pay.ts` for the demo | test | S | H | W08-06, W08-09 | In two worktrees, `npm run db:reset` creates two separate databases; `sign-request.ts --account alice.mock` prints a body that W08-15 accepts | PRODUCT_WAVES §7 isolation |
| W08-23 | Audit log: every state transition, verification failure (code only, no signature bytes) and admin action writes `audit_log`; `GET /api/requests/:id` exposes a public, redacted timeline | server | S | H+ | W08-17 | After demo steps 4–6 → `audit_log` has `challenge_issued`, `request_created`, `payment_verified` rows, none containing a signature or key | INTAKE §5 Logs |
| W08-24 | Wave check: `e2e/intake/w08.spec.ts` drives demo steps 1–8 against a fresh DB with the mock chain and recorded GitHub; `checks/w08-check.md`; tag `wave-08` | test | M | H | all above (H) | `npm run check:w08` → green, prints the 8 demo steps with the worktree's port | — |

## Wave DoD

- `npm run check:w08` passes on a fresh per-worktree DB; `npm test` and `node scripts/harness.mjs --self-test` still pass (nothing in the engine changed).
- The `ChainPort` contract suite passes against the mock; W10 re-runs the same file against testnet.
- NEP-413 vectors are generated, committed and verified; no real key material is committed (generated from fixed test seeds, marked as test-only).
- `openapi.json` committed and in sync (`npm run openapi -- --check`).
- Tag `wave-08` on the merge commit.
