# contracts/

**Track:** Chain (C)
**Owning waves:** W10 (`review-registry`); W13 adds `src/blocklist.rs` to W10's crate after W10 lands.
**Owned subpaths:** `contracts/review-registry/` (Rust `near-sdk` 5.x contract, near-workspaces tests, deploy script).
**Gate command:** `npm run test:contract` (`cargo test` plus near-workspaces). Prints "skipped (no package yet)" until `contracts/review-registry/Cargo.toml` exists.
**Contract:** `packages/schemas/attestation.schema.json` and INTAKE.md section 6.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Our own contracts are built and tested with `cargo test` and near-workspaces on the developer host and in CI. The AGENTS.md rule "no `cargo test` for a `near-sdk` package" applies to audited targets inside the review sandbox, not to this folder.

Nothing is built here yet (W00 lands the folder only).
