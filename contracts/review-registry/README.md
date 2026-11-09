# review-registry

NEAR contract for a paid, single-use review request, its attestation, the deployed-account binding, and the abuse-report blocklist the agent guard reads. `near-sdk` 5.30.1, crate version 0.3.0. Host builds use cargo-near 0.23.0. The owner deploys with near-cli-rs 0.31.1.

The full method, argument, event and error list is in [INTERFACE.md](INTERFACE.md).

## Tests

```sh
CARGO_TARGET_DIR=<scratch>/cargo-near cargo test --manifest-path contracts/review-registry/Cargo.toml
cargo clippy --manifest-path contracts/review-registry/Cargo.toml --all-targets -- -D warnings
```

The unit tests run on near-sdk's mock VM (`unit-testing` is a dev-dependency only). They cover every access rule, state transition, validation code, the storage and reserve rules, the refund and withdraw transfers (receiver and exact yocto amount from the created receipts), both failure callbacks, the binding rules, the report registry (access, validation, one report per account, retraction, pagination across a retraction, and its storage against the reserve), pagination, parsed NEP-297 events, and the deploy script's dry run.

Two rules live in generated wasm glue, so the mock VM cannot exercise them: `#[init]` rejecting a second `new`, and `#[private]` rejecting outside callers of the callbacks. The near-workspaces suite covers them on a local `near-sandbox` node:

```sh
bash contracts/review-registry/scripts/test-sandbox.sh    # root: npm run test:contract:sandbox
```

`tests/workspaces.rs` (feature `sandbox`, so plain `cargo test` and the wasm build never compile `near-workspaces`) covers `request_review` → `mark_running` → `attest` → `get_attestation_for_account`, a refund that pays the requester exactly the deposit, a refund to a deleted account whose callback returns `false` and restores `Pending` and `locked`, a second `new` rejected, both callbacks rejecting outside callers, and report/retract with the operator check. It needs `rustup target add wasm32-unknown-unknown`, and the first run downloads the sandbox binary (or set `NEAR_SANDBOX_BIN_PATH`). No `cargo-near` needed for this suite: the script builds with `cargo build --target wasm32-unknown-unknown --release` and `--cfg near`, which is what `cargo near build non-reproducible-wasm` appends to `RUSTFLAGS`, so the deploy script's reproducible build is a separate command. **Without `--cfg near`, near-sdk 5.30 compiles its off-chain code paths into the wasm, so every `env::panic_str` becomes a bare `unreachable` trap.** The access rules still hold (the call fails), but every error code is lost. The review sandbox never installs any of this (AGENTS.md).

## Money

`locked` holds `Pending` and `Running` deposits; `earned` holds `Done` deposits. The contract keeps `balance ≥ storage stake + locked`, and `withdraw` cannot go below that (`get_withdrawable`). Refund and withdraw transfers have callbacks that restore state when the transfer fails.

## Build

`cargo near build reproducible-wasm` (cargo-near 0.23.0) embeds NEP-330 `contract_source_metadata` in the wasm. The image and digest in `Cargo.toml` are the `cargo near new` template from tag `cargo-near-v0.23.0`. The digest identifies the image. The container build command is `cargo near build non-reproducible-wasm --locked` with `passed_env = []`.

Spike, from that cargo-near release: the build uses the git commit and ignores uncommitted edits, so a dirty worktree does not fail the command and those edits are not in the wasm. `Cargo.lock` must be committed. The container clones `repository` (`https://github.com/recferret-bit/OmniSwarm`) at that revision and has no credentials, so the commit must already be pushed and the repository must be cloneable. A local-only commit cannot be reproduced. This session did not produce a wasm that way: the wave commit is not on the remote yet. After it is pushed, from a checkout of that commit:

```sh
cargo near build reproducible-wasm --manifest-path contracts/review-registry/Cargo.toml
```

The wasm at `target/near/review_registry.wasm` then answers `contract_source_metadata` with `link` `https://github.com/recferret-bit/OmniSwarm/tree/<that commit>` (NEP-330) and `build_info.source_code_snapshot` `git+https://github.com/recferret-bit/OmniSwarm?rev=<that commit>`.

What that metadata proves: the contract says which commit it was built from. What it does not prove: that these bytes were rebuilt from that commit. Rebuilding is the verification step below.

## Binding

