# contracts/

**Track:** Chain (C) · **Owning wave:** W10 (`review-registry`).
**Gate command:** `npm run test:contract` (`cargo test` on near-sdk's mock VM). `npm run check:w10` adds `cargo clippy -D warnings` and the deploy script's `--dry-run`.

| Crate | What it is |
|---|---|
| [`review-registry/`](review-registry/README.md) | `review-registry` v0.2.0 (`near-sdk` 5.30.0): a paid, single-use review request, the operator's attestation of the report hash, refunds, earnings withdrawal, and the deployed-account binding the agent guard reads. Methods, arguments, events and errors: [`review-registry/INTERFACE.md`](review-registry/INTERFACE.md) |

Not deployed yet: the testnet deploy (`bash contracts/review-registry/scripts/deploy-testnet.sh --execute`) is an owner step, and no near-workspaces sandbox suite exists (it needs the wasm target, `cargo-near` and a `near-sandbox` binary). There is no blocklist in the contract yet: `report_address`, `is_reported` and `reviewer_attest` from INTAKE.md section 6 are not implemented (INTERFACE.md, change 9).

**Contract:** `packages/schemas/attestation.schema.json` and INTAKE.md section 6.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Our own contracts are built and tested with `cargo test` on the developer host. The AGENTS.md rule "no `cargo test` for a `near-sdk` package" applies to audited targets inside the review sandbox, not to this folder.
