# W24 — Budget, anytime results and resume

> **Track:** Engine (E) with Lead (schemas) · **Tag:** `wave-24` · **Check:** `npm run check:w24` (= `node tools/wave-check.mjs 24`: the budget, budget middleware, resume middleware, bridge budget, phases and resume tests and `tests/e2e/engine/w24.test.mjs`, then the coverage gate over this wave's modules)
> **Depends on waves:** W20 (the execute seam and its nesting order, structured usage, the event log, reserved flags, failure reasons and roles), W23 (the chaos harness for the proofs, provider parking for the pause state).
> **Soft dependencies:** none.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D5 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M5`, `M10`, `M11`, `E23`, `E24`, `E25`, `E28`, `E31`
> **Owned paths:** `engine/scripts/orchestrator-budget*.mjs`, `engine/scripts/orchestrator-mw-budget*.mjs`, `engine/scripts/orchestrator-mw-resume*.mjs`, `engine/scripts/bridge-budget.mjs`, `engine/scripts/docker-mcp-bridge.mjs` (the tool-result builder and an after-call hook only), `engine/scripts/orchestrator-resume.mjs`, `engine/scripts/orchestrator-phases.mjs`, `engine/scripts/reviewer-plan-feature-budget.mjs`, `engine/scripts/reviewer-plan.test.mjs` (plan-print cases), `packages/schemas/**` (W24-01, lead), `docs/RULES.md` (append-only), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W24 key), `tests/e2e/engine/w24.test.mjs`, `docs/plan/checks/w24-check.md`
> **Not owned:** `engine/scripts/debate-*.mjs` (the debate clock is steered through `budgets.debate.phaseMs`, an input; `debate-bridge.mjs`'s own counters are read, not edited), `orchestrator-briefs.mjs` (the budget block is appended by middleware), `orchestrator-review.mjs`, `orchestrator-crosscheck.mjs`, `orchestrator-session.mjs`.

## Goal

A run should know what it may spend, tell each agent what is left, and always end with the best result it can already stand behind. Today `--max-cost-usd` exists and is unset, a hidden 40-call cap truncates turns with no verdict, and a usage limit or a crash ends the run INCOMPLETE with finished work thrown away (`M5`; `E24`: agents that see their remaining budget scale better than agents given a bigger one).

- **A ledger and an envelope** in minutes, tokens (the canonical counter of W20-04) and, where a price is known, USD, split by stage with a reserve for judging and the report.
- **A budget block** at the end of every prompt and a **host-written line** after every read tool result: calls left, seconds left. The line is advisory (a CLI flattens tool-result items into one text block), carries a per-session nonce that only the brief names, and changes nothing the bridge enforces.
- **Deadlines** from the envelope instead of one flat 180 s, per role and vendor.
- **Anytime results:** when the envelope is spent, stop starting tasks, give every cluster its rules status, and always write the report.
- **Resume at the task level,** as middleware that reuses a finished task's verified inbox entry, and a **pause** state when every remaining task waits on a quota reset.

Defaults are off. A run with no budget flag is unchanged.

## Demo story (the check in words)

1. `node engine/scripts/harness-chaos.mjs --scenario budget --max-minutes 2 --seed 3` → the run stops starting tasks at the envelope, the report is written, `meta.json` lists `budget_exhausted` for the phases it skipped, and every cluster has a status. (`./bin/audit demo` without Docker takes the host path and ignores series flags; the scenario drives `runOrchestratedAudit`.)
2. `cat <run>/harness/host/budget-ledger.json` → spend by stage, role and provider in canonical tokens and minutes; USD is `null` for subscription reviewers, not `0`.
3. `./bin/audit run … --plan --max-minutes 45` → the plan prints the envelope, the stage split and an estimated range from ledger medians.
4. Stop a scripted run with SIGINT, then run it again with `--resume-from <dir>` → it completes with the same adjudication as an uninterrupted run, and the events show `resume_skip` for every task already done.
5. In the usage-limit chaos scenario with a reset beyond the envelope → the run ends `paused`, prints the reset time (or "reset unknown") and the resume command, and writes no completion claim.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-20` and `wave-23` are in `main`; the lead has landed W24-01.
- [ ] W24-00's offline part is answered below; its live part (one trivial session per vendor) is an owner-lane step run only after **OD-22** and blocks only the live proof.
- [ ] No other open wave owns a listed path. `bridge-budget.mjs` and `docker-mcp-bridge.mjs` have no other owner in this series.

## Spike answers

Open until W24-00 is done. Record, per vendor and per API provider: where tokens sit in the result frame and `api-session.json`, which of them are cumulative, whether USD is reported or must come from a price table, and the live comparison of one session per vendor with its frame.

## Features covered

- [ ] Contracts: W24-01
- [ ] Ledger and envelope: W24-02
- [ ] Budget middleware and host-written tool-result line: W24-03, W24-04
- [ ] Stage envelopes and always-report: W24-05
- [ ] Task-level resume middleware and the pause state: W24-06, W24-07
- [ ] Price table and plan print: W24-08
- [ ] Wave check and tag: W24-09
- [ ] Spike: W24-00

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W24-00 | Spike: from the W20 usage fixtures and an API-family `api-session.json`, list where tokens and cost sit in each frame and which are cumulative; decide the ledger units (canonical tokens, USD only when reported or priced). The live comparison is an owner-lane step after OD-22 | test | S | | W20 | `docs/plan/waves/W24-budget.md` (Spike answers) | Read the three usage fixtures and the API-family file → "Spike answers" lists the fields per vendor and provider and the cumulative ones; after OD-22 the owner runs one trivial session per vendor and records its token count against the frame's. Cost: three trivial sessions | `E24` |
| W24-01 | Lead contract:<br>• schema `run-budget` (envelope minutes, tokens, USD; stage split; reserve)<br>• schemas `budget-ledger`, `budget-file` and `resume-state`<br>• run-event kinds `budget_reserve`, `budget_spend`, `budget_refuse`, `budget_exhausted`, `resume_skip`, `paused`<br>• the config object is `envelope` (`budgets` already exists); gap reasons are strings listed in `docs/RULES.md` and asserted by a test, not a schema enum | contract | S | | W20 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a split that does not sum to 100, a negative envelope, a ledger entry with `usd: 0` and `costSource: none`, a `budget_spend` with no stage, and a `resume-state` with no `remaining` fail (negative ×5) | `E24` |
| W24-02 | Ledger and envelope `orchestrator-budget.mjs`:<br>• spend by stage, role and provider from the canonical usage<br>• shares of the envelope per stage with a reserve<br>• `canStart(task)` from the running median cost of that role and vendor, with a cold-start table<br>• never blocks the report or a running task | engine | M | | W24-01 | `engine/scripts/orchestrator-budget.mjs`, `engine/scripts/orchestrator-budget.test.mjs` | `node --test engine/scripts/orchestrator-budget.test.mjs` → over 50 seeded runs spend never exceeds the envelope by more than one in-flight task; the reserve is untouched before the final stage; an unpriced provider counts tokens only and USD stays `null`; a NaN or negative usage is rejected (negative); `canStart` is false when the typical cost exceeds what is left and true for the report stage | `E23`, `E24` |
| W24-03 | Middleware `orchestrator-mw-budget.mjs`:<br>• refuse to start a task the envelope cannot cover (reason `budget_exhausted`, no session launched)<br>• append a Budget block (calls left, seconds left, the session nonce, "submit before the budget ends") to the prompt<br>• abort at a deadline of `min(2 × the p95 of that role and vendor, stage left, run left)`, **relabel** the resulting `cancelled` as `budget_deadline`, and keep output already committed<br>• write `harness/host/budget/<session>.json` and update the ledger | engine | M | | W24-02, W24-04, W20 | `engine/scripts/orchestrator-mw-budget.mjs`, `engine/scripts/orchestrator-mw-budget.test.mjs` | `node --test engine/scripts/orchestrator-mw-budget.test.mjs` → with `--max-minutes` a chaos run stops launching at the envelope and still reports; the Budget block is the last block of the prompt and carries the numbers and the nonce; a deadline that fires after a submit keeps the committed report and is not a failure (negative); the deadline is not in the assignment, so the assignment digest equals the one without a budget (negative: resume must still match); with no budget flag nothing is added (neutral) | `E24` |
| W24-04 | Bridge: after a read tool result the bridge adds a separate trailing content item written by the host, `[host <nonce>] calls left: n; seconds left: s`, only when a budget is configured. For the debate roles the numbers are read from `harness/debate-budget-<session>.json` (not edited in `debate-bridge.mjs`). Enforcement (the counting and the finalize-only calls) is unchanged; the line is advisory | engine | M | | W24-01 | `engine/scripts/bridge-budget.mjs`, `engine/scripts/docker-mcp-bridge.mjs` (tool-result builder and an after-call hook), `engine/scripts/bridge-budget.test.mjs`, `engine/scripts/docker-mcp-bridge.test.mjs` | `node --test engine/scripts/bridge-budget.test.mjs engine/scripts/docker-mcp-bridge.test.mjs` → `read_file` returns two content items and the second is the host line with the nonce; a file whose text imitates the line leaves the bridge's counts and the enforcement unchanged (negative); for a debater session the numbers match its budget file; without a budget there is one item; submit tools are unchanged | `E24` |
| W24-05 | Stage envelopes and always-report in `orchestrator-phases.mjs`:<br>• a phase with no budget left is skipped as `budget_exhausted:<phase>`<br>• the debate gets `budgets.debate.phaseMs = min(configured, stage left)`, which the existing `debate_time` path already honours<br>• `report` always runs | engine | M | | W24-02 | `engine/scripts/orchestrator-phases.mjs`, `engine/scripts/orchestrator-phases.test.mjs` | `node --test engine/scripts/orchestrator-phases.test.mjs` → with a 2-minute envelope the later phases are skipped and recorded, unstarted clusters get `debate_time` rows, the report is written and `meta` shows `budget_exhausted`; at zero left the report phase still runs (negative: it must never be skipped) | `M5` |
| W24-06 | Task-level resume as middleware `orchestrator-mw-resume.mjs` (nesting: events, resume, retry, budget, lanes): when `--resume-from` is set and the session's inbox entry or submission exists with a valid hash and an identity (source digest, assignment digest, reviewer) that matches, return a synthetic finished result and emit `resume_skip`, so the voice reads the inbox as usual. The middleware copies the verified inbox entry into the new output folder (a resumed run writes to an empty one), rebuilds the identity from `harness/identities/<name>.json`, the run's source digest and the assignment digest, and handles inbox kinds only: auditor and cross-check submissions keep `resumeSession`. `orchestrator-resume.mjs` provides the check | engine | M | | W24-01, W20 | `engine/scripts/orchestrator-mw-resume.mjs`, `engine/scripts/orchestrator-resume.mjs`, `engine/scripts/orchestrator-mw-resume.test.mjs`, `engine/scripts/orchestrator-resume.test.mjs` | `node --test engine/scripts/orchestrator-mw-resume.test.mjs engine/scripts/orchestrator-resume.test.mjs` → a scripted run interrupted at a seeded point (20 seeds) and resumed gives an adjudication deep-equal to the uninterrupted run with zero tasks rerun; a changed source digest refuses; a tampered inbox hash refuses; an inbox entry from a different assignment digest is not reused (negative ×3); nothing under `harness/sandbox-run/` is read (negative) | `E31`, AGENTS.md |
| W24-07 | Pause state:<br>• when every remaining task waits on a parked provider and budget remains, end as `paused`<br>• write a host-only `harness/host/resume.json` (earliest reset or "unknown", remaining tasks)<br>• print the resume command and the reset time or "reset unknown"<br>• never print a completion claim | engine | S | | W24-05, W24-06, W23 | `engine/scripts/orchestrator-resume.mjs`, `engine/scripts/orchestrator-phases.mjs`, their tests | `node --test engine/scripts/orchestrator-resume.test.mjs engine/scripts/orchestrator-phases.test.mjs` → usage-limit chaos with a reset beyond the run ends `paused` with the command printed; with an unknown reset it says so; resuming after the reset completes the rest; with the envelope exhausted the run ends INCOMPLETE and not paused (negative) | `E28` |
| W24-08 | Prices and plan print: `orchestrator-budget-prices.mjs` (a dated static table for API providers); `reviewer-plan-feature-budget.mjs` makes `--plan` print the envelope, the stage split and an estimated range from ledger medians. No new default cost ceiling is introduced here (the pool ceiling is W27's) | engine | M | | W24-02 | `engine/scripts/orchestrator-budget-prices.mjs`, `engine/scripts/reviewer-plan-feature-budget.mjs`, `engine/scripts/orchestrator-budget-prices.test.mjs`, `engine/scripts/reviewer-plan.test.mjs` | `node --test engine/scripts/orchestrator-budget-prices.test.mjs engine/scripts/reviewer-plan.test.mjs` → a priced model gives USD from tokens; an unknown model gives `null`, never a guess (negative); `--plan --max-minutes 45` prints the envelope and split as active; a subscription-only plan prints tokens and minutes and no dollar figure; with no budget flag the plan is unchanged (neutral) | `E24` |
| W24-09 | Wave check:<br>• `tests/e2e/engine/w24.test.mjs`: conservation, always-report, resume equality, neutral defaults<br>• fill `tools/wave-checks.json` for W24<br>• `checks/w24-check.md`, tag `wave-24` | test | S | | W24-03..08 | `tests/e2e/engine/w24.test.mjs`, `tools/wave-checks.json` (the W24 key), `docs/plan/checks/w24-check.md`, `docs/RULES.md` (append-only: budget, anytime, pause) | `npm run check:w24` → green; `npm run check:all` → green | — |

**Parallel groups:**
1. W24-00 (spike), W24-01 (lead).
2. W24-02, W24-04, W24-06.
3. W24-03 (needs W24-02, W24-04), W24-05 (needs W24-02), W24-08 (needs W24-02).
4. W24-07 (needs W24-05, W24-06).
5. W24-09.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `orchestrator-budget.test.mjs`, `orchestrator-mw-budget.test.mjs`, `orchestrator-mw-resume.test.mjs`, `orchestrator-budget-prices.test.mjs`, `bridge-budget.test.mjs` (extended), `docker-mcp-bridge.test.mjs` (extended), `orchestrator-resume.test.mjs` (new), `orchestrator-phases.test.mjs` (extended), `reviewer-plan.test.mjs` (extended), `tests/e2e/engine/w24.test.mjs`. A test file the plan names that does not exist yet is created by its issue.
- **Coverage:** the gate → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`bridge-budget` 100 / 93.1, `orchestrator-resume` 96.3 / 84.0, `orchestrator-phases` 100 / 95.1, `docker-mcp-bridge` as measured by W20-07).
- **Seeds:** conservation uses seeds 1–50 and resume 1–20; a failing seed is printed.

## Analytics

- **Events:** `budget_reserve`, `budget_spend{stage,role,provider,tokens,usd,minutes}`, `budget_refuse{task,reason}`, `budget_exhausted{stage}`, `resume_skip{task}`, `paused{reset}`.
- **Metrics (defined in W21, null until the events exist):** `spend_by_stage`, `budget_used_pct`, `typical_cost{role,vendor}` (running median), `refused_tasks`, `time_to_first_valid_result`, `resume_saved_minutes`, `paused_runs`.
- **Artifacts:** `harness/host/budget-ledger.json`, `harness/host/budget/<session>.json`, `harness/host/resume.json` (all host-only, each with a schema), the scorecard (W21).
- **Watch:** `budget_used_pct` over 100 plus one task means the conservation property is broken; a `typical_cost` that drifts more than 2× from the cold-start table means the table needs a refresh.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P3 chaos | Envelopes of 5 to 60 virtual minutes, seeds 1–50 | total spend at most the envelope plus the cost of one in-flight task; the reserve untouched before the final stage; the report is always produced; every cluster has a status |
| P3 chaos | Kill at a seeded point, resume (seeds 1–20) | adjudication deep-equal to the uninterrupted run; zero tasks rerun; `resume_skip` count equals tasks done before the kill |
| P3 chaos | Usage limit with a reset beyond the envelope, known and unknown | `paused`, the command and the reset (or "reset unknown") printed; no completion claim |
| P4 neutrality | No budget flag, `runOrchestratedAudit` over the scripted fixture | artifacts equal today's except the event log; the assignment digest is unchanged by a budget |
| P5 live (owner lane, after OD-22) | One run on `fullstack-dapp` S3 with `--max-minutes 40` | spend within the envelope plus one task; the report is produced; the ledger's canonical tokens equal the sum over the session results exactly; then SIGINT mid-run and `--resume-from` completes. Cost: one run plus a partial |

## Risks and rollback

- **A deadline that is too tight truncates good turns.** The deadline is twice the p95 of that role and vendor and never below the existing turn clock until 8 samples exist; a deadline firing after a submit keeps the report; the live proof reports truncated turns.
- **The budget line can be spoofed in the model's view.** It is advisory, carries a nonce only the brief names, and the bridge's enforcement does not read it.
- **A budget in the assignment would break resume.** It travels in `harness/host/budget/<session>.json`; the digest test guards it.
- **Token counters differ between vendors** (`M10`). The ledger uses the canonical counter of W20-04; T6 compares only within one panel.
- Rollback: revert the wave merge; without the flags nothing runs.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w24`, `check:all`, `check:v2` green; coverage gate green; neutrality proof green.
- Every new flag is documented in `docs/how-it-works.md` and shown as active by `--plan`.
- `docs/RULES.md` rules for budget, anytime and pause appended.
- No file outside owned paths changed; no key, host path or `reports/` content committed.
- `checks/w24-check.md` written from the running result. Tag `wave-24` after the owner check.
