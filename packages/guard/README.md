# @omniswarm/guard

Allow / warn / block for a NEAR transaction before it is signed. The guard reads chain evidence through an injected reader: review attestations from the registry, the live code hash, a shared blocklist, account age and attestation age. It wraps any signer: **block** throws before signing, **warn** asks a human and continues only on an explicit `true`.

Plain ESM with JSDoc, types in `index.d.mts` / `types.d.ts`. `npm test -w @omniswarm/guard`, `npm run typecheck -w @omniswarm/guard`.

## Main export (the API codes against this)

```js
import { createGuard, GuardBlockedError, GuardWarnDeclinedError, isAccountId } from '@omniswarm/guard';

const guard = createGuard({ reader });          // reader: ChainReader (below)
// or createGuard({ source: httpSource({ apiUrl, network: 'testnet', apiKey }) }) for agents that ask the API

await guard.check('dex.testnet');
// → { verdict: 'allow'|'warn'|'block', reasons: string[], signals: {...}, attestation?: {...} }
//   matches intake-api.schema.json#/$defs/guard-verdict-response; TypeError on an invalid account id

await guard.checkIntent({ signerId, receiverId, actions });   // → { verdict, reasons, targets: [...] }

const signer = guard.wrap(wallet, { onWarn: async (verdict) => askHuman(verdict) === 'y' });
await signer.signAndSendTransaction({ receiverId, actions });
```

`GET /api/guard/verdict` should be `guard.check(account)` with the API's chain adapter as the reader:

```ts
const guard = createGuard({ reader: chainReader, policy: { minAgeDays: env.MIN_AGE_DAYS, maxAttestAgeDays: env.MAX_ATTEST_AGE_DAYS } });
app.get('/api/guard/verdict', async (request) => {
  const account = (request.query as { account?: string }).account ?? '';
  if (!isAccountId(account)) fail(400, 'VALIDATION_ERROR', 'account must be a NEAR account id');
  return guard.check(account);
});
```

`createRecordedReader(records)` and `createRecordedAgeSource(createdAtMs)` from `@omniswarm/guard/recorded-reader` answer from recorded data, for tests and the API's mock-chain mode. `records.reports` (account → registry Report) counts as reported and feeds `getReport`.

### ChainReader port

`createGuard({ reader })` is unchanged. The two optional methods are new; a reader without them still type-checks and works.

| Method | Source | Returns |
|---|---|---|
| `getAccount(id)` | RPC `view_account` | `{codeHash}` or `null` when the account does not exist |
| `getAttestationForAccount(id)` | registry view `get_attestation_for_account {account}` (finality `final`) | contract attestation or `null` |
| `isReported(id)` | registry view `is_reported {account_id}` (contract v0.3, the shared blocklist) | `boolean`. Any other value counts as unavailable, not as `false` |
| `getReport(id)` **optional** | registry view `get_report {account_id}` | registry Report or `null`. Asked only for a reported account; the evidence goes to `signals.report` |
| `getAccountAgeDays(id)` **optional** | older form of the age signal | days. `accountAge` (below) wins when both are given |
| `getBlockTimestampMs(height)` | RPC `block` by height (archival for old heights) | ms. Only called when the attestation lacks `block_timestamp_ms` (registry v0.2 records it) |

Any method may reject. That signal is then `null`, its name is listed in `signals.unavailable`, and the reasons include `SIGNAL_UNAVAILABLE`. An unavailable signal never yields `allow`. A missing optional method is not an error: without `getReport` the verdict still blocks, just without `signals.report` (`{evidenceUri, reason, reportedAtMs, reporter}`).

`registryReader(view)` builds the three registry methods from one view call, `view(method, args) → parsed JSON` against the registry at finality `final`. It uses the exact v0.3 method and argument names and rejects any answer of the wrong shape:

```ts
import { createGuard, registryReader } from '@omniswarm/guard';
const reader = {
  ...registryReader((method, args) => chain.viewRegistry(method, args)),   // is_reported, get_report, get_attestation_for_account
  getAccount: (id) => chain.viewAccount(id),
  getBlockTimestampMs: (h) => chain.blockTimestampMs(h),
};
```

The API can keep its own `getAttestationForAccount` mapping. Only `isReported` (and optionally `getReport`) has to move from the `async () => false` stub to the registry.

### Account age (optional `AccountAgeSource` port)

Without an indexer the creation time is unknown. Then `accountAge` is in `signals.unavailable`, and an account that would otherwise be allowed gets `warn`. That is the behaviour when nothing is configured.

```ts
interface AccountAgeSource { getCreatedAtMs(accountId: string): Promise<number | null> }   // null = unknown → unavailable
createGuard({ reader, accountAge });
```

The production option is behind a flag in `@omniswarm/guard/account-age`:

```ts
import { accountAgeFromConfig } from '@omniswarm/guard/account-age';
const accountAge = accountAgeFromConfig({ provider: env.GUARD_ACCOUNT_AGE ?? 'off', network: env.NEAR_NETWORK, apiKey: env.NEARBLOCKS_API_KEY });
// 'off' (default) → undefined; 'nearblocks' → GET https://api[-testnet].nearblocks.io/v1/account/{id}
```

The NearBlocks source sends `Authorization: Bearer <apiKey>` when a key is given and times out after 5 s. Non-2xx answers and wrong shapes reject. Known creation times are cached for a day (10 000 entries) to stay under the public rate limit. It reads `account[0].created.block_timestamp` (nanoseconds). That shape comes from the NearBlocks v1 reference. It was **not** checked against the live API from this repository, where tests use a fake `fetch` only, so confirm it once before turning the flag on. The env names above are suggestions for the API's config; the guard reads no environment itself.

