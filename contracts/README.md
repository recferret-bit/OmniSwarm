# contracts/

**Track:** Chain (C) · **Owning waves:** W10 (`review-registry`); W13 added the abuse-report blocklist as `src/reports.rs` in W10's crate.
**Gate command:** `npm run test:contract` (`cargo test` on near-sdk's mock VM). `npm run check:w10` adds `cargo clippy -D warnings` and the deploy script's `--dry-run`. `npm run test:contract:sandbox` runs the near-workspaces suite (`--features sandbox`; needs the `wasm32-unknown-unknown` target and downloads a `near-sandbox` binary on first run).

| Crate | What it is |
|---|---|
| [`review-registry/`](review-registry/README.md) | `review-registry` v0.3.0 (`near-sdk` 5.30.0): a paid, single-use review request, the operator's attestation of the report hash, refunds, earnings withdrawal, the deployed-account binding the agent guard reads, and the operator-written abuse-report blocklist (`report_address`, `is_reported`). Methods, arguments, events and errors: [`review-registry/INTERFACE.md`](review-registry/INTERFACE.md) |

Not deployed yet: the testnet deploy (`bash contracts/review-registry/scripts/deploy-testnet.sh --execute`) is an owner step. `reviewer_attest` from INTAKE.md section 6 is not implemented.

**Contract:** `packages/schemas/attestation.schema.json` and INTAKE.md section 6.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Our own contracts are built and tested with `cargo test` and near-workspaces on the developer host. The AGENTS.md rule "no `cargo test` for a `near-sdk` package" applies to audited targets inside the review sandbox, not to this folder.
