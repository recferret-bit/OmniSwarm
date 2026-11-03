# review-registry interface (v0.2.0)

JSON arguments and results as the API (`apps/api`) and the guard see them over RPC. `U128` is a decimal string of yoctoNEAR. Account ids are NEAR account id strings. A panic aborts the call, so no state changes and any attached deposit goes back to the caller.

## Types

```jsonc
// Status
"Pending" | "Running" | "Done" | "Refunded"

// Request
{ "account": "alice.testnet", "deposit": "1000000000000000000000000", "block_height": 10, "status": "Pending" }

// Attestation
{
  "request_hash": "<64 lower hex>", "repo": "owner/name", "commit": "<40 lower hex>",
  "report_sha256": "<64 lower hex>", "report_uri": "https://…",
  "deployed": "dex.testnet" | null, "code_hash": "<base58, 32-44 chars>" | null,
  "max_severity": "critical|high|medium|low|info|none", "block_height": 10,
  "binding_confirmed": true
}

// Config
{ "owner": "…", "pending_owner": "…" | null, "operator": "…", "treasury": "…",
  "price": "<U128>", "earned": "<U128>", "locked": "<U128>" }
```

## Change methods

| Method | Args | Returns | Access | Events | Errors |
|---|---|---|---|---|---|
| `new` | `{owner, operator, treasury, price_yocto}` | – | init, once (`#[init]` rejects a second call) | – | – |
| `request_review` | `{request_hash}` | – | anyone, **payable** | `review_requested` | `ERR_HASH_FORMAT`, `ERR_HASH_USED`, `ERR_DEPOSIT_LOW`, `ERR_STORAGE_COST`, `ERR_RESERVE` |
| `mark_running` | `{request_hash}` | – | operator | `review_running` | `ERR_NOT_OPERATOR`, `ERR_NOT_FOUND`, `ERR_BAD_STATUS` |
| `attest` | `{request_hash, repo, commit, report_sha256, report_uri, deployed, code_hash, max_severity}` | – | operator | `review_attested` (the full Attestation) | `ERR_NOT_OPERATOR`, `ERR_REPO_FORMAT`, `ERR_COMMIT_FORMAT`, `ERR_REPORT_SHA256`, `ERR_REPORT_URI`, `ERR_DEPLOYED_PAIR`, `ERR_CODE_HASH`, `ERR_SEVERITY`, `ERR_NOT_FOUND`, `ERR_BAD_STATUS` |
| `confirm_binding` **(new)** | `{request_hash}` | – | the attestation's `deployed` account | `binding_confirmed` | `ERR_HASH_FORMAT`, `ERR_NOT_FOUND`, `ERR_NO_DEPLOYED`, `ERR_NOT_DEPLOYED_ACCOUNT`, `ERR_ALREADY_CONFIRMED` |
| `refund` | `{request_hash}` | `bool` (true when the transfer landed) | operator or owner | `review_refunded`; `refund_failed` if the transfer fails | `ERR_NOT_OPERATOR`, `ERR_NOT_FOUND`, `ERR_BAD_STATUS` |
| `withdraw` | `{amount}` | `bool` (true when the transfer landed) | owner | `withdrawn`; `withdraw_failed` if the transfer fails | `ERR_NOT_OWNER`, `ERR_ZERO_AMOUNT`, `ERR_INSUFFICIENT_EARNED`, `ERR_RESERVE` |
| `set_price` | `{price_yocto}` | – | owner | `price_set` | `ERR_NOT_OWNER` |
| `set_operator` | `{operator}` | – | owner | `operator_set` | `ERR_NOT_OWNER` |
| `set_treasury` **(new)** | `{treasury}` | – | owner | `treasury_set` | `ERR_NOT_OWNER` |
| `propose_owner` **(new)** | `{new_owner}` | – | owner; proposing the current owner cancels | `owner_proposed` | `ERR_NOT_OWNER` |
| `accept_owner` **(new)** | `{}` | – | the proposed owner | `owner_accepted` | `ERR_NOT_PENDING_OWNER` |
| `on_refund_done`, `on_withdraw_done` **(new)** | internal | `bool` | `#[private]`: the contract itself | see above | – |

## Views

| Method | Args | Returns |
|---|---|---|
| `get_price` | `{}` | `U128` |
| `get_request` | `{request_hash}` | `Request \| null` |
| `get_attestation` | `{request_hash}` | `Attestation \| null`, confirmed or not |
| `get_attestation_for_account` | `{account}` | latest `Attestation` whose binding is confirmed, else `null` |
| `get_attestations_for_repo` | `{repo, from_index?, limit?}` | `Attestation[]`, oldest first; `from_index` defaults to 0, `limit` to 20, capped at 50 |
| `get_repo_attestation_count` **(new)** | `{repo}` | `u32` |
| `get_earned` | `{}` | `U128` |
| `get_withdrawable` **(new)** | `{}` | `U128`: `min(earned, balance − storage stake − locked)` |
| `get_config` **(new)** | `{}` | `Config` |

