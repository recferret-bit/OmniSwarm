# W17 — Code provenance: owner check

Wave file: [`../waves/W17-provenance.md`](../waves/W17-provenance.md). Branch `wave/w17-provenance` in `../OmniSwarm-wt/w17`. The main checkout stays on `main`. No provider key. The reproducible build needs Docker and cargo-near 0.23.0, and it clones a pushed commit.

## Automated

```sh
npm run check:w17
```

That is `check:w10`, `test:contract:sandbox`, `npm test -w packages/guard`, the attack demo, the `metadata-elsewhere` scenario, and the verify unit test. When `npm run near:local -- status` says the node is up, it also runs `npm run near:local -- verify registry`.

## What NEP-330 proves

`contract_source_metadata` is self-reported. The contract says which repository and commit it was built from. It does not prove those bytes were rebuilt from that commit. NearBlocks **Verify and Publish**, or SourceScan, does the rebuild. **Verified** means the rebuilt wasm matches the deployed code hash.

The guard warns with `SOURCE_METADATA_MISMATCH` when the metadata names a different repo or commit than the attestation. `SOURCE_METADATA_ABSENT` is informational and never decides the verdict, so a clean attestation can still be `allow`.

## Steps

**1. Dry run.** From the repository root:

```sh
bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
```

The first printed line is `cargo near build reproducible-wasm`. The next two lines copy the wasm to `res/review_registry.wasm` and hash it. Nothing is written.

**2. Local match and drift.** With the W15 sandbox up (`npm run near:local -- up && npm run near:local -- seed`):

```sh
npm run near:local -- verify registry
```

Expect a line ending in `→ match` when `res/review_registry.wasm` is the wasm that was seeded. Then redeploy another fixture wasm onto that account and run verify again. Expect `→ drift` and a second line `wasm <base58>`.

**3. Guard scenario.** No sandbox and no key:

```sh
node packages/guard/demo/attack/run.mjs --scenario metadata-elsewhere
```

The log starts with the self-reported caveat. The payee `elsewhere.owner.testnet` is `warn` with `SOURCE_METADATA_MISMATCH`. Outcome is `refused_before_signing`, signer calls 0. A human who returns `true` from `onWarn` is what allows the signature. This demo declines.

**4. Reproducible wasm, after the commit is public (O1b).** cargo-near 0.23.0 builds the committed revision and ignores uncommitted edits. The container clones `https://github.com/recferret-bit/OmniSwarm` at that revision, so the commit must be pushed and the repository must be cloneable. From that commit, with Docker running:

```sh
cargo near build reproducible-wasm --manifest-path contracts/review-registry/Cargo.toml
bash contracts/review-registry/scripts/deploy-testnet.sh --execute
```

`--execute` rebuilds, copies `res/review_registry.wasm` and `res/review_registry.wasm.sha256`, and deploys. An account that already exists fails at the create-account steps; deploy the new wasm with the `near contract deploy` line from the dry run so the account and its state stay. Then:

```sh
near contract call-function as-read-only review-registry.<owner>.testnet contract_source_metadata json-args '{}' network-config testnet now
```

Expect `link` `https://github.com/recferret-bit/OmniSwarm` and `build_info.source_code_snapshot` `git+https://github.com/recferret-bit/OmniSwarm?rev=<the commit>`.

**5. NearBlocks (O3).** Open `https://testnet.nearblocks.io/address/review-registry.<owner>.testnet`. Use **Verify and Publish**. When it shows **Verified**, paste that URL here:

```
verified: 
```

SourceScan is the same check if NearBlocks is unavailable: https://sourcescan.dev

## Not in this check

Tag `wave-17` only after this guide's owner steps and `npm run check:all` are green, and only when the owner says to land the wave. The live NearBlocks verification is the owner's step. The guard does not rebuild the wasm itself.
