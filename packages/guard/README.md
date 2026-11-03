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

`createRecordedReader(records)` from `@omniswarm/guard/recorded-reader` is a reader over recorded answers, for tests and the API's mock-chain mode.

### ChainReader port

| Method | Source | Returns |
|---|---|---|
| `getAccount(id)` | RPC `view_account` | `{codeHash}` or `null` when the account does not exist |
| `getAttestationForAccount(id)` | registry view `get_attestation_for_account` (finality `final`) | contract attestation or `null` |
| `isReported(id)` | shared blocklist (registry `is_reported` once it exists, or the API's approved reports) | `boolean` |
| `getAccountAgeDays(id)` | indexer first-seen block (FastNEAR) | days |
| `getBlockTimestampMs(height)` | RPC `block` by height (archival for old heights) | ms. Only called when the attestation lacks `block_timestamp_ms` (registry v0.2 records it) |

Any method may reject. That signal is then `null`, its name is listed in `signals.unavailable`, and the reasons include `SIGNAL_UNAVAILABLE`. An unavailable signal never yields `allow`.

## Rules (INTAKE §7)

| Reason | Level | When |
|---|---|---|
| `REPORTED` | block | on the shared blocklist or the guard's local `blocklist` |
| `ATTESTED_CRITICAL_STILL_DEPLOYED` | block | confirmed attestation with `critical`/`high` and the live code hash equals the attested one |
| `CODE_CHANGED_SINCE_REVIEW` | warn | live code hash differs from the attested one (both are in `signals`) |
| `CONTRACT_NOT_REVIEWED` | warn | a contract with no confirmed attestation, including an attestation whose `binding_confirmed` is false |
| `ATTESTATION_STALE` | warn | attestation older than `maxAttestAgeDays` (default 180) |
| `ACCOUNT_TOO_NEW` | warn | younger than `minAgeDays` (default 30), or the account does not exist |
| `SIGNAL_UNAVAILABLE` | warn | any reader call failed |
| `ATTESTED_CLEAN` | allow | confirmed attestation below `high`, code unchanged |
| `NOT_A_CONTRACT` | allow | plain account (empty code hash) |

The verdict is the worst level among the reasons. An empty reason list is `warn`.

## What the wrapper checks

- Every account a transaction pays: the `receiverId`, and account ids in function-call arguments named `receiver_id`, `receiver`, `beneficiary_id` or `to` (`ft_transfer`, payout contracts). The names can be changed with `beneficiaryArgs`. The signer account is never what gets checked.
- All lookups are awaited, for every transaction in `signAndSendTransactions`, before the signer is called.
- `onWarn` must resolve to exactly `true`. Any other value, a missing `onWarn`, or a thrown lookup (which becomes `warn` with `SIGNAL_UNAVAILABLE`) declines.
- Intercepted methods: `signAndSendTransaction`, `signAndSendTransactions`, `transfer`, `callFunction`, `functionCall`. The wrapper exposes only those the signer has. Everything else, such as `signTransaction` or `signMessage`, is not exposed, so it cannot bypass the check.

## What the guard does not catch

- **Build provenance.** A confirmed binding proves that the `deployed` account agreed to the attestation. It does not prove that its code was built from the reviewed commit. A malicious owner can get a clean review of a benign repo and confirm it for a malicious contract. See `contracts/review-registry/INTERFACE.md`, "Deployed-account binding".
- Payees hidden anywhere other than the listed argument names, for example nested objects, or a contract that forwards funds elsewhere internally.
- Mutation of `params` by other code between the check and the signer call. Pass an object nothing else holds.
- Signers reached outside the wrapper. The agent must hold only the wrapped object.

## Key limits

The guard holds no key and signs nothing. An agent should hold a function-call key: limited to one contract and its methods, with a gas allowance, unable to transfer NEAR or add keys. The guard covers what that key still allows, such as a payout method that pays any `receiver`. See `demo/attack/README.md`.

## Changes for the API (from 0.0.0)

`verdictFor` and `DEMO_ACCOUNTS` (a static demo table) are gone from the main export. Use `createGuard({ reader }).check(account)` as above. The verdict no longer has `account`, and it now has `signals`, as the schema requires. `wrap(signer, {onWarn, lookup}).sign(action)` is replaced by `guard.wrap(signer, {onWarn})` with the real signer methods.
