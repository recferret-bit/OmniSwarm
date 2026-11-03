# W04 — Iteration Budget & Passes

> **Track:** Engine (E) · **Tag:** `wave-04` · **Check:** `npm run check:w04` (`node --test e2e/engine/w04.test.mjs`) · **Fixture:** `scripts/demo-fixture/` (W03) with `scripted:*` reviewers and the W03 recorded HTTP fixtures
> **Depends on waves:** W02 (hardened bridge: per-role tool files `scripts/bridge-tools-<role>.mjs`, dispatcher in `scripts/docker-mcp-bridge.mjs`), W03 (API loop `provider-openai-compat.mjs`, `api-acp-agent.mjs`, `scripted` family). Uses from W01 without owning them: the phase list `scripts/orchestrator-phases.mjs` and the review phase file it registers.
> **Specs:** [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §3 (iteration budget), §5 (brief templates), §6 (`usage.json`, `passes/`) · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-03 (defaults `--passes 2 --tool-budget 40`, grace 3) · [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-15 (`finalizeOnly` never set), R-20 ("no runner time limit" text)
> **Owned paths:** `scripts/bridge-budget.mjs` (new) and the dispatcher hook in `scripts/docker-mcp-bridge.mjs`; `scripts/review-briefs.mjs` (new, review-pass templates); the review phase file from W01 (pass loop only); the turn loop in `scripts/agent-session.mjs`; the loop bound in `scripts/provider-openai-compat.mjs` / `provider-anthropic.mjs` / `provider-scripted.mjs`; budget flags in `bin/audit`, `bin/omniswarm`, `scripts/orchestrate.sh`; grok/claude turn flags in the W01 `cli` family file; budget rows in `scripts/verification-health.mjs`; the two "no runner time limit" prompt lines in `scripts/docker-agent-orchestrator.mjs` (`:162`, `:185`); both skill copies (budget lines only); `e2e/engine/w04.test.mjs`. Lead pre-step (change request): budget fields in `shared/schemas/run-config.schema.json`, `usage` and `pass` objects in `shared/schemas/reviewer-report.schema.json`.

## Goal

The owner's rule — **each agent iterates a fixed number of times** — holds for every family. Every reviewer runs **exactly P passes** per assignment (default 2: discover, then self-verify), and every pass is capped at **N bridge tool calls** (default 40, submit excluded). At N the bridge switches that reviewer to finalize-only, allows 3 grace calls, then the session is told to submit or is cancelled. The same numbers apply to `cli`, `key`, `openrouter` and `scripted` reviewers, and every pass leaves a record of calls, tokens, cost and why it stopped.

## Demo story (the check in words)

1. `./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline,scripted:lazy,key:zai:glm-5.3 --passes 2 --tool-budget 5 --plan` → the plan prints, per reviewer, "2 passes × 5 calls (+3 grace)", the pass roles "discover, self-verify", and the worst-case call count.
2. `OMNI_HTTP_REPLAY=scripts/provider-fixtures/w04 ./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline,scripted:lazy,key:zai:glm-5.3 --surface s1 --passes 2 --tool-budget 5` → every reviewer shows exactly 2 passes in `harness/usage/`; `scripted:lazy` (which keeps reading) hits 5 calls, gets "budget exhausted: call submit_audit_report now" on call 6, submits within the grace, and its pass records `stop: budget`.
3. Open `harness/budget-scripted-lazy.json` → per pass: calls counted, the finalize-only switch time, and the list of files read (the coverage map pass 2 used).
4. Same run with `--max-cost-usd 0.0001` on the replayed `key:zai` reviewer → its pass ends `stop: cost` after the first priced turn; the report lists it as a budget stop, not a crash.
5. A `cli:grok` launch (`--plan --verbose`) shows `--max-turns` derived from the budget; a `cli:codex` session in the ACP test harness that ignores the finalize message is sent one "submit now" correction and is then cancelled at N + 3 → that pass records `stop: budget`, and if nothing was submitted the reviewer's surface is INCOMPLETE.

## Hackathon slice

- The `@hack` check covers steps 1–4 offline and step 5 with the mocked ACP harness.
- **Deferred:** `--max-cost-usd` price tables for providers that do not report cost (estimates are `H+`), the claude `--max-turns` probe if the flag is not accepted (the bridge counter is the gate anyway).

## Features covered

- [x] Budget fields, pass and usage schemas — W04-01
- [x] `--passes`, `--tool-budget`, `--max-cost-usd` flags and config — W04-02
- [x] Bridge budget counter per reviewer and pass, files-read map — W04-03
- [x] Finalize-only switch at N + grace 3 (`finalizeOnly`, R-15) — W04-04
- [ ] Exactly-P pass loop in the review phase — W04-05
- [ ] Pass brief roles discover / self-verify / deepen — W04-06
- [x] ACP-side call counting, "submit now" correction, cancel — W04-07
- [x] Grok `--max-turns`, Claude turn-flag probe — W04-08
- [x] API loop bound with forced submit on the last turn — W04-09
- [x] Scripted reviewers honour the budget — W04-10
- [x] Cost ceiling — W04-11
- [x] Price table for providers that do not report cost — W04-12
- [x] Raw per-pass usage records — W04-13
- [x] Plan output with budgets — W04-14
- [x] Health: budget stops vs failures — W04-15
- [x] Cross-family budget test matrix — W04-16
- [x] Docs and skill copies — W04-17
- [x] Wave check — W04-18 (`npm run check:w04`)

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W04-01 | Contract: change request for `run-config.schema.json` (`passes` 1–5, `toolBudget` 5–200, `grace` = 3 fixed, `debateToolBudget`, `maxCostUsd`) and `reviewer-report.schema.json` (`pass {index, role, calls, tokensIn, tokensOut, cost, costSource: reported|estimated|none, stop: submitted|budget|cost|error, startedAt, endedAt}`, `usage {passes[], totals}`); lead lands it as a pre-step | contract | S | H | W00-05..10 | `node --test shared/schemas/*.test.mjs` (or the W00 validator test) accepts a sample pass record with `stop: "budget"` and rejects `passes: 0` | ORCH §3, §6 |
| W04-02 | Flags `--passes P`, `--tool-budget N`, `--max-cost-usd X` in `bin/audit` / `bin/omniswarm` / `orchestrate.sh` and the same keys in `omniswarm.config.json`; defaults from OD-03; flags override config; written to `meta.json.budgets` | engine | S | H | W04-01 | `./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline --passes 0 --plan` exits 2 with "passes must be 1–5"; without flags the plan shows `passes 2, tool budget 40` | OD-03 |
| W04-03 | `bridge-budget.mjs` plugged into W02-03's `beforeCall(ctx, name)` hook (no dispatcher edit): count every `tools/call` except `submit_*` per (reviewer identity, surface, pass), persist to `harness/budget-<reviewer>.json` with atomic writes (separate from the 200-entry event log), record the repo-relative paths read by `read_file`/`search_code` | engine | M | H | W04-01 | `node --test scripts/bridge-budget.test.mjs`: 7 `read_file` calls and 1 submit on pass 1 → `calls: 7`, the submit not counted, `filesRead` lists the 7 paths; killing and restarting the bridge mid-pass keeps the count | ORCH §3 (gate 1) |
| W04-04 | Finalize-only switch: at `calls == N` set `ctx.finalizeOnly` for that identity and pass; inspection tools then return the tool result "budget exhausted: call submit_audit_report now (3 calls left)"; after N + 3 every non-submit call returns an error and the bridge writes `budget_exhausted` for the session owner; `submit_*` always works | engine | S | H | W04-03 | Bridge unit test with N=2: calls 3–5 return the finalize text, call 6 returns an error, `submit_audit_report` on call 7 is accepted and committed | ORCH §3, R-15, BEA P11 |
| W04-05 | Pass loop in the W01 review phase: each assignment runs passes `1..P` in order, **always all P** (an early submit ends that pass, not the loop); each pass is a new turn on the same session (`session/load` for ACP, continued transcript for API, next strategy step for scripted); the bridge identity carries `pass`; a pass's submission supersedes the previous one per surface in `submissions/<reviewer>-<surface>.json` while earlier passes are kept as `…-pass-<k>.json`; resume re-enters at the first pass without a committed submission | engine | M | H | W04-03 | Run step 2 of the demo → `submissions/` holds `scripted-baseline-s1.json` plus `scripted-baseline-s1-pass-1.json`, and `workers.json` shows `passesCompleted: 2` for every reviewer; kill the run after pass 1 and re-run with `--resume` → only pass 2 runs | ORCH §3 (Passes) |
| W04-06 | `review-briefs.mjs`: pass-role templates (Objective · Output schema · Tools · Boundaries): pass 1 **discover**; pass 2 **self-verify** — re-read every own citation, drop or fix what does not hold, then spend remaining calls on files absent from the reviewer's `filesRead`; pass 3+ **deepen** on own highest-severity leads; every template states the budget numbers and "submit no finding if none"; snapshot-tested | engine | S | H | W04-05 | `node --test scripts/review-briefs.test.mjs` → the pass-2 brief for a reviewer with `filesRead=[a.rs]` lists the surface's other files as unread, states "40 calls", and matches the snapshot | ORCH §5, HALL |
| W04-07 | ACP side (`agent-session.mjs`): count `tool_call` notifications per pass; when `end_turn` arrives without a submission send one "submit now" correction (reuse the existing 3-correction loop); on `budget_exhausted` from the bridge or past N + 3 counted calls send `session/cancel`; record `stop` | engine | M | H | W04-04 | `node --test scripts/agent-session.test.mjs` with a fake ACP agent that never submits → exactly one correction prompt, then `session/cancel`, and the pass record has `stop: budget`; a fake agent that submits after the correction → `stop: submitted` | ORCH §3 (gate 2) |
| W04-08 | CLI turn flags: `cli:grok` launches with `--max-turns <N + 3>`; probe `claude --max-turns 1 -p` once in `check-agents` and pass it to `cli:claude` / `cli:claude-zai` only if accepted (else rely on the bridge gate and say so in `--plan`); `cli:codex` and `cli:agy` rely on the bridge gate | engine | S | H | W04-02 | `./bin/audit run … --reviewers cli:grok:grok-4.7 --tool-budget 10 --plan --verbose` shows `--max-turns 13`; `check-agents` prints "claude --max-turns: supported" or "not supported (bridge gate only)" | provider research (local CLIs) |
| W04-09 | API loop bound: `maxTurns = N + 3` from the budget; on the last allowed turn send `tool_choice` forcing `submit_audit_report` (OpenAI-compat `{"type":"function","function":{"name":…}}`; Anthropic `{"type":"tool","name":…}` when W03-11 exists); a final turn that still does not submit ends `stop: budget` | engine | S | H | W04-04 | Replay a fixture where the model never submits with N=2 → request 5 carries the forced `tool_choice`, and the pass ends `stop: submitted` if the replay submits, `stop: budget` if not | ORCH §3 (gate 3) |
| W04-10 | Scripted reviewers honour the budget: `lazy` loops `read_file` until the bridge refuses, then submits in the grace window; `baseline` stays under budget; strategies read `pass` from the brief and change behaviour on pass 2 (`baseline` drops findings marked `selfVerifyDrop` in its answers) | engine | S | H | W04-04, W04-05 | Demo step 2 → `scripted-lazy` pass 1 `calls: 5`, `stop: budget`, submission present; `scripted-baseline` pass 2 has one finding fewer than pass 1 | ORCH §3 |
| W04-11 | Cost ceiling: sum `usage.cost` per reviewer when the provider reports it (OpenRouter), else `costSource: none`; crossing `--max-cost-usd` ends the current pass `stop: cost` and skips that reviewer's remaining passes (recorded, not a crash) | engine | S | H | W04-09 | Demo step 4 → the replayed reviewer's first pass ends `stop: cost`, pass 2 is recorded `skipped: cost_ceiling`, and the run still finishes | ORCH §3 (Cost ceiling) |
| W04-12 | Price table for providers without reported cost (`omniswarm.config.json` `prices.<provider>.<model> = {inPerMTok, outPerMTok}`) → `costSource: estimated` | engine | S | H+ | W04-11 | With a price of $1/MTok configured for `glm-5.3`, a replayed pass using 1000 prompt + 500 completion tokens records `cost: 0.0015, costSource: estimated` | ORCH §3 |
| W04-13 | Raw usage records: every pass writes `harness/usage/<reviewer>/<surface>-pass-<k>.json` (W04-01 `pass` schema), atomic; W05 derives `reviewers/<id>/usage.json` and `passes/` from these files | engine | S | H | W04-05, W04-07, W04-09 | After demo step 2, `ls harness/usage/*/` lists `s1-pass-1.json` and `s1-pass-2.json` per reviewer, each valid against the schema | ORCH §6 |
| W04-14 | `--plan` output: per reviewer `P passes × N calls (+3 grace)`, pass roles, worst-case total calls, the per-family gate used (bridge / ACP cancel / `--max-turns` / loop bound), the cost ceiling | engine | S | H | W04-02, W04-08 | Demo step 1 output contains a row `scripted-lazy  2 × 5 (+3)  discover, self-verify  max 16 calls  gate: bridge+loop` | ORCH §3 |
| W04-15 | Health (`verification-health.mjs`): a pass that stopped on `budget` or `cost` **with** a submission is complete and listed under "budget stops"; a pass that ended without any submission makes that reviewer × surface INCOMPLETE with reason `budget_exhausted_without_submission` | engine | S | H | W04-13 | Fixture run where `scripted:lazy` is configured to never submit → `report-health.json` `state: INCOMPLETE` with that reason; with the submitting `lazy` → COMPLETE and one "budget stop" entry | ORCH §3, R-03 spirit |
| W04-16 | Cross-family test matrix: one test per family — `cli` (fake ACP agent), `key` and `openrouter` (recorded HTTP), `scripted` — asserting **exactly P passes** and **≤ N + 3 counted calls** per pass for P ∈ {1, 2, 3}, N ∈ {2, 5} | test | M | H | W04-07, W04-09, W04-10 | `node --test scripts/budget-matrix.test.mjs` → 24 cases pass offline in under 60 s | owner ask, ORCH §3 |
| W04-17 | Docs and skill: replace "There is no runner time limit" (orchestrator prompt `docker-agent-orchestrator.mjs:162, :185`, `SKILL.md:114`) with the budget statement (passes, calls, grace, what happens at the limit); update `docs/how-it-works.md`; edit `skills/security-audit/SKILL.md` and copy byte-for-byte to `.claude/skills/security-audit/SKILL.md` | docs | S | H | W04-06 | `grep -rn "no runner time limit" scripts skills .claude/skills docs` finds nothing and `npm test` (skill-copy check) passes | R-20 |
| W04-18 | Wave check: `e2e/engine/w04.test.mjs` runs demo steps 1–5 offline; `npm run check:w04` (lead pre-step); `checks/w04-check.md` from the running result; tag `wave-04` | test | S | H | W04-01..11, W04-13..17 | `npm run check:w04 && node scripts/harness.mjs --self-test && npm test` → green on the merged wave branch | PRODUCT_WAVES §7 |

## Wave DoD

- For every family, every reviewer runs exactly P passes and no pass exceeds N + 3 counted bridge calls (W04-16 matrix green).
- `finalizeOnly` is set by the budget and nowhere else; `submit_*` is never blocked by the budget.
- Every pass has a raw usage record with a `stop` reason; budget stops with a submission are COMPLETE, budget stops without one are INCOMPLETE.
- No "no runner time limit" text remains; both skill copies are byte-identical.
- `node scripts/harness.mjs --self-test`, `npm test` and `npm run check:w04` pass offline.
- Tag `wave-04` on the merge commit.