`get_attestation_for_account` (the guard's view) returns an attestation only when the `deployed` account paid the request itself or later called `confirm_binding`. This stops third parties from binding a report to an account they do not control. The attestation's `repo` and `commit` are a claim. NEP-330 metadata on a counterparty is also a claim: the guard warns with `SOURCE_METADATA_MISMATCH` when they differ, and lists `SOURCE_METADATA_ABSENT` when the method is missing. Neither claim proves the deployed bytes. See INTERFACE.md, "Deployed-account binding".

## Verify

From a clean clone of the commit named in `contract_source_metadata`:

1. Install cargo-near 0.23.0 and Docker. The build runs in the image recorded in `Cargo.toml`.
2. `cargo near build reproducible-wasm --manifest-path contracts/review-registry/Cargo.toml`.
3. Compare the base58 sha256 of `target/near/review_registry.wasm` with the deployed account's `code_hash` (`view_account`). Locally, after `npm run near:local -- seed`: `npm run near:local -- verify registry` prints `match`. `npm run near:local -- verify registry --wasm infra/near-local/fixtures/good-dex.wasm` prints `drift` and both hashes.
4. On testnet, open the contract on [NearBlocks](https://testnet.nearblocks.io) and use **Verify and Publish**, or the same flow on [SourceScan](https://sourcescan.dev). Both clone the commit and rebuild in the recorded image. **Verified** means the rebuilt bytes match the deployed bytes. The NEP-330 view by itself does not.

`npm run near:local -- view registry contract_source_metadata` shows the embedded link and revision once a reproducible wasm is deployed. The current `res/review_registry.wasm` stays the previous build until `--execute` copies a reproducible one.

## Reports

`report_address` (operator) records an owner-approved abuse report: `{account_id, reported_at_ms, evidence_uri, reason, reporter}`. `is_reported` is the guard's blocklist view; `get_report`, `get_reports` and `get_report_count` list the evidence. Only the owner can `retract_report`. Report storage comes out of the free balance under the same reserve rule as everything else, so it lowers `get_withdrawable` and can never use `locked` deposits. See INTERFACE.md, "Changes since v0.2.0".

## Key limits

- The **operator** account (`operator.<owner>`) holds a function-call key for `review-registry.<owner>` limited to `mark_running`, `attest`, `refund` and `report_address`, with a 1 NEAR gas allowance. That key cannot transfer NEAR, add or delete keys, deploy code, or call `withdraw`, `retract_report`, the admin methods, or any other contract. A leaked key can still file false reports, each of which blocks an account in the guard and takes storage from the free balance (never from `locked`). The owner retracts them with `retract_report`, rotates the operator with `set_operator`, and deletes the key. When the allowance runs out, the owner adds a new key. The API signs only with this key. The operator account's own full-access key stays in the owner's keychain.
- The **owner** account signs `withdraw`, `set_*` and `propose_owner`. Rotation is two-step: `propose_owner(new)` and then `accept_owner()` from the new account.
- The **contract** account keeps the full-access key that `create-account` generated. Whoever holds it can redeploy arbitrary code, which would also change the registry the guard trusts. It is the only upgrade path, so the owner keeps it offline. Deleting it (`near account delete-keys`) makes the contract immutable.
- The treasury only receives transfers. It defaults to the owner account.

## Deploy

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run   # prints the commands, touches nothing
bash contracts/review-registry/scripts/deploy-testnet.sh --execute   # the owner runs them (near-cli-rs 0.31.1 + cargo-near 0.23.0)
```

The commands build with `reproducible-wasm`, copy the wasm to `res/review_registry.wasm` with its sha256, create `review-registry.<owner>` and `operator.<owner>` funded by the owner, deploy with `new(owner, operator.<owner>, treasury, 1 NEAR)`, add the operator function-call key, and read `get_price`. `--dry-run` prints the copy and the hash line and does not write them. A second `--execute` copies the wasm, then stops at `create-account` because the account already exists, so the account and its state stay. A redeploy is only the `near contract deploy` line from the dry run. New keys go to the near-cli keychain. The operator key goes to the legacy keychain (`~/.near-credentials/testnet/`) so the owner can move it into the host env file. No command prints a secret key. `OWNER`, `CONTRACT`, `OPERATOR`, `TREASURY`, `PRICE_YOCTO` and `OPERATOR_ALLOWANCE` override the defaults. A unit test checks that the key lands on the operator named in `new`, and that the key's method list equals `OPERATOR_METHODS`.

The owner runs near-cli-rs 0.31.1. The script's subcommands were checked against the 0.30.0 source from crates.io (`fund-myself`, `save-to-keychain`, `save-to-legacy-keychain`, `with-init-call`, `grant-function-call-access`) and are unchanged in 0.31.1. `near` itself was not run from this host.

Explorer: `https://testnet.nearblocks.io/address/review-registry.<owner>.testnet` once deployed.