## Events

Every log is `EVENT_JSON:{"standard":"omniswarm","version":"1.1.0","event":<name>,"data":[<one object>]}`.

| Event | `data[0]` |
|---|---|
| `review_requested`, `review_running`, `review_refunded`, `refund_failed` | `{request_hash, account, deposit, status}`. For `review_refunded` and `refund_failed`, `status` is the status before the refund, which `refund_failed` restores |
| `review_attested` | the full Attestation |
| `binding_confirmed` | `{request_hash, deployed, repo, commit, code_hash}` |
| `withdrawn`, `withdraw_failed` | `{treasury, amount}` |
| `price_set`, `operator_set`, `treasury_set`, `owner_proposed`, `owner_accepted` | `{by, old, new}` as strings (`owner_proposed.new` is `""` on cancel) |

## Money rules

- `locked` is the sum of `Pending` and `Running` deposits. `earned` is the sum of `Done` deposits not yet withdrawn.
- Invariant: `account_balance ≥ storage_usage × storage_byte_cost + locked`. `request_review` and `attest` assert it (`ERR_RESERVE`). `withdraw` never takes more than `get_withdrawable`, so earned funds cannot drain the storage stake or pending deposits.
- `request_review` measures the storage its record adds and requires the deposit to cover it (`ERR_STORAGE_COST`, INTAKE §6 "price ≥ storage cost"). A deposit equal to the price is enough while the price covers storage (1 NEAR covers about 100 KB).
- `refund` and `withdraw` deduct first, then transfer with a callback. If the transfer fails (for example the requester deleted their account), the callback restores the request's previous status and `locked`, or `earned`, and emits `refund_failed` / `withdraw_failed`. The operator can then retry.
- Refunded requests stay as records, so their hash stays used. The contract's free balance (initial funding plus earned funds not withdrawn) carries their storage.

## Deployed-account binding

`deployed` is an account the requester says runs the reviewed code. The contract does not trust that claim on its own:

- `binding_confirmed` is true when the request was paid by the `deployed` account itself, or after the `deployed` account calls `confirm_binding(request_hash)`. Confirmation is possible only after `attest`.
- `get_attestation_for_account` returns only confirmed attestations: it is the view the guard uses. When a newer and an older attestation are both confirmed, the one with the higher `block_height` wins.
- `get_attestation` and `get_attestations_for_repo` still return unconfirmed attestations, with the flag, for display.

What it proves: whoever controls `deployed` agreed that this review describes it. It blocks a third party from binding a clean report to someone else's contract, or a critical report to a competitor's.

What it does not prove: that the code at `deployed` was built from `repo@commit`. An attacker who controls a malicious contract can still request a review of a benign repo and confirm the binding. Two things limit this today: `code_hash` is read by the operator at attest time, so any later redeploy shows as drift; and the guard treats the attestation as a claim by the account owner. The full fix is build provenance: the host builds `repo@commit` with `cargo near build reproducible-wasm` (host only, never in the review sandbox), and the operator attests only when the sha256 of the result equals the live `code_hash`. That needs an API-side change and is not in this contract version.

A contract account with no access keys and no code path to `confirm_binding` cannot confirm. It can bind only by being the requester, which also needs a code path.

## Changes since v0.1.0 (for the API team)

1. `near-sdk` 5.5.0 → 5.30.0, `store` collections, storage prefixes in a `BorshStorageKey` enum. This is a new state layout. v0.1.0 was never deployed, so there is no migration.
2. `Attestation.binding_confirmed: bool` added. `get_attestation_for_account` now returns only confirmed bindings.
3. `attest` validates every argument (errors above). `deployed` and `code_hash` must be both present or both null.
4. `refund` and `withdraw` now return a promise that resolves to `bool`. With `wait_until: FINAL` the tx outcome's final value is that `bool`.
5. `get_attestations_for_repo` takes optional `from_index` and `limit`. `{repo}` alone still works, but returns at most 20 entries.
6. New methods: `confirm_binding`, `set_treasury`, `propose_owner`, `accept_owner`, `get_withdrawable`, `get_repo_attestation_count`, `get_config`, and the two private callbacks.
7. Events: version `1.1.0`. Added `review_running`, `binding_confirmed`, `refund_failed`, `withdrawn`, `withdraw_failed` and admin events. `review_attested` carries the full attestation. `review_requested` and `review_refunded` add `status`.
8. New error codes: `ERR_STORAGE_COST`, `ERR_RESERVE`, `ERR_ZERO_AMOUNT`, `ERR_NOT_PENDING_OWNER`, the attest validation codes, and the `confirm_binding` codes. `ERR_ALREADY_INIT` is gone (`#[init]` enforces single init).
9. The operator function-call key covers exactly `mark_running`, `attest` and `refund` (`OPERATOR_METHODS`). `report_address`, `is_reported` and `reviewer_attest` (INTAKE §6) do not exist yet.
