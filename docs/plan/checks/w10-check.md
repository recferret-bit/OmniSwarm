# W10 — Review Registry: owner check

Wave file: [`../waves/W10-review-registry.md`](../waves/W10-review-registry.md). About 3 minutes. No testnet key, no `cargo-near`, and no wasm target. Host `cargo test` uses near-sdk 5.30.0's unit-testing VM.

**Scope of the `wave-10` tag: an offline slice.** It covers the contract, its unit tests, a near-workspaces sandbox suite (6 scenarios, not the plan's 8) and the deploy dry run. These plan gates are not in it: the RPC client and the real `ChainPort` adapter (W10-10, -11, -13, -14), per-reviewer sub-accounts (W10-12), and a deployed testnet contract with explorer links (W10-16 DoD).

## Steps

**1. Contract tests and lint.**

```sh
CARGO_TARGET_DIR=<scratch>/cargo-near cargo test --manifest-path contracts/review-registry/Cargo.toml
cargo clippy --manifest-path contracts/review-registry/Cargo.toml --all-targets -- -D warnings
```

86 tests pass and clippy is clean. Rules covered, one test or more each:

- Pay: `Pending` with `locked` updated; reused hash `ERR_HASH_USED`; half price `ERR_DEPOSIT_LOW`; bad or uppercase hash `ERR_HASH_FORMAT`; a deposit below the record's storage cost `ERR_STORAGE_COST`; a contract that cannot back the new record `ERR_RESERVE`.
- Run and attest: operator only (`ERR_NOT_OPERATOR`); unknown hash `ERR_NOT_FOUND`; attest of `Refunded` or `Done` `ERR_BAD_STATUS`; every attest argument rule (repo, commit, report hash, `https://` URI and its length, severity enum, base58 code hash, `deployed`/`code_hash` pair).
- Binding: a third-party `deployed` is not visible through `get_attestation_for_account`; requester equal to `deployed` binds at once; only `deployed` can `confirm_binding`, once; an older confirmation does not replace a newer binding.
- Refund: exact deposit to the requester and an `on_refund_done` callback (from the created receipts); refund twice, or refund of `Done`, `ERR_BAD_STATUS`; a failed transfer restores the previous status and `locked`.
- Withdraw: owner only; pending deposits are not earned; transfer to the treasury with an `on_withdraw_done` callback; capped by `get_withdrawable` (storage stake and locked deposits) with `ERR_RESERVE`; a failed transfer restores `earned`.
- Admin: non-owner `set_price`, `set_operator`, `set_treasury`, `propose_owner` give `ERR_NOT_OWNER`; two-step owner rotation; events for each change.
- Views: unknown keys give `null` or empty; repo pagination defaults to 20 and is capped at 50.
- Events: each log parses as NEP-297 with exactly `standard`, `version`, `event` and `data[1]`; `review_attested` carries the full attestation.

- Reports (W13-07, contract v0.3.0): operator only `report_address`; evidence `https://` up to 2000 bytes (`ERR_EVIDENCE_URI`); reason 1 to 280 characters without control characters (`ERR_REASON`); one report per account (`ERR_ALREADY_REPORTED`); owner only `retract_report` (`ERR_NOT_REPORTED` when absent), which frees the storage; `get_reports` pagination, including after a retraction; report storage lowers `get_withdrawable` and cannot use `locked` deposits (`ERR_RESERVE`).

`#[init]` (second `new`) and `#[private]` (callbacks) are enforced in generated wasm glue that the mock VM does not run. The near-workspaces suite covers them (step 1b).

**1b. Sandbox suite (near-workspaces 0.24, local near-sandbox).**

```sh
bash contracts/review-registry/scripts/test-sandbox.sh
```

6 tests pass in about 5 s after the first build: request → run → attest → `get_attestation_for_account`; refund pays the requester exactly the deposit (yocto-exact balance check); a refund to a deleted account bounces, and `on_refund_done` returns `false` and restores `Pending` and `locked`; a second `new` fails with "already been initialized"; `on_refund_done` and `on_withdraw_done` from an outside account fail with "is private"; report and retract with the operator check. It needs `rustup target add wasm32-unknown-unknown`, and the first run downloads the sandbox binary. It builds the wasm with `--cfg near`, as cargo-near does. Without that flag, every contract panic turns into a bare `unreachable` trap.

**2. Deploy dry run.**

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
```

Prints six commands: `cargo near build`, create `review-registry.<owner>` and `operator.<owner>` (`fund-myself`, keys saved to the keychain), deploy with `new(owner, operator.<owner>, treasury, 1 NEAR)`, add the function-call key **on the operator account** for `mark_running, attest, refund, report_address`, and read `get_price`. No command prints a secret key. Without a flag the script exits 2. `--execute` runs the same commands for the owner. The unit tests run the dry run and check that the key's account is the `operator` in `new`, and that its method list equals the contract's `OPERATOR_METHODS`.

Subcommands and flags were checked against the near-cli-rs 0.30.0 source (`--allowance`, `--contract-account-id`, `--function-names`, `fund-myself … save-to-keychain sign-as`, `save-to-legacy-keychain`, `with-init-call … prepaid-gas … attached-deposit`). `near` is not installed here, so the commands have not been run.

## Automated checks

`npm run check:w10` is `cargo test`, clippy and the dry run. All pass on the host. The sandbox suite is separate (`npm run test:contract:sandbox` once the lead adds it to the root `package.json`, or the script directly) because it downloads a binary on first use.

## Owner steps (not automated)

1. `bash contracts/review-registry/scripts/deploy-testnet.sh --execute` with `OWNER=<you>.testnet`.
2. `near contract call-function as-read-only review-registry.<you>.testnet get_price json-args '{}' network-config testnet now` returns `"1000000000000000000000000"`.
3. Move `~/.near-credentials/testnet/operator.<you>.testnet/*.json` into the host env file, then delete the local copy.
4. Record the explorer URLs for the contract and the operator key here.
