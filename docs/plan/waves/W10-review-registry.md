# W10 — Review Registry (NEAR)

> **Track:** Chain (C) · **Tag:** `wave-10` · **Check:** `npm run check:w10` (`npm run test:contract` + `ChainPort` contract suite against the deployed testnet contract with `OMNI_LIVE=1`)
> **Depends on waves:** W00 (layout, `contracts/` folder, root `test:contract` script, AGENTS.md note that our own `contracts/` is built and tested on the developer host, `shared/schemas/attestation.schema.json`). Soft: W08 `ChainPort` interface and contract suite (the testnet adapter is written against them; until W08's interface lands the adapter codes against the W00 schema and the INTAKE §5 method list).
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §3 steps 6–10, §5 Ports, §6 · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-02, OD-06, OD-07, OD-08, OD-09
> **Owned paths:** `contracts/review-registry/**` (Cargo crate, `tests/` near-workspaces, `scripts/deploy-testnet.sh`, `README.md`), `backend/intake/src/chain/adapters/near/**`, `backend/intake/test/chain-near/**`, `docs/plan/checks/w10-check.md`. Uses without owning: W08's `ChainPort` interface and `test/contract/chain.contract.ts` (W10 adds an adapter switch, not new cases; a needed case is a change request to W08 or the lead).
> **Change requests to the lead:** CR-10a root scripts `test:contract` (`cargo test` + near-workspaces in `contracts/review-registry`) and `check:w10`; CR-10b CI job with Rust stable + `wasm32-unknown-unknown` + `cargo-near` on the CI host only (never inside the review sandbox — AGENTS.md boundary); CR-10c `attestation.schema.json` fields `{requestHash, reportSha256, reportUri, deployed, codeHash, maxSeverity, blockHeight}`.
> **Owner actions:** create and fund `review-registry.<owner>.testnet` and the treasury account, sign the deploy, add the operator function-call key (W10-09 prepares every command; the owner runs it).

## Goal

A small (~150 lines of logic) `near-sdk` contract that turns a signed review request into an **on-chain, single-use, paid record**, lets the backend's **function-call key** mark it running, attest the report hash or refund it, and lets anyone read requests and attestations. The backend gets a **real testnet `ChainPort` adapter** that passes the same contract suite as the W08 mock, so `NEAR_ADAPTER=testnet` swaps chains without touching API code.

## Demo story (the check in words)

1. `npm run test:contract` → near-workspaces tests pass: pay → `Pending`; reuse of the hash rejected; underpayment rejected; operator `mark_running` → `attest` → `Done`; refund of `Done` rejected; refund of `Pending` returns the deposit; non-operator `attest` rejected; `withdraw` by the owner moves only earned deposits.
2. `bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run` prints the exact `near` CLI commands (create account, deploy wasm, `new`, add FC key for the operator with method names and allowance); the owner runs them without `--dry-run`.
3. `near contract call-function as-read-only review-registry.<owner>.testnet get_price json-args {}` → `"1000000000000000000000000"` (1 NEAR, OD-08).
4. From the landing's dev page (or `scripts/testnet-pay.ts` with a testnet key) call `request_review({request_hash})` with 1 NEAR → the explorer shows the tx and an `EVENT_JSON` log `{"standard":"omniswarm","version":"1.0.0","event":"review_requested",…}`.
5. `NEAR_ADAPTER=testnet OMNI_LIVE=1 npm run test:contract:chain -w backend/intake` → the same W08 `ChainPort` suite passes against testnet (prints `adapter=testnet`), including `getTx` FINAL, `getRequest`, `attest`, `refund`.
6. Run W08+W09 with `NEAR_ADAPTER=testnet`: a full request ends `done` and `get_attestation_for_account("<deployed>")` returns `{report_sha256, code_hash, max_severity}`; the explorer shows `review_attested` signed by the operator FC key.
7. Try to call `withdraw` with the operator FC key → the RPC rejects it (method not allowed by the key); README §"Key limits" explains why.
8. (H+, OD-02) `reviewer_attest(request_hash, reviewer_id, subreport_sha256)` signed by `glm.reviewers.<owner>.testnet` → event `subreport_attested` traced to that reviewer's sub-account.

## Hackathon slice

- **The hackathon check covers demo steps:** 1–7. Steps 2 and 4 need the owner's testnet account and signature.
- **Deferred:** step 8 (`H+`, OD-02), mainnet deploy (OD-08/OD-09: mainnet stays off for the hackathon), upgrade/migration methods, reproducible-wasm build.
- **Still true:** the review engine never calls RPC; only `backend/` and these scripts do.

## Features covered

- [x] Contract scaffold, state, init, price and operator admin — W10-01, W10-02
- [x] `request_review` payable with storage and hash checks — W10-03
- [x] `mark_running`, `attest`, `refund`, `withdraw` with role checks — W10-04, W10-05, W10-06
- [x] Views and NEP-297 events — W10-07
- [ ] near-workspaces test suite — W10-08
- [x] Build and testnet deploy script (owner runs) — W10-09
- [x] Testnet RPC client with FastNEAR primary and Lava fallback — W10-10
- [ ] Real `ChainPort` adapter: `verifyMessage`, `getTx` FINAL, views, FC-key signing for operator calls; passes the W08 contract suite — W10-11, W10-13, W10-14
- [x] Contract README: methods, events, key limits — W10-15
- [ ] Per-reviewer sub-accounts and sub-report attestations (H+, OD-02) — W10-12
- [x] Wave check, owner guide, tag — W10-16

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W10-01 | Contract: crate `contracts/review-registry` (near-sdk 5.x pinned, `Cargo.lock` committed), state `{owner, operator, treasury, price_yocto, requests: LookupMap<hash, Request>, attestations: LookupMap<hash, Attestation>, by_account: LookupMap<AccountId, hash>, earned_yocto}`, `Request{account, deposit, block_height, status}`, `Status{Pending, Running, Done, Refunded}`; file CR-10a/b/c | contract | S | H | — | `cargo check -p review-registry` on the host → compiles; `cargo test` runs an empty unit test | INTAKE §6 |
| W10-02 | `new(owner, operator, treasury, price_yocto)` (#[init], once), `set_price`, `set_operator`, `get_price`; owner-only asserts with clear panic messages | chain | S | H | W10-01 | Unit test: second `new` panics; `set_price` from a non-owner panics `ERR_NOT_OWNER` | INTAKE §6 |
| W10-03 | `request_review(request_hash)` #[payable]: hash is 64 lowercase hex, unused, `deposit ≥ price + storage cost` (measured `env::storage_usage` delta × byte cost asserted ≤ deposit − price); stores `Pending`; emits `review_requested {request_hash, account, deposit}` | chain | M | H | W10-02 | Unit tests: valid → `Pending`; same hash twice → `ERR_HASH_USED`; 0.5 NEAR → `ERR_DEPOSIT_LOW`; `"ABC"` → `ERR_HASH_FORMAT` | INTAKE §6, OD-06 |
| W10-04 | `mark_running(hash)` (operator), `attest(hash, repo, commit, report_sha256, report_uri, deployed: Option<AccountId>, code_hash: Option<String>, max_severity)` (operator): `Pending|Running → Done`, store `Attestation`, update `by_account[deployed]`, add deposit to `earned_yocto`; emit `review_attested` | chain | M | H | W10-03 | Unit tests: operator attest → `Done` and `get_attestation_for_account(deployed)` returns it; non-operator → `ERR_NOT_OPERATOR`; attest of `Refunded` → `ERR_BAD_STATUS` | INTAKE §6 |
| W10-05 | `refund(hash)` (operator or owner): `Pending|Running → Refunded`, `Promise::new(account).transfer(deposit)`, emit `review_refunded`; status flipped **before** the transfer (no re-entrancy window), no callback needed for a plain transfer | chain | S | H | W10-03 | Unit test: refund of `Pending` → `Refunded` + transfer promise of the exact deposit; refund twice → `ERR_BAD_STATUS`; refund of `Done` → `ERR_BAD_STATUS` | INTAKE §6, OD-07 |
| W10-06 | `withdraw(amount)` (owner): `amount ≤ earned_yocto`, transfer to `treasury`, decrement before the promise | chain | S | H | W10-04 | Unit test: withdraw more than earned → `ERR_INSUFFICIENT_EARNED`; pending deposits are never withdrawable | INTAKE §6 |
| W10-07 | Views `get_request`, `get_attestation`, `get_attestation_for_account`, `get_attestations_for_repo` (index by the explicit `repo` arg of `attest`, INTAKE §6), `get_price`; NEP-297 helper `emit(event, data)` producing `EVENT_JSON:{"standard":"omniswarm","version":"1.0.0",…}` | chain | S | H | W10-04 | Unit test: each event log string parses as JSON with the 4 NEP-297 fields; views return `null` for unknown keys | INTAKE §6, NEP-297 |
| W10-08 | near-workspaces suite (`contracts/review-registry/tests/`): deploy to a local sandbox on the **developer/CI host**, run demo step 1's 8 scenarios with real accounts and balances (refund returns the deposit minus nothing; storage paid from deposit) | test | M | H | W10-03..07 | `npm run test:contract` → 8 scenarios pass in < 2 min; balances asserted to the yocto for refund and withdraw | INTAKE §6 |
| W10-09 | Build + deploy tooling: `cargo near build non-reproducible-wasm` on the host; `scripts/deploy-testnet.sh [--dry-run]` creates `review-registry.<owner>.testnet`, deploys, calls `new`, adds the operator **function-call key** (receiver = contract, methods `mark_running,attest,refund,report_address,reviewer_attest`, allowance 1 NEAR), prints the key's public part only; the owner runs it | chain | M | H | W10-08 | `--dry-run` prints 4 `near` commands with no secrets; after the owner runs it, demo step 3 returns the price | INTAKE §6, OD-09 |
| W10-10 | RPC client (`adapters/near/rpc.ts`): JSON-RPC over `fetch` with `RPC_URLS_TESTNET` (FastNEAR first, Lava fallback), 429/5xx backoff and fallback, 10 s timeout, request id, metrics counters | server | S | H | — | Unit test with a fake server: first URL returns 429 twice → the client falls back to the second and succeeds; all URLs down → `CHAIN_UNAVAILABLE` | INTAKE §2 RPC |
| W10-11 | Real `ChainPort` reads: `verifyMessage` (`near-api-js/nep413` `verifyMessage` with the RPC provider), `getTx` (`tx`, `wait_until: FINAL`, success, signer, receiver, FunctionCall `request_review` + deposit), `getRequest`, `getAttestationForAccount`, `isReported`, `viewAccount`, `viewCodeHash`, `health` | server | M | H | W10-10 | `OMNI_LIVE=1` test: `getTx` of the demo-step-4 tx → success, signer and deposit match; `viewCodeHash("review-registry.<owner>.testnet")` → 44-char base58 | INTAKE §3 step 7, §5 |
| W10-12 | Per-reviewer sub-accounts (OD-02): `scripts/create-reviewer-accounts.sh` creates `<reviewer-id>.reviewers.<owner>.testnet` with FC keys on the contract method `reviewer_attest(hash, reviewer_id, subreport_sha256)` (contract method + event `subreport_attested` added here); worker hook signs each `reviewers/<id>/report.json` hash with that reviewer's key | chain | M | H+ | W10-04, W10-14 | Demo step 8 → one `subreport_attested` event per reviewer, each signed by its own sub-account | OD-02, TRACKS 05 |
| W10-13 | Real `ChainPort` writes: `markRunning`, `attest`, `refund` signed with the operator FC key (`OPERATOR_KEY` from `/etc/omniswarm/worker.env`, `KeyPairSigner`), nonce handling with a per-key mutex and one retry on `InvalidNonce`, wait FINAL, return tx hash | chain | M | H | W10-11, W10-09 | `OMNI_LIVE=1` test: attest a paid testnet request → tx hash returned and `get_request` shows `Done`; 5 parallel calls → all succeed with increasing nonces | INTAKE §3 steps 9–10 |
| W10-14 | Adapter switch `NEAR_ADAPTER=mock|testnet` in the W08 config, and the W08 `ChainPort` contract suite run against testnet (`OMNI_LIVE=1`, uses a funded test payer key from `TEST_PAYER_KEY`, never committed) | test | S | H | W10-11, W10-13 | Demo step 5 → all suite cases pass with `adapter=testnet`; without `OMNI_LIVE` the testnet run is skipped with a message | INTAKE §5 |
| W10-15 | `contracts/review-registry/README.md`: methods, events, statuses, storage and price rule, **key limits** (the operator FC key cannot transfer NEAR, add keys or call `withdraw`; it can lock itself out if the gas allowance runs out — how to top it up), deploy steps, explorer links | docs | S | H | W10-09 | Demo step 7 behaves as the README states; the README names every method and event in INTAKE §6 | TRACKS 06 (FC key requirement) |
| W10-16 | Wave check: `npm run check:w10` (contract tests + mock suite; live suite when `OMNI_LIVE=1`), `checks/w10-check.md` with the testnet explorer URLs, tag `wave-10` | test | S | H | all above (H) | `npm run check:w10` → green offline; with `OMNI_LIVE=1` → green against testnet | — |

## Wave DoD

- `npm run test:contract` passes on the host and in CI (the Rust toolchain and `cargo-near` exist only on the host/CI image, never in the review sandbox).
- The contract is deployed on testnet by the owner; the operator key on the backend is a **function-call key** limited to the operator methods (verified by demo step 7).
- The W08 `ChainPort` contract suite passes against both the mock and testnet.
- `NEAR_ADAPTER=testnet` runs the W08+W09 flow end to end (the D10 gate in HACKATHON_CUT).
- Tag `wave-10` on the merge commit.
