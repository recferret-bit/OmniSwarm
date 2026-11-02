# backend/

**Track:** Intake (B)
**Owning waves:** W08 (Intake API), W09 (queue and worker); W10 adds `src/chain/adapters/near/`; W13 adds `src/guard/`.
**Owned subpaths:** `backend/intake/` (Fastify 5 + zod, pg-boss, Postgres 16, TypeScript run by Node 24 type stripping with no build step).
**Gate command:** `npm run test:intake` (unit plus Postgres integration on a per-worktree database, see `tools/worktree-env.mjs`). Prints "skipped (no package yet)" until `backend/intake/package.json` exists.
**Contract:** DTOs come from `shared/schemas/intake-api.schema.json` and `job.schema.json`. A needed schema change is a change request to the lead.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `backend/`, `contracts/`, `frontend/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). The intake worker runs `./bin/audit run` as a black box with an argv array, never passes `--rpc`, and never widens a reviewer's permissions.

Nothing is built here yet (W00 lands the folder only).
