# tests/e2e/

End-to-end checks, one subfolder per track. The root of `tests/e2e/` (`package.json`, `run.mjs`) is the lead's.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries").

| Folder | Waves | What it drives | How to run |
|---|---|---|---|
| `landing/` | W11 | A production `next build` of `apps/web` in mock mode (MSW and a mock wallet), in headless Chrome at 360 px, through `playwright-core` | `npm run test:e2e` (or `npm run test:e2e -- landing`, the only suite `run.mjs` accepts). Needs a local Chrome |
| `intake/` | W08, W09 | The real API and worker processes of `apps/api` against the mock chain, recorded GitHub and the mock engine runner | `npm run check:w08`, `npm run check:w09`. Needs `DATABASE_URL` |
| `engine/` | W03–W07 | The review engine in-process: scripted reviewers, budgets, per-reviewer reports, the debate on the golden repos, report v2 | `npm run check:w03` … `npm run check:w07` |

The `intake/` specs skip without `DATABASE_URL`. With it, each spec file creates its own database on that server and drops it afterwards (`apps/api/test/helpers/db.ts`), so point it at a throwaway Postgres you are allowed to create databases on.

Nothing here calls a live service: no NEAR RPC, no GitHub API, no provider. Real-service runs against testnet are an owner step and are not part of these suites.
