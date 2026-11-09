# Local NEAR

> **Status:** W15-00 decisions, 2026-11-09. Later issues in [W15](../plan/waves/W15-local-near.md) implement these. The spike ran on darwin-arm64 (Docker Desktop 29.4.3, server linux/arm64).

The local stack runs the real `review-registry` wasm on a `near-sandbox` node. Network value `sandbox` is not testnet. Production config refuses it.

## Decisions

Each answer names the command that proved it.

### Binary

Pin **nearcore 2.14.0**, the `DEFAULT_NEAR_SANDBOX_VERSION` in the `near-sandbox` 0.4.0 crate locked by `contracts/review-registry/Cargo.lock`.

| Platform | Result |
|---|---|
| darwin-arm64 | Runs. `near-sandbox --version` prints `neard (release 2.14.0)`. |
| linux-x86_64 | Runs. Needs glibc ≥ 2.39 (Debian 13). Debian 12 fails with `GLIBC_2.39 not found`. |
| linux-aarch64 | Runs. Same 2.14.0 string, on the Docker Desktop Linux VM. |

darwin-arm64:

```sh
curl -fsSL -o /tmp/near-sandbox-darwin-2.14.0.tar.gz \
  https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/2.14.0/near-sandbox.tar.gz
tar -xzf /tmp/near-sandbox-darwin-2.14.0.tar.gz -C /tmp
file /tmp/Darwin-arm64/near-sandbox
# Mach-O 64-bit executable arm64
/tmp/Darwin-arm64/near-sandbox --version
```

linux-x86_64 (the tarball is an ELF; qemu on Debian 13 runs it):

```sh
curl -fsSL -o /tmp/near-sandbox-Linux-x86_64-2.14.0.tar.gz \
  https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz
# file: ELF 64-bit LSB pie executable, x86-64, interpreter /lib64/ld-linux-x86-64.so.2
docker run --rm --platform linux/amd64 \
  -v /tmp/near-sandbox-Linux-x86_64/Linux-x86_64/near-sandbox:/near-sandbox:ro \
  --entrypoint /near-sandbox debian:trixie-slim --version
```

`debian:bookworm-slim` (glibc 2.36) exits with `GLIBC_2.38` and `GLIBC_2.39` not found. The runner executes the binary on the host, not inside the API image.

### Download and cache

URL, the same one `near-sandbox` 0.4.0 builds in `bin_url`:

```text
https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/<platform>/<version>/near-sandbox.tar.gz
```

`<platform>` is `Darwin-arm64`, `Linux-x86_64`, or `Linux-aarch64`. The archive contains `<platform>/near-sandbox`. This is the nearcore S3 artifact, not the `near-sandbox` npm package.

Cache the executable at `infra/compose/.local/near/bin/near-sandbox`. That directory is gitignored. A second `up` must not download when the file is already there.

`NEAR_SANDBOX_BIN_PATH` wins and skips the download. The crate does the same: `check_for_version` returns that path and does not fetch.

HEAD of all three URLs returned `200` on 2026-11-09 (darwin 29413035 bytes, linux-x86_64 35582480, linux-aarch64 33663543).

### Chain id and validator key

`init` without `--chain-id` creates a random chain id (`near-sandbox init --help`). The runner always passes `--chain-id sandbox`.

```sh
near-sandbox --home "$HOME" init --fast --chain-id sandbox
# genesis.json chain_id == "sandbox"
near-sandbox --home "$HOME" run --rpc-addr 0.0.0.0:3030 --network-addr 127.0.0.1:24567
curl -sf http://127.0.0.1:3030/status
# {"chain_id":"sandbox","version":{"version":"2.14.0",...}}
```

Home for the stack is `infra/compose/.local/near/home/` (gitignored). `init` writes `genesis.json`, `config.json`, `node_key.json`, and `validator_key.json` there.

`validator_key.json` fields are `account_id`, `public_key`, and `secret_key`. After `init`, `account_id` is `test.near`. That account is the funded genesis validator. Seed reads the secret from this file at runtime and creates the subaccounts below. The secret is not committed and is not copied into this document.

### Container reach and bind address

RPC listens on **`0.0.0.0:3030`**. P2P listens on **`127.0.0.1`**. Host tools use `http://127.0.0.1:3030`, which still connects when the socket is `0.0.0.0`. Containers use `http://host.docker.internal:3030`. Compose adds `extra_hosts: ["host.docker.internal:host-gateway"]` so a Linux host resolves that name to the bridge gateway.

A `127.0.0.1` RPC bind is unreachable from a container on Linux. Measured on the Docker Desktop Linux VM (bridge gateway `172.17.0.1`):

```sh
# sandbox in the VM host namespace, --rpc-addr 0.0.0.0:13030
docker run --rm curlimages/curl:8.10.1 -fsS http://172.17.0.1:13030/status
# chain_id sandbox

# same node restarted with --rpc-addr 127.0.0.1:13030
docker run --rm curlimages/curl:8.10.1 -fsS http://172.17.0.1:13030/status
# curl exit 7, connection refused
```

