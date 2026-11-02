# frontend/

**Track:** Front (F)
**Owning waves:** W11 (landing and review app).
**Owned subpaths:** `frontend/landing/` (Vite + React + TypeScript, `@hot-labs/near-connect`).
**Gate command:** `npm run test:landing && npm run test:e2e -- landing` (Vitest, then Playwright in `e2e/landing/`). Prints "skipped (no package yet)" until `frontend/landing/package.json` exists.
**Contract:** talks to the intake API as typed by `shared/schemas/intake-api.schema.json`; runs on mocks of it until W08 and W09 land.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `backend/`, `contracts/`, `frontend/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Wallet code and the NEAR connector belong here and in no other track.

Nothing is built here yet (W00 lands the folder only).
