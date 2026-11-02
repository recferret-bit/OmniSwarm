# review-registry

NEAR contract for a paid, single-use review request. Host tests use `cargo test` on this crate. The review sandbox does not build it and does not install `cargo-near` or `wasm32-unknown-unknown`.

## Methods

| Method | Who | Effect |
|---|---|---|
| `new(owner, operator, treasury, price_yocto)` | deploy | init once |
| `request_review(request_hash)` | anyone, payable | `Pending` when the deposit is at least the price and the hash is unused |
| `mark_running(request_hash)` | operator | `Pending` → `Running` |
| `attest(...)` | operator | `Pending` or `Running` → `Done`; records the report hash |
| `refund(request_hash)` | operator or owner | `Pending` or `Running` → `Refunded`, then transfers the deposit back |
| `withdraw(amount)` | owner | sends earned `Done` deposits to the treasury |
| `get_request`, `get_attestation`, `get_attestation_for_account`, `get_attestations_for_repo`, `get_price` | anyone | views |

`Done` cannot be refunded. A non-operator cannot attest. A non-owner cannot withdraw. Deposits still `Pending` are not earned.

## Events

Logs are `EVENT_JSON:{"standard":"omniswarm","version":"1.0.0","event":"...","data":[...]}`. Events: `review_requested`, `review_attested`, `review_refunded`.

## Key limits

The operator key is a function-call key for `mark_running`, `attest`, `refund`, `report_address`, and `reviewer_attest` on this contract only. It cannot transfer NEAR, add keys, or call `withdraw`. If its gas allowance runs out, the owner adds allowance with a full-access key. `withdraw` stays on the owner's key.

## Deploy

`bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run` prints the `near` commands and does not deploy. The owner runs those commands. Testnet funding and the live adapter stay with the owner.
