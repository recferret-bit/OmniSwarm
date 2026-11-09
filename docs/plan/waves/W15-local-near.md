# W15: Local NEAR (the real contract on a local sandbox, end to end)

> **Track:** Chain (C) with Intake (B), Front (F), Security (S), Infra (I) · **Tag:** `wave-15` · **Check:** `npm run check:w15`, which starts near-sandbox, deploys, seeds, runs the headless flow and runs the parity test. It needs network once to download the sandbox binary, and is offline after that.
> **Depends on waves:** W08, W09, W10, W13 (all landed). Soft: W16-01 (regenerated `openapi.json`/`schema.gen.ts`). W15-01 regenerates them again after its enum change, so whichever lands second rebases.
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §4–§7, [`contracts/review-registry/INTERFACE.md`](../../../contracts/review-registry/INTERFACE.md), new `docs/spec/LOCAL_NEAR.md` (W15-00)
> **Owned paths:**
> - New: `infra/near-local/**`, `tests/e2e/near-local/**`, `tests/e2e/landing/near-local.test.mjs`, `apps/api/test/parity/**`, `contracts/review-registry/res/**`, `contracts/review-registry/scripts/build-wasm.sh`, `apps/web/src/lib/near/dev-wallet.ts`, `docs/spec/LOCAL_NEAR.md`, `docs/plan/checks/w15-check.md`
> - Edited: `apps/api/src/config/**`, `apps/api/src/modules/quote/**`, `apps/api/src/modules/dashboard/**`, `apps/api/src/chain/mock/**`, `apps/api/src/container.ts` (guard wiring only), web `env.ts`, `apps/web/src/lib/near/{connector,near-connector,explorer,rpc}.ts`, `apps/web/src/lib/report/verify.ts`, `packages/guard/src/nearblocks-age.mjs`, `packages/guard/demo/attack/**`, `infra/compose/{local.sh,compose.yml,workers.sh}`, `infra/env/dev.env.example`
> - **Not owned (W16):** `apps/web/src/components/**`, `tests/e2e/landing/flow.test.mjs`, the two generated API files
> **Lead pre-steps:** W15-01 (schemas, enums, migration, root script names, `.gitignore` for `infra/compose/.local/near/`).

## Goal

Every NEAR feature OmniSwarm uses runs on one machine against the **real `review-registry` wasm** on a local `near-sandbox` node. No testnet, no browser wallet extension, no public RPC. This means:
- the browser and headless clients sign NEP-413 with real ed25519 keys and send real `request_review` transactions
- the API confirms payment with its existing near adapter
- the worker's operator function-call key calls `mark_running`, `attest`, `refund` and `report_address`
- `/r/<id>` recomputes the report hash and reads `get_attestation` from the local RPC
- the guard reads the attestation, the live `code_hash`, the blocklist and the account age from local services
- the owner methods (`withdraw`, `set_*`, `propose_owner`/`accept_owner`, `confirm_binding`, `retract_report`) can be called from one ops script

The Postgres mock chain stays for fast unit tests. A parity test now keeps it honest against the real contract.

**Why a sandbox node and not a better mock:** today the real contract runs only in `tests/workspaces.rs`. The web mock (MSW) and the API mock (Postgres) never share state. The stack's web build points a real testnet wallet at a contract id that doesn't exist. Storage cost, `locked`/`earned`, the refund transfer and its bounce, NEP-297 logs and `#[private]` callbacks can only be exercised by running the wasm.

**Network identity:** a new, explicit network value `sandbox`. It is never a sandbox labelled `testnet`, because that would silently break `priceFor`, the default price, explorer links and the NEP-413 recipient. `sandbox` is refused in production config.

## Demo story (the check in words)

1. `npm run near:local -- up && npm run near:local -- seed`:
   - starts near-sandbox on `127.0.0.1:3030`
   - deploys `contracts/review-registry/res/review_registry.wasm` to `registry.test.near` and calls `new`
   - creates `owner`, `operator` (function-call key for `mark_running`/`attest`/`refund`/`report_address` with a 1 NEAR allowance), `treasury`, `alice`, `bob`
   - deploys the guard fixtures `good-dex` and `drained-vault`, attests them `low` and `critical`, and reports `phish`
   - prints a table of accounts and tx hashes
