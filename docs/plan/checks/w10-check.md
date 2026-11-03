# W10 — Review Registry: owner check

Wave file: [`../waves/W10-review-registry.md`](../waves/W10-review-registry.md). About 3 minutes. No testnet key, no `cargo-near`, and no wasm target. Host `cargo test` uses near-sdk 5.30.0's unit-testing VM.

**Scope of the `wave-10` tag: an offline slice.** It covers the contract, its unit tests and the deploy dry run. These plan gates are not in it: the near-workspaces sandbox suite (W10-08), the RPC client and the real `ChainPort` adapter (W10-10, -11, -13, -14), per-reviewer sub-accounts (W10-12), and a deployed testnet contract with explorer links (W10-16 DoD).

## Steps

**1. Contract tests and lint.**

```sh
CARGO_TARGET_DIR=<scratch>/cargo-near cargo test --manifest-path contracts/review-registry/Cargo.toml
cargo clippy --manifest-path contracts/review-registry/Cargo.toml --all-targets -- -D warnings
```

70 tests pass and clippy is clean. Rules covered, one test or more each:

- Pay: `Pending` with `locked` updated; reused hash `ERR_HASH_USED`; half price `ERR_DEPOSIT_LOW`; bad or uppercase hash `ERR_HASH_FORMAT`; a deposit below the record's storage cost `ERR_STORAGE_COST`; a contract that cannot back the new record `ERR_RESERVE`.
- Run and attest: operator only (`ERR_NOT_OPERATOR`); unknown hash `ERR_NOT_FOUND`; attest of `Refunded` or `Done` `ERR_BAD_STATUS`; every attest argument rule (repo, commit, report hash, `https://` URI and its length, severity enum, base58 code hash, `deployed`/`code_hash` pair).
- Binding: a third-party `deployed` is not visible through `get_attestation_for_account`; requester equal to `deployed` binds at once; only `deployed` can `confirm_binding`, once; an older confirmation does not replace a newer binding.
- Refund: exact deposit to the requester and an `on_refund_done` callback (from the created receipts); refund twice, or refund of `Done`, `ERR_BAD_STATUS`; a failed transfer restores the previous status and `locked`.
- Withdraw: owner only; pending deposits are not earned; transfer to the treasury with an `on_withdraw_done` callback; capped by `get_withdrawable` (storage stake and locked deposits) with `ERR_RESERVE`; a failed transfer restores `earned`.
- Admin: non-owner `set_price`, `set_operator`, `set_treasury`, `propose_owner` give `ERR_NOT_OWNER`; two-step owner rotation; events for each change.
- Views: unknown keys give `null` or empty; repo pagination defaults to 20 and is capped at 50.
- Events: each log parses as NEP-297 with exactly `standard`, `version`, `event` and `data[1]`; `review_attested` carries the full attestation.

`#[init]` (second `new`) and `#[private]` (callbacks) are enforced in generated wasm glue that the mock VM does not run. They need the near-workspaces suite, which needs `wasm32-unknown-unknown`, `cargo-near` and a downloaded sandbox binary.

**2. Deploy dry run.**

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
```

Prints six commands: `cargo near build`, create `review-registry.<owner>` and `operator.<owner>` (`fund-myself`, keys saved to the keychain), deploy with `new(owner, operator.<owner>, treasury, 1 NEAR)`, add the function-call key **on the operator account** for `mark_running, attest, refund`, and read `get_price`. No command prints a secret key. Without a flag the script exits 2. `--execute` runs the same commands for the owner. The unit tests run the dry run and check that the key's account is the `operator` in `new`, and that its method list equals the contract's `OPERATOR_METHODS`.

Flag spelling follows near-cli-rs (`--contract-account-id`, `--function-names`); `near` is not installed here, so check it against `near account add-key --help` before `--execute`.

## Automated checks

`npm run check:w10` is `cargo test` plus the dry run. Both pass on the host.

## Owner steps (not automated)

1. `bash contracts/review-registry/scripts/deploy-testnet.sh --execute` with `OWNER=<you>.testnet`.
2. `near contract call-function as-read-only review-registry.<you>.testnet get_price json-args '{}' network-config testnet now` returns `"1000000000000000000000000"`.
3. Move `~/.near-credentials/testnet/operator.<you>.testnet/*.json` into the host env file, then delete the local copy.
4. Record the explorer URLs for the contract and the operator key here.
