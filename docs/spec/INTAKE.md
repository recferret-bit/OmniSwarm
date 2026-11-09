# INTAKE — NEAR login, paid review requests, queue, attestation, guard

> **Status:** v1, 2026-11-02. Source of truth for W08–W13. Sources fetched 2026-11-02: [wallet login tutorial](https://docs.near.org/web3-apps/tutorials/wallet-login), [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md), [backend auth](https://docs.near.org/web3-apps/backend/), [RPC transactions](https://docs.near.org/api/rpc/transactions), [RPC providers](https://docs.near.org/api/rpc/providers), [RPC deprecation](https://near.org/blog/deprecation-of-near-org-and-pagoda-co-rpc-endpoints), [NEP-297](https://github.com/near/NEPs/blob/master/neps/nep-0297.md), [access keys](https://docs.near.org/protocol/access-keys), [pg-boss jobs](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md), [GitHub repos API](https://docs.github.com/en/rest/repos/repos#get-a-repository).

## 1. Boundary

The intake service is a **separate layer**. It may call NEAR RPC, GitHub and the registry contract. It starts reviews only by spawning `./bin/audit run --github <owner>/<repo> --ref <sha> --preset <hosted> --out <dir>` with an argv array. It never passes `--rpc` (rejected anyway), never edits `engine/scripts/`, and never mounts keys into the sandbox. The engine never learns that a review was paid.

## 2. Stack

| Part | Choice | Version (npm, 2026-11-02) | Why |
|---|---|---|---|
| Wallet | `@hot-labs/near-connect` (+ `near-connect-hooks`) | 0.12.0 / 1.1.6 | docs.near.org recommends it; supports `signMessage` and `signInAndSignMessage` in one step; Wallet Selector is legacy |
| NEAR JS | `near-api-js` | 7.4.0 | `verifyMessage` from `near-api-js/nep413` checks signature **and** that the key is FullAccess via `view_access_key` |
| API | Fastify 5 + zod + `@fastify/rate-limit` + `@fastify/swagger` | pin in W08 | small, schema-first |
| DB / queue | Postgres 16 + `pg-boss` | 12.38.0 | one DB for nonces, requests, payments and jobs, so "payment verified" and "job enqueued" are one transaction |
| RPC | FastNEAR (`free.rpc.fastnear.com` / testnet equivalent) with Lava as fallback, URLs from env per network | — | `rpc.*.near.org` is limited to 30 req/min since 2025-08-01 |
| Contract | Rust `near-sdk` 5.x, `cargo near build non-reproducible-wasm` on the developer host, near-workspaces tests | pin in W10 | owner-only refund/attest, view `get_request` |

## 3. Request flow

1. **Connect.** `NearConnector({network})` → `wallet:signIn`. Network comes from the deployment (`NETWORK=testnet|mainnet`).
2. **Challenge.** `POST /api/challenge` → `{nonce (base64, 32 random bytes), expiresAt (+5 min)}`; row in `nonce(nonce PK, created_at, expires_at, used_at)`.
3. **Quote.** `POST /api/quote {repoUrl, network}` → server normalizes `owner/repo`, checks GitHub (`private == false`, not archived/disabled, `size` ≤ `MAX_REPO_KB`, default branch or requested ref resolved to a **commit SHA**), allow/deny lists, queue depth (< `MAX_QUEUE`, else 503 **before payment**), per-account limits. Returns `{normalizedRepo, commitSha, priceYocto, contractId, queueDepth, preset, etaMinutes}`.
4. **Sign.** Client builds the canonical message (sorted-key JSON, no whitespace):
   `{"account":…,"commit":…,"deployed":…|null,"network":…,"nonce":…,"preset":…,"repo":…,"v":1}`, where `deployed` is an optional NEAR account the requester says runs this code (the guard uses it, §7) and calls `wallet.signMessage({message, recipient: INTAKE_RECIPIENT, nonce})`. `requestHash = sha256(message)` (hex).
5. **Create.** `POST /api/requests {accountId, publicKey, signature, message, nonce}` → server: parse message, check `account == accountId`, nonce known/unexpired/unused, `verifyMessage` (signature + FullAccess key), re-run step-3 checks, insert `request(status=awaiting_payment, request_hash UNIQUE)`, mark nonce used, set an httpOnly session cookie (`sid`, 24 h) bound to `accountId`. Returns `{requestId, requestHash, priceYocto, contractId}`.
6. **Pay.** Client: `wallet.signAndSendTransaction({receiverId: contractId, actions: [FunctionCall("request_review", {request_hash}, 30 TGas, deposit=priceYocto)]})`.
7. **Confirm.** `POST /api/requests/:id/payment {txHash}` → server: RPC `tx` (`wait_until: FINAL`), require success, `signer == accountId`, receiver `contractId`; view `get_request(request_hash)` → `{account, deposit ≥ price, status: "pending"}`; `payment.tx_hash UNIQUE`. In one DB transaction: `status=queued` and `boss.send("review", {requestId}, {singletonKey: requestHash, expireInSeconds: 7200, heartbeatSeconds: 30, retryLimit: 1})`. A background reconciler re-checks unpaid requests whose client never called step 7 by reading `review_requested` events / `get_request`.
8. **Run.** Worker (concurrency `WORKER_CONCURRENCY`, default 1): clone at `commitSha` via `--github … --ref <sha>`, spawn the engine, tail `meta.json`/`workers.json` into `request_progress` (phase, reviewer, pass, percent), heartbeat pg-boss.
9. **Publish.** Copy the report folder to `REPORTS_ROOT/<requestId>/`, served read-only by nginx from a **separate origin** `reports.<domain>` (reports quote untrusted target text and run their own script; the app embeds them in `<iframe sandbox="allow-scripts">` and reads the index with a CORS GET allowed only from the app origin), compute `reportSha256 = sha256(findings-and-scores.json ‖ general-review.json)` (canonical), read `code_hash` of `deployed` (if any) via `view_account`, call `attest(request_hash, repo, commit, report_sha256, report_uri, deployed, code_hash, max_severity_confirmed)` with the backend's **function-call key** (scoped to `attest`, `refund`, `mark_running`). Status `done`.
10. **Refund.** Infra failure (sandbox, provider outage, timeout) or rejection after payment → `refund(request_hash)`; status `refunded`. A completed review is never refunded (OD-07).

## 4. API surface (`packages/schemas/intake-api.schema.json`)

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/api/challenge` | none, rate-limited per IP | `{}` → `{nonce, expiresAt}` |
| POST | `/api/quote` | none, rate-limited per IP | `{repoUrl, network}` → `{normalizedRepo, commitSha, priceYocto, contractId, queueDepth, preset, etaMinutes}` |
| POST | `/api/requests` | NEP-413 signature | `{accountId, publicKey, signature, message, nonce}` → `{requestId, requestHash, priceYocto, contractId}` + `sid` cookie |
| POST | `/api/requests/:id/payment` | `sid` | `{txHash}` → `{status, position\|null}`; a replay of the same tx is idempotent and returns the current status and, while queued, the 1-based queue rank (else `null`) |
| GET | `/api/requests/:id` | public (id is unguessable UUIDv4) | → `{status, progress, reportUrl?, reportSha256?, attestTx?, refundTx?, createdAt}` |
| GET | `/api/requests/:id/events` | public | SSE stream of progress events |
| GET | `/api/requests?mine=1` | `sid` | → list of the account's requests |
| GET | `/api/reports/:id` | public | → `{requestId, reportUrl, reportSha256, reviewers?, generalReviewUrl?, attestation?, receipt?}` once `done`. `receipt` is `{paid:{yocto,tx}, reviewers:[{id,vendor,model,calls,tokens,usd}], check:{passed,total,byStatus}, attestation?:{tx,hash,match?}, refund?}`. A `refunded` request returns `{requestId, receipt}` with `refund` and no `attestation`. Other statuses are 404 `NOT_FOUND` |
| GET | `/api/guard/verdict?account=&network=` | `x-guard-key` header (higher limit) or rate-limited public; verdicts cached 60 s per account | → `{verdict: allow|warn|block, reasons[], signals{}, attestation?}` (W13) |
| POST | `/api/guard/reports` | `sid` | `{account, evidenceUrl (https, visible ASCII, ≤ 2000), reason (1–280 chars, not blank, no control chars)}` → 202 `{queued: true, reportId}`; waits for owner review, then a worker sends `report_address` (W13). A resubmission of the reporter's pending report on the same account returns the same `reportId` |
| GET | `/api/ledger` | public (`H+`, track 04) | → `{entries: [{requestId, repo, status, priceYocto, paidYocto, modelCostUsd, reviewers, refundTx?}] (newest first, ≤ 500), totals: {requests, salesYocto, refundedYocto, modelCostUsd}}`; cost from every attempt's `reviewers/*/usage.json`, recorded when the request is published or refunded; totals cover every paid request; no account ids |
| GET | `/api/health` | none | → `{ok, network, queueDepth, workers, chain: {rpc, contract}}` |
| GET | `/api/docs` | none | OpenAPI UI |
| POST | `/api/admin/requests/:id/refund` | admin | → 202 `{status: "refund_queued"}` (the API records the refund, a worker signs and sends it) or 200 `{status: "refunded", refundTx\|null}` if already refunded |
| GET | `/api/admin/guard/reports[?status=]` | admin | → `{reports: [{reportId, account, reporter, evidenceUrl, reason, status, reportTx, createdAt}]}`; status `pending\|approved\|reported\|rejected` |
| POST | `/api/admin/guard/reports/:id/approve` | admin | → 202 `{status: "approved", reportTx: null}`; a worker sends `report_address` (skipped if `is_reported`), then `reported` with `reportTx` (`null` when the chain already listed the account) |
| POST | `/api/admin/guard/reports/:id/reject` | admin | → 200 `{status: "rejected", reportTx: null}`. Repeating a decision returns the current state; deciding a non-pending report is 409 `INVALID_TRANSITION` |

Admin routes exist only on the separate admin listener (`ADMIN_HOST:ADMIN_PORT`, loopback only, default `127.0.0.1:8788`); the public app has no `/api/admin` route. Auth is the `x-admin-token` header (`ADMIN_TOKEN` from env), compared in constant time. The API never signs: refunds and approved reports are queued for the worker, the only operator-key holder.

Statuses: `awaiting_payment → queued → running → publishing → done | failed → refunded`. Errors use one shape: `{error: {code, message, retryable}}`; codes listed in the schema (`REPO_PRIVATE`, `REPO_TOO_LARGE`, `QUEUE_FULL`, `NONCE_EXPIRED`, `NONCE_USED`, `SIG_INVALID`, `KEY_NOT_FULL_ACCESS`, `PAYMENT_NOT_FOUND`, `PAYMENT_MISMATCH`, `TX_ALREADY_USED`, `RATE_LIMITED`, …).

## 5. Guards

- Rate limits: `/challenge` and `/quote` 30/min/IP; `/requests` 5/day and 1 active per account; global `MAX_QUEUE` (default 10).
- Repo rules: public only, `size ≤ MAX_REPO_KB` (default 200 MB), optional allow-list mode for the hackathon demo, deny-list.
- Inputs: repo regex `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`; commit SHA `^[0-9a-f]{40}$`; everything else zod-validated; body limit 16 KB.
- Ports: `ChainPort` (`health`, `keyPermission`, `getPaymentTx`, `getRequest`, `getAttestation`, `getPrice`, `viewAccount`, `getAttestationForAccount`, `blockTimestampMs`, `isReported`, `viewRegistry`; operator writes `markRunning`, `attest`, `refund`, `reportAddress`, signed by the worker only), `GitHubPort`, `ClockPort` (apps/api/src/chain/port.ts). Mocks for each with contract suites that W10 re-runs against testnet.
- Secrets: provider keys, the backend FC key and the GitHub token live in `/etc/omniswarm/*.env` (root 0600) on the host; never in Postgres, never in the repo, never in the sandbox.
- Logs: request id, account, repo, status; never message signatures beyond the hash, never keys.

## 6. Contract `review-registry` (W10)

| Method | Kind | Who | Effect |
|---|---|---|---|
| `new(owner, operator_pk, price_yocto)` | init | deployer | sets owner; operator is a FC key added by the owner |
| `request_review(request_hash)` | payable call | anyone | asserts `deposit ≥ price`, hash unused (64 hex); stores `{account: predecessor, deposit, block_height, status: Pending}`; emits `review_requested` |
| `mark_running(request_hash)` | call | operator | `Pending → Running` |
| `attest(request_hash, repo, commit, report_sha256, report_uri, deployed, code_hash, max_severity)` | call | operator | `→ Done`; stores the attestation with `repo` (`owner/name`) and `commit` as explicit arguments, plus `repo → attestations` and `deployed → latest attestation` indexes; emits `review_attested` |
| `reviewer_attest(request_hash, reviewer_id, subreport_sha256)` | call | reviewer sub-account (`H+`, OD-02) | records one model's sub-report hash, signed by that reviewer's own sub-account; emits `subreport_attested` |
| `refund(request_hash)` | call | operator or owner | `Pending|Running → Refunded`; transfers `deposit` back; emits `review_refunded` |
| `withdraw(amount)` | call | owner | moves earned deposits of `Done` requests to the treasury |
| `set_price`, `set_operator` | call | owner | admin |
| `report_address(account_id, evidence_uri, reason)` | call, no deposit | operator only | guard blocklist entry (W13): `evidence_uri` `https://` + visible ASCII ≤ 2000 bytes, `reason` 1–280 chars, not blank, no control chars; one report per account (`ERR_ALREADY_REPORTED`); emits `address_reported` |
| `retract_report(account_id)` | call | owner | removes the report; emits `report_retracted` |
| `get_request`, `get_attestation`, `get_attestations_for_repo`, `get_attestation_for_account`, `get_price` | view | anyone | reads |
| `is_reported(account_id)`, `get_report(account_id)` | view | anyone | `bool`; the stored report (`account_id`, `evidence_uri`, `reason`, `reporter`, `reported_at_ms`) or `null` |

Events: NEP-297 `EVENT_JSON:{"standard":"omniswarm","version":"1.0.0","event":…,"data":[…]}`. The **operator function-call key** is limited to exactly `mark_running`, `attest`, `refund`, `report_address` (and `reviewer_attest` keys live on each reviewer sub-account under OD-02). Storage is paid from the deposit; price ≥ storage cost is asserted. The backend's key is a **function-call key** limited to `review-registry.<owner>.<net>` and the operator methods, with a gas allowance; it cannot transfer NEAR or add keys (README explains the limits, track 06 requirement). OmniSwarm audits this contract with itself in W14 (dogfood run).

## 7. Guard (W13, track `security`)

`verdict(account)`:
- **block** if the account is on the registry blocklist, or its latest attestation (`get_attestation_for_account`) has `max_severity` critical/high **and** the live `code_hash` still equals the attested one (the flaw is still deployed).
- **warn** if the account is a contract with no attestation, its live `code_hash` differs from the attested one (code changed since review), the account is younger than `MIN_AGE_DAYS`, or the attestation is older than `MAX_ATTEST_AGE_DAYS`.
- **allow** otherwise. Every verdict lists reasons and the signal values (account age from first-seen block via FastNEAR indexer API or RPC, `code_hash` via `view_account`, attestations via `get_attestation_for_account`, populated from the `deployed` field the requester signed).

`@omniswarm/guard` wraps any signer: `guard.wrap(signer, {onWarn: askHuman})` → refuses `block`, calls `onWarn` for `warn`. The demo agent holds only a function-call key, which cannot transfer NEAR, so it pays through a small `demo-payments` contract method `pay_out(receiver, amount)` funded for the demo; a prompt-injected instruction tells it to pay a known-bad address; the guard blocks it and the log is committed under `packages/guard/demo/attack/`.