On macOS Docker Desktop, a node bound on the Mac at either `0.0.0.0:3030` or `127.0.0.1:3030` answered:

```sh
docker run --rm curlimages/curl:8.10.1 -fsS http://host.docker.internal:3030/status
```

`0.0.0.0` is the bind that works on both. `init` already writes `rpc.addr` `0.0.0.0:3030`; the runner passes `--rpc-addr 0.0.0.0:3030` so a later flag cannot silently move it back to loopback.

### CORS

The sandbox sends `access-control-allow-origin: *` for `Origin: http://omniswarm.localhost:18480`. An OPTIONS preflight also returns `access-control-allow-methods: *` and `access-control-allow-headers: *`. `init` writes `rpc.cors_allowed_origins: ["*"]` in `config.json`.

```sh
curl -sD - -o /dev/null -H 'Origin: http://omniswarm.localhost:18480' http://127.0.0.1:3030/status
curl -sD - -o /dev/null -X OPTIONS \
  -H 'Origin: http://omniswarm.localhost:18480' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  http://127.0.0.1:3030/
```

The indexer does **not** proxy RPC. The browser calls `http://127.0.0.1:3030` directly. The indexer on `127.0.0.1:3031` still serves the NearBlocks-shaped account route, `/txns/<hash>`, `/address/<id>`, and `/wallet/accounts` (loopback only).

### Wasm without Rust

`near:local up` does not run `rustc` or `cargo`. It uses the cached `near-sandbox` binary and the committed `contracts/review-registry/res/review_registry.wasm`. This spike started the node and read `/status` without building a wasm. `build-wasm.sh` is the only step that needs Rust, and it runs on a builder machine before the wasm is committed. A checkout that already has `res/*.wasm` and `res/*.sha256` runs the local flow with no Rust toolchain.

## Values later issues use

| Item | Value |
|---|---|
| Chain id / `network` | `sandbox` |
| RPC, host | `http://127.0.0.1:3030` |
| RPC, containers | `http://host.docker.internal:3030` |
| Indexer, dev wallet, account age, explorer | `http://127.0.0.1:3031` |
| Contract | `registry.test.near` |
| Price | 1 NEAR (`1000000000000000000000000` yocto) |
| Accounts | `owner.test.near`, `operator.test.near`, `treasury.test.near`, `alice.test.near`, `bob.test.near` |
| Guard fixtures | `good-dex.test.near`, `drained-vault.test.near`, `phish.test.near` |
| Operator allowance | function-call key on the registry for `mark_running`, `attest`, `refund`, `report_address`, allowance 1 NEAR |
| Dev key files | `infra/compose/.local/near/keys/<name>.json`, mode `600` |
| `accounts.json` | paths and public ids only, validated by `near-local-accounts.schema.json` |
| CORS allow-origin the indexer sends on its own pages | `http://omniswarm.localhost:18480` |

`NEAR_LOCAL=0` keeps today's mock-chain stack. `npm run stack:local` defaults an unset `NEAR_LOCAL` to 1. `dev.env.example` keeps `NEAR_LOCAL=0` so `npm run check:infra` still brings up the mock stack.

## Coverage

| Touchpoint | Status | Where | Test |
|---|---|---|---|
| Wallet | local | dev wallet lists indexer accounts and signs with ed25519 | `dev-wallet.test.ts`; browser file `tests/e2e/landing/near-local.test.mjs` |
| NEP-413 | local | canonical message, real signature | dev-wallet test; `tests/e2e/near-local/flow.test.mjs` |
| Payment | local | `request_review` for 1 NEAR on `registry.test.near` | headless flow; dashboard sandbox payer |
| Function-call key | local | operator key limited to `mark_running`, `attest`, `refund`, `report_address` | seed; attack demo signer calls 0 |
| Tx finality | local | near adapter waits for FINAL | `near-chain.test.ts`; headless payment |
| Operator calls | local | `mark_running`, `attest`, `refund`, `report_address` | headless flow; `ops.mjs` |
| Blocklist | local | `report_address` / `is_reported` / `retract_report` | seed-guard; parity report/retract |
| Guard signals | local | critical, reported, code drift, account age | `run.mjs --sandbox`. A fresh sandbox account is under 30 days, so `good-dex` is `warn ACCOUNT_TOO_NEW` until `created.json` records an older timestamp. `allow` on testnet is lane O2 |
| Verify | local | RPC `get_attestation`, API fallback labelled "via API, not independent" | `verify.test.ts`; headless hash match |
| Explorer | local-stub | indexer HTML for `/txns` and `/address`, not NearBlocks | `indexer.test.mjs`. Live NearBlocks pages are lane O3 |
| Owner methods | local | `withdraw`, `set_*`, `propose_owner` / `accept_owner`, `refund`, `confirm_binding`, `retract_report` | `ops.mjs` withdraw and refund bounce |
| Events | local | NEP-297 `EVENT_JSON`, including `refund_failed` and `binding_confirmed` | parity table, every row `same` |
| near-connect extension | testnet-only | the dev wallet replaces it on sandbox | lane O2 |
| Testnet finality timing | testnet-only | local finality is the sandbox | lane O2 |
