# packages/

**Track:** Security (S)
**Owning waves:** W13 (agent guard).
**Owned subpaths:** `packages/guard/` (`@omniswarm/guard`: allow, warn, block wrapper around an agent's signer). It joins the root npm workspaces automatically (`packages/*`).
**Gate command:** `npm run check:w13` (unit, `e2e/intake/w13.spec.ts`, `demos/attack/run.sh --mock`). The workspace's own tests run with `npm test -w @omniswarm/guard`.
**Contract:** guard DTOs in `shared/schemas/intake-api.schema.json` (change request CR-13a to the lead).

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `backend/`, `contracts/`, `frontend/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). The guard calls the intake API's `/api/guard/verdict`; it does not talk to the review engine.

Nothing is built here yet (W00 lands the folder only).