## Rules (INTAKE §7)

| Reason | Level | When |
|---|---|---|
| `REPORTED` | block | `isReported` is `true` (registry `is_reported`), or the account is on the guard's local `blocklist` |
| `ATTESTED_CRITICAL_STILL_DEPLOYED` | block | confirmed attestation with `critical`/`high` and the live code hash equals the attested one |
| `CODE_CHANGED_SINCE_REVIEW` | warn | live code hash differs from the attested one (both are in `signals`) |
| `CONTRACT_NOT_REVIEWED` | warn | a contract with no confirmed attestation, including an attestation whose `binding_confirmed` is false |
| `ATTESTATION_STALE` | warn | attestation older than `maxAttestAgeDays` (default 180) |
| `ACCOUNT_TOO_NEW` | warn | younger than `minAgeDays` (default 30), or the account does not exist |
| `SOURCE_METADATA_MISMATCH` | warn | NEP-330 `contract_source_metadata` names a different repo or commit than the attestation. The metadata is self-reported; it does not prove the bytes were rebuilt |
| `SIGNAL_UNAVAILABLE` | warn | any reader or age-source call failed, or no age source is configured |
| `SOURCE_METADATA_ABSENT` | info | the contract has no `contract_source_metadata`. Listed, and it never decides the verdict, so `allow` stays reachable |
| `ATTESTED_CLEAN` | allow | confirmed attestation below `high`, code unchanged |
| `NOT_A_CONTRACT` | allow | plain account (empty code hash) |

The verdict is the worst level among the reasons. An empty reason list is `warn`.

## What the wrapper checks

- Every account a transaction pays: the `receiverId`, and account ids in function-call arguments named `receiver_id`, `receiver`, `beneficiary_id` or `to` (`ft_transfer`, payout contracts). The names can be changed with `beneficiaryArgs`. The signer account is never what gets checked.
- All lookups are awaited, for every transaction in `signAndSendTransactions`, before the signer is called.
- `onWarn` must resolve to exactly `true`. Any other value, a missing `onWarn`, or a thrown lookup (which becomes `warn` with `SIGNAL_UNAVAILABLE`) declines.
- Intercepted methods: `signAndSendTransaction`, `signAndSendTransactions`, `transfer`, `callFunction`, `functionCall`. The wrapper exposes only those the signer has. Everything else, such as `signTransaction` or `signMessage`, is not exposed, so it cannot bypass the check.

## What the guard does not catch

- **Build provenance, beyond the self-reported signal.** `SOURCE_METADATA_MISMATCH` warns when NEP-330 `contract_source_metadata` names a different repo or commit than the attestation, and `SOURCE_METADATA_ABSENT` notes a contract with no such method. That metadata is self-reported by the deployed wasm. It does not prove the bytes were rebuilt from that commit. Proof is a NearBlocks or SourceScan verification, which rebuilds the commit and compares the hash. A malicious owner can still publish metadata for a benign repo. See `contracts/review-registry/INTERFACE.md`, "Deployed-account binding".
- Payees hidden anywhere other than the listed argument names, for example nested objects, or a contract that forwards funds elsewhere internally.
- Mutation of `params` by other code between the check and the signer call. Pass an object nothing else holds.
- Signers reached outside the wrapper. The agent must hold only the wrapped object.

## MCP

The same check is available to an agent over MCP. The server is read-only. It holds no key and it cannot sign.

Demo step 1, against the local stack:

```sh
claude mcp add omniswarm-guard -- node packages/guard/mcp.mjs --api http://omniswarm.localhost:18480
```

Then ask: is it safe to pay drained-vault.test.near?

`guard_verdict` returns `block`, the reasons, and the attestation link. The default network is `sandbox`. Pass `--network testnet` or `--network mainnet` for the other chains.

The other tools are `get_attestation` (`account` or `request_hash`) and `is_reported` (`account`). `request_hash` needs `--rpc` and `--contract`, because that view is not on the public API. Both flags are read-only JSON-RPC. There is no key flag.

Example config for Claude Code is `examples/mcp/claude-code.json`. Example config for Codex is `examples/mcp/codex.toml`. Copy the table into the project's MCP config, with the paths relative to the OmniSwarm checkout.

## Key limits

The guard holds no key and signs nothing. An agent should hold a function-call key: limited to one contract and its methods, with a gas allowance, unable to transfer NEAR or add keys. The guard covers what that key still allows, such as a payout method that pays any `receiver`. See `demo/attack/README.md`.

## Changes for the API (from 0.0.0)

`verdictFor` and `DEMO_ACCOUNTS` (a static demo table) are gone from the main export. Use `createGuard({ reader }).check(account)` as above. The verdict no longer has `account`, and it now has `signals`, as the schema requires. `wrap(signer, {onWarn, lookup}).sign(action)` is replaced by `guard.wrap(signer, {onWarn})` with the real signer methods.

## Changes for the API (registry v0.3)

- `ChainReader.isReported` should call the registry view `is_reported {account_id}` instead of returning `false`. `registryReader(view)` does that and checks the answer.
- New optional `ChainReader.getReport`: a reported verdict then carries `signals.report` with the evidence link.
- `ChainReader.getAccountAgeDays` is now optional. New `createGuard({ accountAge })` option and `@omniswarm/guard/account-age` (`accountAgeFromConfig`, flag `off` by default).
- New export `registryReader`. `createRecordedReader` also takes `records.reports`, and `createRecordedAgeSource` is new.
