# W17: Code provenance (reproducible build, NEP-330, guard source signal)

> **Track:** Chain (C) with Security (S) · **Tag:** `wave-17` · **Check:** `npm run check:w17` = `check:w10` + `test:contract:sandbox` + `npm test -w packages/guard` + `node packages/guard/demo/attack/run.mjs` (snapshot) + `npm run near:local -- verify registry` (when the W15 sandbox is up)
> **Depends on waves:** W10, W13 (landed). Soft: W15. W17-07 and the sandbox half of W17-08 wait for `wave-15`; until then they land as `wave-17.2`.
> **Specs:** [NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md), [reproducible builds](https://docs.near.org/smart-contracts/anatomy/reproducible-builds), [cargo-near](https://github.com/near/cargo-near), README "Binding limit"
> **Owned paths:** `contracts/review-registry/{Cargo.toml,Cargo.lock,README.md,INTERFACE.md,scripts/deploy-testnet.sh}`, `packages/guard/src/{signals,reasons,engine,registry-reader,recorded-reader}.mjs` and the new `packages/guard/src/source-metadata.mjs`, `packages/guard/demo/attack/fixtures/**`, `infra/near-local/verify.mjs`, CI job `contract-sandbox` (lead edits `ci.yml`), `docs/plan/checks/w17-check.md`
> **Hand-off with W15:** `contracts/review-registry/res/**` belongs to W15 until `wave-15`. After that, W17-04 regenerates it reproducibly. `packages/guard/demo/attack/run.mjs` belongs to W15-09 while W15 is open, so W17-08 only adds fixtures and a scenario file.

## Goal

Close the README's own "Binding limit": the attestation says `repo@commit`, but nothing ties that to the deployed bytes. This wave does four things:
- builds and deploys the registry with `cargo near build reproducible-wasm`, which embeds NEP-330 `contract_source_metadata` with the repo link and commit
- lets anyone verify the registry on NearBlocks or SourceScan
- adds a guard signal that reads a counterparty's `contract_source_metadata` and compares it with the attested `repo@commit`
- adds a local `verify` command that rebuilds or loads the wasm and checks its hash against the sandbox `code_hash`

## Demo story

1. `near-local view registry contract_source_metadata` → `{version, link: "https://github.com/recferret-bit/OmniSwarm", build_info: {build_command, source_code_snapshot: "git+…?rev=<sha>", image, image_digest}}`.
2. `npm run near:local -- verify registry` → `code_hash <base58> == sha256(res/review_registry.wasm) → match`. Redeploy the alt wasm, then verify again → `drift` with both hashes.
3. Guard: an attested contract whose metadata commit equals the attested commit → no extra reason. A different commit → `warn` with `SOURCE_METADATA_MISMATCH` and both values. No metadata → the informational reason `SOURCE_METADATA_ABSENT`, which never decides the verdict by itself, so `allow` stays reachable.
4. `node packages/guard/demo/attack/run.mjs --scenario metadata-elsewhere` → `warn` with the human prompt and no signature until it is approved.
5. Owner on testnet: `deploy-testnet.sh --execute` builds reproducibly → NearBlocks "Verify and Publish" shows **Verified** (`checks/w17-check.md`).

## Hackathon slice

- **H:** W17-01..06, W17-09, W17-10.
- **H (soft on W15):** W17-07, and the sandbox half of W17-08.
- **Deferred:** a guard-side Docker rebuild that *proves* the bytes. The metadata stays a self-reported signal; proof comes from NearBlocks/SourceScan verification.

## Wave DoR

- [ ] W17-03 spike answered: does `cargo near build reproducible-wasm` need a clean, pushed tree, and which `image`/`image_digest` does `cargo near new` (cargo-near 0.23.0) emit today?
- [ ] Docker is available on the developer host (the reproducible build runs in Docker), and cargo-near 0.23.0 is installed (`cargo near --version`).
- [ ] The lead has reserved `check:w17` and added the CI job skeleton `contract-sandbox`.
- [ ] Owner decision recorded: the repo goes public on D10 (verification clones the commit).

## Features covered

- [ ] Reason codes and DTO: W17-01
- [ ] near-sdk 5.30.1: W17-02
- [ ] Reproducible build and NEP-330 metadata: W17-03, W17-04
- [ ] Sandbox suite in CI: W17-05
- [ ] Guard source-metadata signal: W17-06
- [ ] Local verify against the sandbox: W17-07
- [ ] Attack demo scenario: W17-08
- [ ] Contract README and INTERFACE: W17-09
- [ ] Wave check, owner guide (testnet redeploy and verification), tag: W17-10

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W17-01 | Lead contract:<br>• guard reason codes `SOURCE_METADATA_MISMATCH` (warn) and `SOURCE_METADATA_ABSENT` (info) in `packages/schemas` guard DTOs and `packages/guard/src/reasons.mjs`<br>• a `signals.sourceMetadata {link, rev, fetchedAt}` shape | contract | S | H | — | `packages/schemas/**` (guard DTO), `packages/guard/src/reasons.mjs` | `npm run test:schemas` → verdict fixtures for both codes validate | INTAKE §7 |
| W17-02 | Bump near-sdk 5.30.0 → **5.30.1** and change nothing else. Leave the manual flush at `lib.rs:138` until after the hackathon | chain | S | H | — | `contracts/review-registry/Cargo.{toml,lock}` | `npm run test:contract` (86) and `npm run test:contract:sandbox` → green | near-sdk #1669 |
| W17-03 | Reproducible build config:<br>• `repository = "https://github.com/recferret-bit/OmniSwarm"`<br>• a `[package.metadata.near.reproducible_build]` block with `image` and `image_digest` from the current `cargo near new` template, `container_build_command`, and `passed_env = []`<br>• record the answer to the clean-tree question in the contract README | chain | S | H | W17-02 | `contracts/review-registry/Cargo.toml`, `contracts/review-registry/README.md` §Build | `cargo near build reproducible-wasm` (on a clean, pushed commit) → the wasm contains `contract_source_metadata` with `link` and `rev` | NEP-330 |
| W17-04 | `deploy-testnet.sh` builds `reproducible-wasm` and copies the result to `res/` with its sha256 (after `wave-15`); `--dry-run` prints the same commands and touches nothing | chain | S | H | W17-03 | `contracts/review-registry/scripts/deploy-testnet.sh`, `res/**` (after `wave-15`) | `bash …/deploy-testnet.sh --dry-run` → the build line says `reproducible-wasm`. `check:w10` → green | — |
| W17-05 | CI job `contract-sandbox`: caches the near-sandbox binary and `target/`, runs `npm run test:contract:sandbox` on linux-x64 | infra | S | H | W17-02 | `.github/workflows/ci.yml` (lead lands the pre-step; the agent fills the job body) | A PR touching `contracts/**` → the job runs green in under 10 minutes on a warm cache | — |
| W17-06 | Guard signal `packages/guard/src/source-metadata.mjs`:<br>• view-calls `contract_source_metadata` on the receiver through the registry reader<br>• parses `build_info.source_code_snapshot` (`git+<url>?rev=<sha>`)<br>• compares with the attested `repo` and `commit`<br>• the engine applies mismatch → `warn`; absent → info only; RPC error → `SIGNAL_UNAVAILABLE`<br>• add fixtures to `recorded-reader` | security | M | H | W17-01 | `packages/guard/src/{source-metadata,signals,engine,registry-reader,recorded-reader}.mjs` and their tests | Table test: match → no reason; mismatch → `warn`; absent with a clean attestation → still `allow`; RPC down → `SIGNAL_UNAVAILABLE`, never `allow` from it alone | — |
| W17-07 | `npm run near:local -- verify <account> [--wasm <path>]`: compute the base58 sha256 of the wasm and compare it with the sandbox `view_account.code_hash` → `match` or `drift` | chain | S | H (soft W15) | W15 (`wave-15`) | `infra/near-local/verify.mjs` | Demo step 2: `match` after seed, `drift` after redeploying the alt wasm | — |
| W17-08 | Attack scenario `metadata-elsewhere`:<br>• snapshot fixture first<br>• the sandbox variant deploys a fixture wasm whose metadata points to another repo (after `wave-15`) | security | S | H | W17-06 | `packages/guard/demo/attack/fixtures/**`, `packages/guard/demo/attack/scenarios/metadata-elsewhere.json` | Demo step 4. The committed example log is updated | — |
| W17-09 | Contract README and INTERFACE:<br>• cargo-near 0.23.0, near-cli-rs 0.31.1<br>• the reproducible build and how to verify on NearBlocks and SourceScan<br>• what NEP-330 proves (self-reported) and what verification proves (rebuilt bytes match)<br>• update the binding-limit text | docs | S | H | W17-03, W17-06 | `contracts/review-registry/{README,INTERFACE}.md` | A reader can follow §Verify from a clean clone. The README and INTERFACE no longer mention 0.22.0 | — |
| W17-10 | Wave check:<br>• `check:w17`<br>• `checks/w17-check.md` with the owner steps: redeploy testnet `reproducible-wasm` (O1b), "Verify and Publish" on NearBlocks, paste the verified link<br>• tag `wave-17` | test | S | H | W17-01..09 | `docs/plan/checks/w17-check.md` | `npm run check:w17` → green. The owner guide lists the exact commands | — |

**Parallel groups:**
1. W17-01 (lead), W17-02 and W17-05 in parallel.
2. W17-03 and W17-06 in parallel.
3. W17-04, W17-08 and W17-09 in parallel.
4. W17-07 (after `wave-15`).
5. W17-10.

## Wave DoD

- The registry wasm in `res/` is built with `reproducible-wasm`, and its NEP-330 metadata names the repo and the commit.
- The guard reports source-metadata mismatch as `warn`. No metadata never blocks `allow`. Every documented example shows the "self-reported" caveat.
- The sandbox suite runs in CI.
- `check:w17` is green. The owner guide covers testnet verification.
- Tag `wave-17` (and `wave-17.2` if W17-07 lands after `wave-15`).