2. `npm run stack:local` with `NEAR_LOCAL=1` (the default once W15 lands): the web build uses the dev wallet, the API and workers use `CHAIN_ADAPTER=near` on the sandbox, and the local indexer runs on `127.0.0.1:3031`.
3. In the browser: **Connect** → pick `alice` from the dev wallet → paste a repo → **Quote** (1 NEAR) → **Sign** (NEP-413) → **Pay** (a real `request_review` tx) → status streams → `/r/<id>` shows **match**. The tx link opens the local explorer page with the `review_requested` and `review_attested` EVENT_JSON logs.
4. `/dashboard` (`operator`/`operator`): on `sandbox`, the review is paid on chain from a seeded dev account, so the dashboard path is attested too.
5. `curl '/api/guard/verdict?account=good-dex.test.near&network=sandbox'` → `allow`. `drained-vault` → `block`. `npm run near:local -- redeploy good-dex --alt` then repeat → `warn` with `CODE_CHANGED_SINCE_REVIEW`. `phish` → `block` with `REPORTED`.
6. `node packages/guard/demo/attack/run.mjs --sandbox` → the prompt-injected agent is refused before signing, using live sandbox state rather than the recorded snapshot.
7. `npm run near:local -- call withdraw` (and `set_price`, `refund <id>`, `confirm_binding`, `retract_report`, `propose_owner`/`accept_owner`) → each prints the tx hash and the new state. A refund to a deleted account shows `refund_failed` and status `Pending`.
8. `npm run check:w15` → green. This includes the parity test (mock and sandbox give the same outcome for every scenario) and the headless end-to-end flow.

## Hackathon slice

- **H:** demo steps 1–3, 5, 6 and 8, plus step 4's on-chain payment, plus the ops script for `withdraw`/`refund`/`confirm_binding`. The owner said local must cover 100% of their needs.
- **H+:** the Playwright browser run in CI (it runs locally in the owner check either way) and the local explorer's account page.
- **Still true:**
  - The engine (`engine/**`) gets no NEAR path.
  - Sandbox keys are dev-only, kept under the gitignored `infra/compose/.local/near/`, and the loopback-only indexer serves them.
  - The production config refuses `sandbox`.

## Wave DoR (the wave may open when all of these are true)

