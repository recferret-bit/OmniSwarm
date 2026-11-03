# review-registry

NEAR contract for a paid, single-use review request, its attestation, the deployed-account binding, and the abuse-report blocklist the agent guard reads. `near-sdk` 5.30.0, crate version 0.3.0.

The full method, argument, event and error list is in [INTERFACE.md](INTERFACE.md).

## Tests

```sh
CARGO_TARGET_DIR=<scratch>/cargo-near cargo test --manifest-path contracts/review-registry/Cargo.toml
cargo clippy --manifest-path contracts/review-registry/Cargo.toml --all-targets -- -D warnings
```

The unit tests run on near-sdk's mock VM (`unit-testing` is a dev-dependency only). They cover every access rule, state transition, validation code, the storage and reserve rules, the refund and withdraw transfers (receiver and exact yocto amount from the created receipts), both failure callbacks, the binding rules, the report registry (access, validation, one report per account, retraction, pagination across a retraction, and its storage against the reserve), pagination, parsed NEP-297 events, and the deploy script's dry run.

Two rules live in generated wasm glue, so the mock VM cannot exercise them: `#[init]` rejecting a second `new`, and `#[private]` rejecting outside callers of the callbacks. A near-workspaces sandbox suite would cover them. It is not here because it needs the `wasm32-unknown-unknown` target, `cargo-near`, and a downloaded `near-sandbox` binary, none of which this host has offline. The review sandbox never installs them either (AGENTS.md).

## Money

`locked` holds `Pending` and `Running` deposits; `earned` holds `Done` deposits. The contract keeps `balance ≥ storage stake + locked`, and `withdraw` cannot go below that (`get_withdrawable`). Refund and withdraw transfers have callbacks that restore state when the transfer fails.

## Binding

`get_attestation_for_account` (the guard's view) returns an attestation only when the `deployed` account paid the request itself or later called `confirm_binding`. This stops third parties from binding a report to an account they do not control. It does not prove that the deployed code was built from the reviewed commit. See INTERFACE.md, "Deployed-account binding".

## Reports

`report_address` (operator) records an owner-approved abuse report: `{account_id, reported_at_ms, evidence_uri, reason, reporter}`. `is_reported` is the guard's blocklist view; `get_report`, `get_reports` and `get_report_count` list the evidence. Only the owner can `retract_report`. Report storage comes out of the free balance under the same reserve rule as everything else, so it lowers `get_withdrawable` and can never use `locked` deposits. See INTERFACE.md, "Changes since v0.2.0".

## Key limits

- The **operator** account (`operator.<owner>`) holds a function-call key for `review-registry.<owner>` limited to `mark_running`, `attest`, `refund` and `report_address`, with a 1 NEAR gas allowance. That key cannot transfer NEAR, add or delete keys, deploy code, or call `withdraw`, `retract_report`, the admin methods, or any other contract. A leaked key can still file false reports, each of which blocks an account in the guard and takes storage from the free balance (never from `locked`). The owner retracts them with `retract_report`, rotates the operator with `set_operator`, and deletes the key. When the allowance runs out, the owner adds a new key. The API signs only with this key. The operator account's own full-access key stays in the owner's keychain.
- The **owner** account signs `withdraw`, `set_*` and `propose_owner`. Rotation is two-step: `propose_owner(new)` and then `accept_owner()` from the new account.
- The **contract** account keeps the full-access key that `create-account` generated. Whoever holds it can redeploy arbitrary code, which would also change the registry the guard trusts. It is the only upgrade path, so the owner keeps it offline. Deleting it (`near account delete-keys`) makes the contract immutable.
- The treasury only receives transfers. It defaults to the owner account.

## Deploy

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run   # prints the six commands, touches nothing
bash contracts/review-registry/scripts/deploy-testnet.sh --execute   # the owner runs them (near-cli-rs + cargo-near)
```

The commands build the wasm, create `review-registry.<owner>` and `operator.<owner>` funded by the owner, deploy with `new(owner, operator.<owner>, treasury, 1 NEAR)`, add the operator function-call key, and read `get_price`. New keys go to the near-cli keychain. The operator key goes to the legacy keychain (`~/.near-credentials/testnet/`) so the owner can move it into the host env file. No command prints a secret key. `OWNER`, `CONTRACT`, `OPERATOR`, `TREASURY`, `PRICE_YOCTO` and `OPERATOR_ALLOWANCE` override the defaults. A unit test checks that the key lands on the operator named in `new`, and that the key's method list equals `OPERATOR_METHODS`.

Subcommands and flags were checked against the near-cli-rs 0.30.0 source from crates.io. `near` itself is not installed on this host, so the commands have not been run.

Explorer: `https://testnet.nearblocks.io/address/review-registry.<owner>.testnet` once deployed.
