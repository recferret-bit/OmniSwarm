# docs/plan — OmniSwarm hackathon build plan

Plan only (2026-11-02, hackathon day D2). Start with [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md).

| File | What |
|---|---|
| [`PROJECT_REVIEW.md`](./PROJECT_REVIEW.md) | Review of `main` @ `ac170f1`: findings `R-01..R-20`, test results, hackathon gaps |
| [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) | **The plan:** 15 waves on 6 tracks, layout, parallel rules, issue format, branch/worktree pipeline |
| [`HACKATHON_CUT.md`](./HACKATHON_CUT.md) | What ships by 2026-11-14, calendar D2–D14, D10 gate, agent allocation, drop order |
| [`FINAL_SPRINT.md`](./FINAL_SPRINT.md) | **Current (2026-11-09):** cut and calendar for waves W15–W19 (local NEAR, green gates, provenance, agent economy, submission v2), issue DoR/DoD, owner lane, drop order |
| [`waves/`](./waves/) | One file per wave with its issue table (`WNN-XX`) |
| [`checks/`](./checks/) | Owner check guides, one per landed wave |
| [`../spec/ORCHESTRATION.md`](../spec/ORCHESTRATION.md) | Reviewer families (CLI subscriptions, API keys, OpenRouter, scripted), iteration budget, debate, orchestrator, report v2, golden eval |
| [`../spec/INTAKE.md`](../spec/INTAKE.md) | NEAR login, NEP-413 signed request, payable contract, queue, worker, attestation, guard |
| [`../spec/DECISIONS.md`](../spec/DECISIONS.md) | Open owner decisions OD-01..OD-16 with recommendations |
| [`../hackathon/TRACKS.md`](../hackathon/TRACKS.md) | Track rules and fit: 06 security (primary), 07 agents, 13 open |

## Path map (2026-11-03)

Every track moved after most wave files were written: the non-engine tracks first, then the review engine under `engine/`. Wave files under [`waves/`](./waves/) and the owner guides under [`checks/`](./checks/) are closed records and keep the old paths; read them through this table. `bin/` (`./bin/audit`), `reports/` (run output) and the operator's `omniswarm.config.json` stay at the repository root, as do `.claude/skills/security-audit/SKILL.md` and `.grok/`.

| Old path | New path | Notes |
|---|---|---|
| `shared/schemas/` | `packages/schemas/` | Still `@omniswarm/schemas`, lead only. Also holds `canonical-json.mjs` and `nep413.mjs`, shared by both apps |
| `backend/intake/` | `apps/api/` | Package `@omniswarm/intake` is now `@omniswarm/api` (`npm run dev -w apps/api`) |
| `frontend/landing/` | `apps/web/` | Package `@omniswarm/landing` is now `@omniswarm/web` (`npm run guard -w apps/web`) |
| `backend/README.md`, `frontend/README.md` | `apps/README.md` | One README for both apps |
| `e2e/` | `tests/e2e/` | Same package and runner (`npm run test:e2e`). The `intake/` specs need an explicit `DATABASE_URL` and skip without one |
| `demos/attack/` | `packages/guard/demo/attack/` | `node packages/guard/demo/attack/run.mjs [--no-guard]` |
| `demos/dogfood/README.md` | `docs/hackathon/dogfood.md` | |
| `RULES.md` | `docs/RULES.md` | |
| `scripts/` | `engine/scripts/` | Still flat; `npm test` globs `engine/scripts/*.test.mjs`. Schema imports are `../../packages/schemas/…` |
| `docker/` | `engine/docker/` | The sandbox build context is `engine/docker` only |
| `native/` | `engine/native/` | Admission recipes hash `engine/scripts/*.mjs` and the root `bin/audit`; receipts from before the move must be re-admitted |
| `skills/security-audit/` | `engine/skills/security-audit/` | Canonical copy; `.claude/skills/security-audit/SKILL.md` stays at the root and stays byte-identical |
| `runtime/` | `engine/runtime/` | `./bin/audit setup-agents` installs into `engine/runtime/node_modules/` |
| `eval/` | `engine/eval/` | `npm run eval:golden`; golden repos at `engine/eval/golden/` |
| `omniswarm.config.example.json` | `engine/omniswarm.config.example.json` | Copy it to `omniswarm.config.json` at the repository root (the default lookup) |
| `/trusted/*.mjs`, `/packages/schemas/` (worker container) | `/trusted/engine/scripts/`, `/trusted/packages/schemas/` | The sealed worker bundle mirrors the repository layout under `/trusted` |

## How to run it with agents

1. The lead runs W00 alone (one session), lands it after the owner check.
2. Open W01 (spine). In parallel open W08, W10, W11, W12 — each in its own worktree, each with one lead agent that spawns one agent per issue (`Agent` with `isolation: "worktree"`, or codex / grok / agy sessions).
3. After W01 lands: open W02, W03, W05 in parallel. Then W04 and W06 as their dependencies land; W07 after W05; W09 after W08; W13 after W08 + W10.
4. D10 gate (HACKATHON_CUT §3). Then W14.

Prompt for a wave lead: *"You are the lead of `docs/plan/waves/WNN-*.md`. Read PRODUCT_WAVES.md §4–§7, the wave file and its specs. Open the wave worktree, build the `H` rows issue by issue (one sub-agent per issue in its own worktree, at most 6 at once), keep to the owned paths, land issues when their gates are green, then write `checks/wNN-check.md` from the running result and stop for the owner check."*
