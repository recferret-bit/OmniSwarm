# Demo fixture

A small NEAR vault and a TypeScript client used by `./bin/audit demo`.
The seeded issues are for the scripted reviewers. This tree is not a review of a real deployment.

Both parts are locked (`Cargo.lock`, `client/package-lock.json`) so the sandbox's advisory scans cover them.
`client/test/` is the client's own `node:test` suite, which the review runs offline from the fixed catalog.
The vault is a `cdylib`, so the review also builds it with `cargo near build non-reproducible-wasm` and runs clippy.
Its `cargo test` is not run: a near-sdk crate's tests are a local-sandbox coverage gap.