- [ ] W15-00 spike is answered in `docs/spec/LOCAL_NEAR.md`. It covers:
  - whether the near-sandbox binary runs on **darwin-arm64** and **linux-x64**
  - where it is downloaded from (the near-sandbox crate's URL or the `near-sandbox` npm package)
  - the cache path (`infra/compose/.local/near/bin/`, honours `NEAR_SANDBOX_BIN_PATH`)
  - the chain id and the genesis/validator key location
  - whether containers can reach the host's sandbox (`host.docker.internal:3030`) on macOS and Linux. That covers the bind address (a `127.0.0.1` bind is unreachable from containers) and `extra_hosts: host.docker.internal:host-gateway` on Linux
  - whether the sandbox RPC sends `Access-Control-Allow-Origin` for `http://omniswarm.localhost:18480`. If not, the indexer (W15-08) proxies RPC with CORS
  - Rust: no Rust is needed for the local flow; it uses the committed wasm and its sha256
- [ ] W15-01 is landed by the lead. It covers:
  - the `sandbox` network value in the schemas, the API and web enums, and a migration that extends the CHECK
  - the env keys
  - the `accounts.json` format
  - the root script names
  - `.gitignore`
- [ ] W08, W09, W10 and W13 are tagged in `main` (true).
- [ ] Each issue below has its owned paths, deps and a do-X-see-Y acceptance (true when this file lands).

**If the spike fails** (no darwin binary and no Docker image): the wave falls back to **W15-F**. That means fixing the Postgres mock against the drift list in W15-14 and running the contract only in `test:contract:sandbox` on Linux CI. The owner decides on D9.

## Features covered

- [ ] Spike and decisions: W15-00
- [ ] `sandbox` network contract: W15-01
- [ ] Sandbox runner, wasm artifact, deploy and seed, guard fixtures: W15-02, W15-03, W15-04, W15-04b
- [ ] API on the sandbox, dashboard pays on chain: W15-05, W15-06
- [ ] Dev wallet, http RPC on sandbox, verify fallback: W15-07, W15-10
- [ ] Local indexer and explorer (account age, tx/event pages, dev keys): W15-08
- [ ] Guard and attack demo on live sandbox state: W15-09
- [ ] One-command stack: W15-11
- [ ] Owner/admin ops script: W15-12
- [ ] Mock ↔ contract parity, mock fixed: W15-13, W15-14
- [ ] Headless e2e and browser e2e: W15-15, W15-16
- [ ] Wave check, coverage matrix, owner guide, tag: W15-17

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W15-00 | Spike: near-sandbox on darwin-arm64 and linux-x64, download source and cache, chain id, validator key, container → host reach, wasm without Rust. Write the decisions | docs | S | H | — | `docs/spec/LOCAL_NEAR.md` | `LOCAL_NEAR.md` §Decisions answers every DoR question (binary, source/cache, chain id/key, container reach and bind address, CORS, wasm without Rust), each with the command that proved it | — |
| W15-01 | Lead contract (part 1 of 2):<br>• `sandbox` in `intake-api.schema.json` and `job.schema.json`, plus a valid example; `localnet` stays invalid<br>• migration `007_network_sandbox.sql` extends the `001_core.sql:17` CHECK<br>• enums in api `env.ts:51`, `signed-message.ts:13`, `shared/patterns.ts:14`, `queue/review-queue.ts:22`, and web `env.ts:39`<br>• `need()` refuses `sandbox` when `production`<br>• regenerate `openapi.json` and `schema.gen.ts` | contract | S | H | W15-00 | `packages/schemas/**`, `apps/api/src/db/migrations/007_*`, the enum lines listed, the two generated files | `npm run test:schemas && npm run test:intake && npm run test:landing` → green. A `network:"sandbox"` quote request validates; `localnet` still fails | INTAKE §4 |
| W15-01b | Lead contract (part 2 of 2):<br>• env keys in `dev.env.example`: `NEAR_LOCAL`, `NEAR_NETWORK=sandbox`, `RPC_URLS`, `NEXT_PUBLIC_WALLET=local`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_EXPLORER_URL`, `GUARD_ACCOUNT_AGE_URL`, `DEV_WALLET_URL`<br>• the `accounts.json` schema<br>• root scripts `near:local`, `check:w15`<br>• `.gitignore` for `infra/compose/.local/near/` | contract | S | H | W15-01 | `infra/env/dev.env.example`, `packages/schemas/near-local-accounts.schema.json`, root `package.json` scripts, `.gitignore` | `npm run near:local -- --help` prints the reserved subcommands (no-op stub); `npm run check:w15` is a reserved no-op | — |
| W15-02 | Sandbox runner `infra/near-local/near-local.sh up\|down\|status\|reset`:<br>• fetches and caches the binary per W15-00<br>• `init` into `.local/near/home`<br>• runs on `127.0.0.1:3030`<br>• waits for `/status`<br>• writes a pid file | infra | S | H | W15-01b | `infra/near-local/near-local.sh`, `infra/near-local/README.md` | `npm run near:local -- up` → `curl -s 127.0.0.1:3030/status` shows the sandbox chain id. `down` → the port is closed. A second `up` reuses the cached binary with no download | — |
| W15-03 | Committed release wasm:<br>• `scripts/build-wasm.sh` (same flags as `test-sandbox.sh`, `--cfg near`) writes `res/review_registry.wasm` and `res/review_registry.wasm.sha256`<br>• the runner and deploy prefer `res/` when no Rust toolchain is present<br>• also commit two distinct tiny fixture wasms for the guard drift demo | chain | S | H | W15-00 | `contracts/review-registry/scripts/build-wasm.sh`, `contracts/review-registry/res/**`, `infra/near-local/fixtures/*.wasm` | `bash contracts/review-registry/scripts/build-wasm.sh` → prints the sha256 and the file matches it. `shasum -a 256 -c res/*.sha256` → OK | — |
| W15-04 | Core seed `infra/near-local/seed.mjs` (near-api-js, sandbox validator key):<br>• creates `owner`, `operator` (function-call key on the registry for `mark_running`/`attest`/`refund`/`report_address`, 1 NEAR allowance), `treasury`, `alice`, `bob`<br>• deploys the registry, calls `new`, sets the price<br>• writes `accounts.json`, with dev keys in `.local/near/keys/` (mode 600)<br>• idempotent; `--reset` starts again | chain | M | H | W15-02, W15-03 | `infra/near-local/seed.mjs`, `infra/near-local/lib/*.mjs` | `npm run near:local -- seed` → a table of accounts and tx hashes. `near-local view registry get_config` → shows the operator and price. A second run says "already seeded" | INTERFACE |
| W15-04b | Guard fixtures `infra/near-local/seed-guard.mjs` (run by `seed` after the core):<br>• deploys `good-dex` and `drained-vault` from the fixture wasms<br>• attests them `low` and `critical` through the operator key<br>• creates and reports `phish` with an evidence URI<br>• records the creation blocks for the indexer | chain | S | H | W15-04 | `infra/near-local/seed-guard.mjs` | `near-local view registry get_attestation_for_account {account:"drained-vault.test.near"}` → `max_severity: critical`. `is_reported phish` → true | W13 |
| W15-05 | API on the sandbox:<br>• `load.ts` maps `NEAR_NETWORK=sandbox` to `CHAIN_ADAPTER=near`, `RPC_URLS` (host `127.0.0.1:3030`, containers `host.docker.internal:3030`), the sandbox price, and `OPERATOR_KEY_FILE` from `.local/near/keys/operator.json`<br>• `priceFor` knows `sandbox`<br>• `health` reads the sandbox | server | M | H | W15-01, W15-01b | `apps/api/src/config/**`, `apps/api/src/modules/quote/**` | With the sandbox seeded: `POST /api/quote {network:"sandbox"}` → 1 NEAR and the contract id `registry.test.near`; `GET /api/health` → `chain: ok` with the sandbox block height. `NODE_ENV=production NEAR_NETWORK=sandbox` → config error | INTAKE §4 |
| W15-06 | Dashboard pays on chain on `sandbox`:<br>• `dashboard.service.ts:24-59` sends a real `request_review` with the configured price from the seeded `bob` key<br>• the mock keeps `'0'`<br>• `assertDashboardChain` accepts `sandbox` | server | S | H | W15-04, W15-05 | `apps/api/src/modules/dashboard/**` | A dashboard review on the sandbox → `near-local view registry get_request {request_hash}` shows `Pending → Running → Attested`, deposit 1 NEAR. The service refuses to load the funded dev key unless the network is `sandbox` (unit test) | — |
| W15-07 | Dev wallet `apps/web/src/lib/near/dev-wallet.ts` (`NEXT_PUBLIC_WALLET=local`):<br>• lists the seeded accounts from `DEV_WALLET_URL` (the W15-08 indexer)<br>• signs NEP-413 with the real key (ed25519)<br>• sends `request_review` through near-api-js to `NEXT_PUBLIC_RPC_URL`<br>• `connector.ts` picks it<br>• web `env.ts` allows `http://` RPC and explorer URLs only when the network is `sandbox`<br>• near-connect is not used here (it only knows mainnet/testnet; say so in a comment) | client | M | H | W15-01 | `apps/web/src/lib/near/dev-wallet.ts`, `connector.ts`, `near-connector.ts`, web `env.ts` | Unit: the dev wallet's NEP-413 signature verifies with `packages/schemas/nep413.mjs`; a `request_review` built against a stub RPC has receiver `registry.test.near` and deposit = price. `NEXT_PUBLIC_NETWORK=testnet` with an http RPC → env error | INTAKE §5 |
| W15-08 | Local indexer and explorer `infra/near-local/indexer.mjs` (Node `http`, no deps, `127.0.0.1:3031`):<br>• the NearBlocks-compatible account-age endpoint `nearblocks-age.mjs` calls, served from the creation blocks `seed` records<br>• `/txns/<hash>`: status, receipts and pretty-printed `EVENT_JSON` logs from the sandbox RPC<br>• `/address/<id>`: code hash and attestation<br>• `/wallet/accounts`: dev keys, loopback only | infra | M | H | W15-01b | `infra/near-local/indexer*.mjs` | `curl 127.0.0.1:3031/v1/account/alice.test.near` → the NearBlocks shape with a creation timestamp. Open `/txns/<seed attest hash>` → a `review_attested` event is shown. A request from a non-loopback address → 403. Responses carry `Access-Control-Allow-Origin: http://omniswarm.localhost:18480`, and the RPC proxy is CORS-enabled if the W15-00 spike needs it | — |
| W15-09 | Guard on live sandbox state:<br>• `nearblocks-age.mjs` accepts `sandbox` with an explicit base URL<br>• `container.ts` passes `GUARD_ACCOUNT_AGE_URL`<br>• the attack demo gains `run.mjs --sandbox`, which reads the registry and `view_account` through RPC instead of `chain-snapshot.json`; the demo agent signs with a function-call key only<br>• `near-local redeploy good-dex --alt` drives the drift case | security | M | H | W15-04b, W15-08 | `packages/guard/src/nearblocks-age.mjs`, `packages/guard/demo/attack/**`, `apps/api/src/container.ts` (guard lines), `infra/near-local/redeploy.mjs` | Demo steps 5–6: `allow`/`block`/`warn CODE_CHANGED_SINCE_REVIEW`/`block REPORTED`; `run.mjs --sandbox` → `refused_before_signing`, signer calls 0. Without the sandbox, `run.mjs` (snapshot) still passes | W13 |
| W15-10 | `/r/<id>` verify and explorer:<br>• `explorer.ts` builds local explorer URLs on `sandbox`<br>• `verify.ts` reads `get_attestation` from `NEXT_PUBLIC_RPC_URL`; if RPC is unreachable it falls back to the attestation from `GET /api/reports/:id`, labelled "via API, not independent" | client | S | H | W15-01 | `apps/web/src/lib/near/{explorer,rpc}.ts`, `apps/web/src/lib/report/verify.ts` | Unit: RPC answers → `match` with source `rpc`; RPC down → `match` with source `api` and the label; a hash mismatch → `mismatch` in both | INTAKE §7 |
| W15-11 | One-command stack:<br>• `local.sh up` with `NEAR_LOCAL=1` (default) runs `near:local up` and `seed`, then the indexer<br>• builds the web with `NEXT_PUBLIC_WALLET=local`, `NEXT_PUBLIC_NETWORK=sandbox` and http URLs<br>• the API and workers run on the sandbox<br>• `down` stops the sandbox (state kept unless `--reset`)<br>• `NEAR_LOCAL=0` keeps today's mock-chain stack | infra | M | H | W15-02, W15-04, W15-05, W15-07, W15-08 | `infra/compose/{local.sh,compose.yml,workers.sh}`, `infra/env/dev.env.example` | `npm run stack:local` → the home page wallet button lists `alice`/`bob`; demo step 3 completes in the browser. `npm run check:infra` → green | — |
| W15-12 | Ops script `infra/near-local/ops.mjs` (`npm run near:local -- call <method> [args]`):<br>• calls `withdraw`, `set_price`, `set_operator`, `set_treasury`, `propose_owner`, `accept_owner`, `refund`, `confirm_binding`, `retract_report`, signing with the matching seeded key<br>• `view <method>` for every view<br>• prints the tx hash and the EVENT_JSON | chain | S | H | W15-04 | `infra/near-local/ops.mjs` | Demo step 7. `call withdraw` → the treasury balance rises by `get_withdrawable`. `call refund` to a deleted account → `refund_failed` and status `Pending` | INTERFACE |
| W15-13 | Parity test `apps/api/test/parity/chain-parity.test.ts`:<br>• runs one scenario table through `MockChainAdapter` and `NearChainAdapter` on the sandbox and diffs `{ok, error code, status, event names}`<br>• scenarios: happy path, refund, refund bounce, report/retract, low deposit, zero deposit, bad severity, attest for a deployed account, binding<br>• skips with a clear message when the sandbox is down | test | M | H | W15-04, W15-05 | `apps/api/test/parity/**` | `npm run test:intake -- parity` with the sandbox up → a table where every row is `same`, or the known divergences that W15-14 fixes. With it down → `skipped: near-sandbox not running` | — |
| W15-14 | Fix the mock to match the contract:<br>• `ERR_DEPOSIT_LOW` and storage cost on `payRequestReview`<br>• the `attest` `require_*` checks and `locked`/`earned`<br>• a real-shaped refund with a bounce flag<br>• the `report_address` reporter is the caller<br>• event rows for `address_reported`, `refund_failed`, `binding_confirmed`<br>• `getPaymentTx` honours `signerId` | server | M | H | W15-13 | `apps/api/src/chain/mock/**` | `npm run test:intake -- parity` → every row `same`. `npm run test:intake` → green (fix any test that relied on a laxness, and list each one in the PR) | — |
| W15-15 | Headless end-to-end flow `tests/e2e/near-local/flow.test.mjs`:<br>• `alice`'s key signs NEP-413 via `canonical-message` → `POST /api/requests` → a real `request_review` tx → `POST /payment` → the worker (`ENGINE_RUNNER=mock`) publishes → `attest` on the sandbox<br>• recompute the report hash, compare it with `get_attestation` → match<br>• then the refund path, the guard verdicts, `report_address` and `withdraw` | test | M | H | W15-05, W15-06, W15-09 | `tests/e2e/near-local/**` | `node --test tests/e2e/near-local/flow.test.mjs` → every step passes and prints the tx hashes. With the sandbox down → skips with the reason | INTAKE §4–§7 |
| W15-16 | Browser end-to-end flow `tests/e2e/landing/near-local.test.mjs` (Playwright): dev wallet → quote → sign → pay → status → `/r/<id>` match → the explorer link opens | test | M | H+ | W15-11 | `tests/e2e/landing/near-local.test.mjs`. If the runner needs a config entry, the lead adds it in W15-01b; `tests/e2e/package.json` and the runner config stay lead-only | `npm run test:e2e -- near-local` against `stack:local` → passes. It is not part of `check:all` (it needs the stack) | — |
| W15-17 | Wave check and coverage:<br>• `check:w15` = up, seed, W15-13, W15-15, attack `--sandbox`<br>• `docs/spec/LOCAL_NEAR.md` §Coverage maps every NEAR touchpoint from the inventory (wallet, NEP-413, payment, FA-key check, tx FINAL, operator calls, blocklist, guard signals, verify, explorer, owner methods, events) to its local path and the test that covers it. Each row's status is one of:<br>&nbsp;&nbsp;– `local`: the real contract on the sandbox<br>&nbsp;&nbsp;– `local-stub`: the shape only (for example the NearBlocks response and the explorer)<br>&nbsp;&nbsp;– `testnet-only`: for example the near-connect wallet extensions and testnet finality timing<br>• `checks/w15-check.md`<br>• tag `wave-15` | test | S | H | W15-02..15 | `docs/spec/LOCAL_NEAR.md` §Coverage, `docs/plan/checks/w15-check.md` | `npm run check:w15` → green on a clean clone (after one binary download). No coverage row is blank. Every `local-stub` or `testnet-only` row names the lane O step that covers it on testnet | — |

**Parallel groups** (at most 6 agents at once):
1. Lead runs W15-00, then W15-01 and W15-01b (D9 morning).
2. W15-02, W15-03, W15-05, W15-07, W15-08, W15-10. Six agents, all paths disjoint. W15-02 and W15-03 are S, so the next step starts as soon as they land.
3. W15-04 (core seed) the moment W15-02 and W15-03 land.
4. Then W15-04b, W15-06, W15-12 and W15-13 in parallel.
5. W15-09 (after W15-04b), W15-11 and W15-14 in parallel.
6. W15-15 (needs 05, 06, 09, **not** 14) and W15-16 in parallel.
7. W15-17.

Longest path: 01 → 02/03 → 04 → 04b → 09 → 15 → 17.

## Wave DoD

- `npm run check:w15` passes on a clean clone on darwin-arm64 and linux-x64. The sandbox binary is downloaded once, then the check runs offline.
- Demo steps 1–8 work in the owner check (`checks/w15-check.md`).
- The parity test shows **no divergence** between the mock chain and the real contract for every scenario.
- `LOCAL_NEAR.md` §Coverage has no blank row. Every row is `local`, or `local-stub`/`testnet-only` with a named lane O step. Nothing claims `local` without a test.
- `npm run check:all` is still green. `NEAR_LOCAL=0` keeps today's mock stack working.
- No key is committed. `infra/compose/.local/near/` is gitignored. `secrets-check` and the gitleaks sweep are clean. The production config refuses `sandbox`.
- `engine/**` is unchanged.
- Tag `wave-15` on the merge commit.
