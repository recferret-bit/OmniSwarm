# W15 — Local NEAR: owner check

Wave file: [`../waves/W15-local-near.md`](../waves/W15-local-near.md). Decisions: [`../../spec/LOCAL_NEAR.md`](../../spec/LOCAL_NEAR.md).

The first run downloads the nearcore 2.14.0 `near-sandbox` binary into `infra/compose/.local/near/bin/` (or uses `NEAR_SANDBOX_BIN_PATH`). Later runs are offline. Nothing under that directory is committed.

## Steps

**1. Wave check.**

```sh
npm run check:w15
```

This starts the sandbox on `127.0.0.1:3030`, seeds `registry.test.near`, starts the indexer on `3031`, and runs the parity test, the headless flow, the snapshot attack demo, and `run.mjs --sandbox`. It stops the node on the way out. When `DATABASE_URL` is unset, the check starts a throwaway Postgres on `127.0.0.1` and removes it afterwards. The clean fixture's NearBlocks stub timestamp is 40 days old, so `good-dex` can be `allow`.

Expect every parity row `same`. The headless flow prints tx hashes and a report-hash match. `good-dex.test.near` is `allow` with `ATTESTED_CLEAN` because the NearBlocks stub records it as 40 days old. `ACCOUNT_TOO_NEW` is the verdict only when that timestamp is under 30 days. `drained-vault` is `block`. `phish` is `block` with `REPORTED`. The sandbox attack demo prints `refused_before_signing` and signer calls 0.

**2. Browser stack.**

```sh
npm run stack:local
```

Open `http://omniswarm.localhost:18480/`. Connect lists `alice.test.near`. Quote, sign, and pay a review. `/r/<id>` shows match. The tx link opens `http://127.0.0.1:3031/txns/<hash>`.

`NEAR_LOCAL=0 npm run stack:local` keeps the mock chain. `npm run stack:local:down` stops the sandbox and keeps its home.

**3. Ops.**

```sh
npm run near:local -- call withdraw
npm run near:local -- view registry get_config
```

`npm run check:infra` stays on the mock stack because `dev.env.example` sets `NEAR_LOCAL=0`.

## Not in this tag

Testnet deploy, NearBlocks verification, and a hosted demo are lane O in [`FINAL_SPRINT.md`](../FINAL_SPRINT.md). The browser file `tests/e2e/landing/near-local.test.mjs` is not part of `npm run test:e2e`. Run it with `node --test tests/e2e/landing/near-local.test.mjs` while the stack is up.
