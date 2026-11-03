# apps/

The two service apps. Each one is a root npm workspace (`apps/*`) and belongs to its own track.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries").

## apps/api (was `backend/intake/`)

**Track:** Intake (B)
**Package:** `@omniswarm/api`
**Owning waves:** W08 (Intake API), W09 (queue and worker); W10 adds `src/chain/adapters/near/`; W13 adds `src/guard/`.
**Owned subpaths:** `apps/api/` (Fastify 5 + zod, pg-boss, Postgres 16, TypeScript run by Node 24 type stripping with no build step).
**Gate command:** `npm run test:intake` (unit plus Postgres integration on a per-worktree database, see `tools/worktree-env.mjs`). Prints "skipped (no package yet)" until `apps/api/package.json` exists. The `tests/e2e/intake/` specs TRUNCATE their database, so they run only when `DATABASE_URL` is set and skip otherwise.
**Contract:** DTOs come from `packages/schemas/intake-api.schema.json` and `job.schema.json`. A needed schema change is a change request to the lead.

The intake worker runs `./bin/audit run` as a black box with an argv array, never passes `--rpc`, and never widens a reviewer's permissions.

## apps/web (was `frontend/landing/`)

**Track:** Front (F)
**Package:** `@omniswarm/web`
**Owning waves:** W11 (landing and review app).
**Owned subpaths:** `apps/web/` (Vite + React + TypeScript, `@hot-labs/near-connect`).
**Gate command:** `npm run test:landing && npm run test:e2e -- landing` (Vitest, then Playwright in `tests/e2e/landing/`). Prints "skipped (no package yet)" until `apps/web/package.json` exists.
**Contract:** talks to the intake API as typed by `packages/schemas/intake-api.schema.json`; runs on mocks of it until W08 and W09 land.

Wallet code and the NEAR connector belong here and in no other track.

## Shared code

Both apps import the cross-track helpers by package name, never by relative path: `@omniswarm/schemas/canonical-message` (request message and hash), `@omniswarm/schemas/canonical-json` (report hash input) and `@omniswarm/schemas/nep413` (NEP-413 payload and base58). The intake also imports `@omniswarm/guard`.
