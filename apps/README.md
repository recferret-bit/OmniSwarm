# apps/

The two service apps. Each one is a root npm workspace (`apps/*`) and belongs to its own track.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries").

## apps/api (was `backend/intake/`)

**Track:** Intake (B) · **Package:** `@omniswarm/api` · **Owning waves:** W08 (intake API), W09 (queue and worker), W10 (NEAR chain adapter), W13 (guard route).
**Stack:** Fastify 5 + zod, pg-boss on Postgres 16, near-api-js 7.4.0, TypeScript run by Node 24 type stripping with no build step.
**Gate command:** `npm run test:intake` (`npm test -w apps/api`). The Postgres integration tests skip without `DATABASE_URL`; with it, each test file creates and drops its own database on that server (`test/helpers/db.ts`). `npm run check:w08` and `npm run check:w09` add the `tests/e2e/intake/` specs, which start the real API and worker processes.
**Contract:** DTOs come from `packages/schemas/intake-api.schema.json` and `job.schema.json`. A needed schema change is a change request to the lead.

Processes: `npm run start -w apps/api` (public API), `npm run worker -w apps/api` (queue worker), `npm run db:migrate -w apps/api`. Routes are registered in `src/http/app.ts`; `/api/docs` serves the OpenAPI UI, and admin refunds listen on loopback only.

Three adapters pick mock or real (`src/config/load.ts`): `CHAIN_ADAPTER` (`mock` | `near`), `GITHUB_ADAPTER` (`recorded` | `live`) and `ENGINE_RUNNER` (`mock` | `cli`). Each defaults to the real adapter when `NODE_ENV=production` and to the mock otherwise, and a mock is refused in production.

The worker runs `./bin/audit run --github <owner/repo> --ref <sha> --preset <preset> --out <dir>` as a black box with an argv array (`src/engine/cli/argv.ts`); it never passes `--rpc` and refuses `cli:*` reviewers in a hosted preset (`src/worker/preset.ts`).

## apps/web (was `frontend/landing/`)

**Track:** Front (F) · **Package:** `@omniswarm/web` · **Owning wave:** W11 (landing and review app).
**Stack:** Next.js 16 App Router, React 19, Zustand 5, `@hot-labs/near-connect` 0.12.0.
**Gate command:** `npm run test:landing && npm run test:e2e -- landing` (typecheck + Vitest, then the Playwright-driven flow in `tests/e2e/landing/`). `npm run guard -w apps/web` checks that a production bundle carries no mock code.
**Contract:** the API client is generated from `packages/schemas/intake-api.schema.json` (`npm run gen:api -w apps/web`).

`NEXT_PUBLIC_API_MOCK=1` serves the API from MSW handlers and `NEXT_PUBLIC_WALLET=mock` uses a mock wallet; `.env.development` turns both on, so `next dev` runs on mocks. Wallet code and the NEAR connector belong here and in no other track.

## Shared code

Both apps import the cross-track helpers by package name, never by relative path: `@omniswarm/schemas/canonical-message` (request message and hash), `@omniswarm/schemas/canonical-json` (report hash input) and `@omniswarm/schemas/nep413` (NEP-413 payload and base58). The API also imports `@omniswarm/guard`.
