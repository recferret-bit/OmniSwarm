# near:local

Local `near-sandbox` (nearcore **2.14.0**) for the OmniSwarm stack. The chain id is `sandbox`. That is not testnet, and production config refuses it.

`up` does not run `rustc` or `cargo`. It only starts the cached binary.

## Commands

```sh
npm run near:local -- up
npm run near:local -- down
npm run near:local -- status
npm run near:local -- reset
```

| Command | What it does |
|---|---|
| `up` | Use the cached binary (or download it once), `init --fast --chain-id sandbox` when `home` has no `genesis.json`, start the node, wait until `/status` reports `chain_id` `sandbox` |
| `down` | Stop the process and wait until the ports close. `home` is kept |
| `status` | Print whether the node is up and the chain id |
| `reset` | `down`, then delete `home`. The cached binary stays |
| `seed` | `exec node infra/near-local/seed.mjs` with the remaining args, or `near:local seed: reserved` |
| `view`, `call` | `exec node infra/near-local/ops.mjs` with the verb first (`view` or `call`) and the remaining args, or `near:local <verb>: reserved` |
| `redeploy` | `exec node infra/near-local/redeploy.mjs` with the remaining args, or `near:local redeploy: reserved` |

A second `up` while that pid is alive does not download and does not start another process.

## Binary

Platforms and the archive layout (`<platform>/near-sandbox`):

| uname | Platform in the URL |
|---|---|
| Darwin arm64 | `Darwin-arm64` |
| Linux x86_64 | `Linux-x86_64` |
| Linux aarch64 | `Linux-aarch64` |

```text
https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/<platform>/2.14.0/near-sandbox.tar.gz
```

The executable is cached at `infra/compose/.local/near/bin/near-sandbox`. If that file exists, `up` does not download. `NEAR_SANDBOX_BIN_PATH`, when set to an executable file, is used instead and nothing is downloaded.

## Ports and files

RPC listens on `0.0.0.0:3030` (`--rpc-addr`). Host tools use `http://127.0.0.1:3030`. Containers use `http://host.docker.internal:3030`. A `127.0.0.1` RPC bind is unreachable from a container on Linux (`docs/spec/LOCAL_NEAR.md`). P2P listens on `127.0.0.1:24567` (`--network-addr`).

| Path | What |
|---|---|
| `infra/compose/.local/near/home/` | `init` output (`genesis.json`, `config.json`, `node_key.json`, `validator_key.json`) |
| `infra/compose/.local/near/near-sandbox.pid` | pid of the running node |
| `infra/compose/.local/near/near-sandbox.log` | node log |

`infra/compose/.local/near/` is gitignored. Do not commit the binary, the home directory, or `validator_key.json`.
