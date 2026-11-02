# W10 — Review Registry: owner check

Wave file: [`../waves/W10-review-registry.md`](../waves/W10-review-registry.md). About 3 minutes. No testnet key, no `cargo-near`, and no wasm target. Host `cargo test` uses near-sdk's unit-testing VM.

Worktree: `../OmniSwarm-wt/w10` on `wave/w10-review-registry`.

## Steps

**1. Contract tests.**

```sh
cargo test --manifest-path contracts/review-registry/Cargo.toml
```

10 tests passed, including: a payable `request_review` stores `Pending`; the same hash panics `ERR_HASH_USED`; half the price panics `ERR_DEPOSIT_LOW`; operator `mark_running` then `attest` stores `Done` and `get_attestation_for_account`; a non-operator attest panics `ERR_NOT_OPERATOR`; refund of `Done` panics `ERR_BAD_STATUS`; refund of `Pending` sets `Refunded`, logs the deposit, and does not add it to earned; `withdraw` from a non-owner panics `ERR_NOT_OWNER`; a pending deposit is not withdrawable; the owner withdraws only earned tokens.

**2. Deploy dry run.**

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
```

Prints four `near` commands (create account, deploy, `new`, add the operator function-call key). It does not invoke `near` and does not deploy. Without `--dry-run` the script exits 2.

Live testnet deploy, `OMNI_LIVE=1`, and the RPC adapter are not in this land. The review sandbox image is unchanged and still has no `cargo-near` or `wasm32-unknown-unknown`.

## Automated checks

`npm run check:w10` is `cargo test` plus the dry run. Both passed on the host.
