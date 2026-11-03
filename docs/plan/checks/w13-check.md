# W13 — Agent Guard: owner check

Wave file: [`../waves/W13-agent-guard.md`](../waves/W13-agent-guard.md). About 3 minutes. No `OMNI_LIVE` and no testnet.

**Scope of the `wave-13` tag: an offline slice.** It covers the `@omniswarm/guard` engine and wrapper, a recorded mock-chain reader, and the attack demo. These plan gates are not in it: the API's chain signal collectors and FastNEAR age source (W13-02, -03), caching and rate limits on `GET /api/guard/verdict` (W13-06), the contract blocklist `report_address`/`is_reported` (W13-07), `POST /api/guard/reports` (W13-08), testnet fixture accounts (W13-10), the prior-interaction signal (W13-11), a testnet FC-key agent and `demo-payments` contract (W13-12), the committed testnet log with explorer URLs (W13-14), and `tests/e2e/intake/w13.spec.ts` (W13-16).

## Steps

**1. Guard tests and types.**

```sh
npm test -w @omniswarm/guard
npm run typecheck -w @omniswarm/guard
```

62 tests pass and `tsc` (checkJs, strict) is clean. Covered:

- A 16-row engine table: block > warn > allow, every reason code; no combination with an unavailable signal is `allow`; thresholds come from the policy.
- `check()` for 13 recorded accounts. Freshness uses the attested `block_timestamp_ms` and falls back to a block lookup for older records. Each response validates against `intake-api#guard-verdict-response`, with no extra fields and `signals` present. The attestation is in `attestation.schema.json` shape. Drift reports both hashes. An attestation with `binding_confirmed: false` is ignored. Each reader outage gives `warn` with `SIGNAL_UNAVAILABLE`. The blocklist still blocks during an outage. The local blocklist works. Invalid ids are rejected. `httpSource` sends account, network and `x-guard-key` and rejects bad answers.
- Wrapper: the receiver is checked, not the signer; an async `block` is awaited and the signer spy stays at 0; `onWarn` must return exactly `true` (false, undefined, 1, `'yes'` and `{}` all decline; `true` reaches the signer once); a throwing lookup goes to `onWarn`; every transaction in a batch is checked before any is signed; a payee in `ft_transfer.receiver_id` or `pay_out.receiver` (including near-api-js byte args) is checked; only intercepted methods are exposed.
- Demo: the agent extracts the injected line; guard on gives `refused_before_signing`; `--no-guard` builds the same transaction and logs `would_send`; a benign ticket reaches the dry signer once; the committed example logs match the current output.

**2. Attack demo.**

```sh
node packages/guard/demo/attack/run.mjs
node packages/guard/demo/attack/run.mjs --no-guard
```

The first prints the injected instruction, the `pay_out` transaction on `demo-payments.owner.testnet` paying `attacker.testnet`, the verdict (`block`: `attacker.testnet` is the beneficiary with `REPORTED`), and `refused_before_signing (GUARD_BLOCK)`, with 0 signer calls. The second logs `would_send` for the same transaction and calls no signer. Logs go to `<tmpdir>/omniswarm-guard-demo/<mode>/`. Committed copies are in `packages/guard/demo/attack/examples/`.

The chain is a mock snapshot (`demo/attack/fixtures/chain-snapshot.json`), not testnet.

## Automated checks

`npm run check:w13` is the guard tests plus both demo runs. All green on the host. The review sandbox image is unchanged.
