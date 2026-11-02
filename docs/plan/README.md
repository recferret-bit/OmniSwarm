# docs/plan — OmniSwarm hackathon build plan

Plan only (2026-11-02, hackathon day D2). Start with [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md).

| File | What |
|---|---|
| [`PROJECT_REVIEW.md`](./PROJECT_REVIEW.md) | Review of `main` @ `ac170f1`: findings `R-01..R-20`, test results, hackathon gaps |
| [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) | **The plan:** 15 waves on 6 tracks, layout, parallel rules, issue format, branch/worktree pipeline |
| [`HACKATHON_CUT.md`](./HACKATHON_CUT.md) | What ships by 2026-11-14, calendar D2–D14, D10 gate, agent allocation, drop order |
| [`waves/`](./waves/) | One file per wave with its issue table (`WNN-XX`) |
| [`checks/`](./checks/) | Owner check guides, one per landed wave |
| [`../spec/ORCHESTRATION.md`](../spec/ORCHESTRATION.md) | Reviewer families (CLI subscriptions, API keys, OpenRouter, scripted), iteration budget, debate, orchestrator, report v2, golden eval |
| [`../spec/INTAKE.md`](../spec/INTAKE.md) | NEAR login, NEP-413 signed request, payable contract, queue, worker, attestation, guard |
| [`../spec/DECISIONS.md`](../spec/DECISIONS.md) | Open owner decisions OD-01..OD-16 with recommendations |
| [`../hackathon/TRACKS.md`](../hackathon/TRACKS.md) | Track rules and fit: 06 security (primary), 07 agents, 13 open |

## How to run it with agents

1. The lead runs W00 alone (one session), lands it after the owner check.
2. Open W01 (spine). In parallel open W08, W10, W11, W12 — each in its own worktree, each with one lead agent that spawns one agent per issue (`Agent` with `isolation: "worktree"`, or codex / grok / agy sessions).
3. After W01 lands: open W02, W03, W05 in parallel. Then W04 and W06 as their dependencies land; W07 after W05; W09 after W08; W13 after W08 + W10.
4. D10 gate (HACKATHON_CUT §3). Then W14.

Prompt for a wave lead: *"You are the lead of `docs/plan/waves/WNN-*.md`. Read PRODUCT_WAVES.md §4–§7, the wave file and its specs. Open the wave worktree, build the `H` rows issue by issue (one sub-agent per issue in its own worktree, at most 6 at once), keep to the owned paths, land issues when their gates are green, then write `checks/wNN-check.md` from the running result and stop for the owner check."*
