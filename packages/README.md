# packages/

**Track:** Security (S)
**Owning waves:** W13 (agent guard).
**Owned subpaths:** `packages/guard/` (`@omniswarm/guard`: allow, warn, block wrapper around an agent's signer), with its prompt-injection demo in `packages/guard/demo/attack/`. It joins the root npm workspaces automatically (`packages/*`).
**Not owned here:** `packages/schemas/` (`@omniswarm/schemas`) is the lead's cross-track contract (AGENTS.md, "Tracks and boundaries").
**Gate command:** `npm run check:w13` (unit, `tests/e2e/intake/w13.spec.ts`, `packages/guard/demo/attack/run.mjs` with and without `--no-guard`). The workspace's own tests run with `npm test -w @omniswarm/guard`.
**Contract:** guard DTOs in `packages/schemas/intake-api.schema.json` (change request CR-13a to the lead).

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). The guard calls the intake API's `/api/guard/verdict`; it does not talk to the review engine.

Nothing is built here yet (W00 lands the folder only).
