# contracts/

**Track:** Chain (C)
**Owning waves:** W10 (`review-registry`); W13 added the abuse-report blocklist as `src/reports.rs` in W10's crate.
**Owned subpaths:** `contracts/review-registry/` (Rust `near-sdk` 5.x contract, near-workspaces tests, deploy script).
**Gate command:** `npm run test:contract` (`cargo test` plus near-workspaces). Prints "skipped (no package yet)" until `contracts/review-registry/Cargo.toml` exists.
**Contract:** `packages/schemas/attestation.schema.json` and INTAKE.md section 6.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Our own contracts are built and tested with `cargo test` and near-workspaces on the developer host and in CI. The AGENTS.md rule "no `cargo test` for a `near-sdk` package" applies to audited targets inside the review sandbox, not to this folder.

Current state: [`review-registry/README.md`](review-registry/README.md) and [`review-registry/INTERFACE.md`](review-registry/INTERFACE.md).
