# tests/e2e/

**Track:** one subfolder per track, each owned by that track's wave.
**Owning waves:** `tests/e2e/landing/` is W11 (Playwright); `tests/e2e/intake/` is W08, W09, W13 (API end to end); `tests/e2e/engine/` is W06 and later engine waves.
**Owned subpaths:** the three subfolders above; the root of `tests/e2e/` is the lead's.
**Gate command:** `npm run test:e2e` (add `-- landing` for one subfolder). Prints "skipped (no package yet)" until `tests/e2e/package.json` exists. The `intake/` specs (`npm run check:w08`, `check:w09`) TRUNCATE their database: they run only when `DATABASE_URL` is set and skip otherwise, so point it at a throwaway Postgres, never a database you keep.
**Real-service runs:** only with `E2E_API=real` and a staging URL on the D10 gate; the default is mocks and a local mock chain.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Specs drive the stack through its public interfaces and never import engine internals.

Nothing is built here yet (W00 lands the folder only).
