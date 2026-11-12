# W23 — Scheduler and provider health

> **Track:** Engine (E) with Lead (schemas) · **Tag:** `wave-23` · **Check:** `npm run check:w23` (= `node tools/wave-check.mjs 23`: the scheduler, retry, health, hedge, failover, straggler, middleware, chaos and `audit-process` tests and `tests/e2e/engine/w23.test.mjs`, then the coverage gate over this wave's modules)
> **Depends on waves:** W20 (the execute seam and its nesting order, the event log, the reserved flags, failure reasons and roles).
> **Soft dependencies:** none.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D6, D7 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M7`–`M9`, `M11`, `E21`, `E23`, `E25`–`E30`
> **Owned paths:** `engine/scripts/orchestrator-scheduler*.mjs`, `engine/scripts/orchestrator-retry*.mjs`, `engine/scripts/orchestrator-health*.mjs`, `engine/scripts/orchestrator-hedge*.mjs`, `engine/scripts/orchestrator-failover*.mjs`, `engine/scripts/orchestrator-straggler*.mjs`, `engine/scripts/orchestrator-mw-lanes*.mjs`, `engine/scripts/orchestrator-mw-retry*.mjs`, `engine/scripts/harness-chaos*.mjs`, `engine/scripts/audit-process.mjs`, `engine/scripts/orchestrator-review.mjs`, `engine/scripts/orchestrator-passes.test.mjs`, `engine/scripts/reviewer-plan-feature-scheduler.mjs`, `engine/scripts/harness-fixtures/limits/**`, `packages/schemas/**` (W23-01, lead), `docs/RULES.md` (append-only), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W23 key), `tests/e2e/engine/w23.test.mjs`, `docs/plan/checks/w23-check.md`
> **Not owned:** `engine/scripts/orchestrator-crosscheck.mjs` (W25), `debate-*.mjs` (W22, W25, W26: the existing debate stays serial, see Goal), `docker-agent-orchestrator.mjs` and `orchestrator-middleware.mjs` (W20), `orchestrator-progress.mjs` (W29).

## Goal

One place decides who runs what, for how long, and what happens when it fails. In run 2 Grok took 1817 s to review what Claude did in 316 s (`M8`), the debate ran one turn at a time (`M5`), and capacity in review and cross-check was about 53% used (`M9`). A usage limit took out Claude's cross-check, devil turns and general review in run 1.

This wave adds, all behind flags whose defaults reproduce today:

- **Lanes:** a width per provider, a priority queue, eligibility (a verifier is never the author's vendor), deadlines.
- **Failure classes** with different actions: transient, rate limit, usage limit, spend cap, auth, policy, timeout, invalid output.
- **Retries:** transport errors use the session's own recovery (the existing mechanism, at most 2) and rate limits wait inside the deadline; a **retry budget** counts every repeated attempt, whichever layer started it. Invalid output is not retried here (W22-06 owns that layer for debate roles and W28-05 for auditors, so there is one layer, `E25`).
- **Provider health:** a breaker, with parking until a stated reset, or "reset unknown" when the CLI gives none.
- **Straggler policy** for the review phase.
- **Hedging and failover helpers** for callers whose task can run on more than one vendor (W25 verifier batches, W26 judge seats).
- **A deterministic chaos harness** the next waves reuse as their proof.

The existing debate (`--verify debate`) stays serial; its replacement (W25, W26) gets its parallelism from lanes, so no legacy concurrency work is done here.

## Demo story (the check in words)

1. `node engine/scripts/harness-chaos.mjs --scenario skewed --seed 7` → a virtual-time table: three fake providers (latency 1×, 1×, 6×), 25 verification tasks each eligible on two vendors, serial wall time against lane wall time. Lanes finish in at most half the serial time. No real model is called.
2. `--scenario usage-limit --seed 7` → at virtual minute 12 one provider reports a usage limit with a reset time. It receives no task until the reset, its in-flight task fails over once to an eligible provider, and the run completes with every task done. With `--reset unknown` the provider stays parked and the run ends `parked` with that said.
3. `./bin/audit demo` path equivalent (scripted `runOrchestratedAudit`) with no new flag → the same artifacts as before this wave.
4. `./bin/audit run … --lane-width 2 --plan` → the plan shows lane width 2 as **active** (it was "reserved" after W20); the same flag on a real run is now accepted.
5. `--straggler-grace 300` in the skewed scenario → the run moves on 300 s after the other reviewers finish, the straggler's committed pass 1 is kept as a collected job with one pass, and its surface is listed as partial in the general review.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-20` is in `main`; the lead has landed W23-01.
- [ ] W23-00 is an owner-lane step run only after **OD-22** is recorded and the vendor terms are read and noted (OD-21 depends on them). It blocks only the live use of lane width above 1 and the replacement of W23-02's synthetic frames by recorded ones; the rest of the wave builds without it.
- [ ] OD-21 (concurrency per subscription CLI) is recorded for any live use of width above 1. Until it is, lane width stays 1 and only the chaos proofs run. The wave can land without OD-21, because the default is 1.
- [ ] No other open wave owns a listed path. `orchestrator-review.mjs` has had `crosscheckPhase` moved out by W20-05.

## Spike answers

Open until W23-00 is done. Record, per vendor (Claude, Codex, Grok): the vendor's stated terms for parallel sessions (link and quote), whether two simultaneous sessions in one account complete, any throttling or session limit observed with its **exact structured frame** (saved as a fixture for W23-02), and whether a usage-limit frame carries a parseable reset time.

## Features covered

- [ ] Contracts: W23-01
- [ ] Failure classes, scheduler, retry, health: W23-02, W23-03, W23-04, W23-05
- [ ] Middleware wiring: W23-06
- [ ] Straggler policy, hedging, failover: W23-07, W23-08, W23-09
- [ ] Chaos harness: W23-10
- [ ] Wave check and tag: W23-11
- [ ] Spike: W23-00

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W23-00 | Spike (owner lane, `OMNI_LIVE=1`, after OD-22):<br>• read and record each vendor's terms for parallel sessions<br>• run `./bin/audit check-agents --live --agents <vendor>` twice at once for Claude, Codex and Grok<br>• save any limit frame as a fixture | test | S | | W20 | `docs/plan/waves/W23-scheduler.md` (Spike answers), `engine/scripts/harness-fixtures/limits/**` | Run the two simultaneous `check-agents` sessions per vendor → "Spike answers" lists, per vendor, the terms with a link, both sessions completing or failing, the exact frame of any limit message (saved as a sanitised fixture), and whether it holds a reset time. Cost: six trivial sessions | `E28`, OD-21 |
| W23-01 | Lead contract:<br>• run-event kinds `lane_wait`, `retry`, `breaker`, `hedge`, `failover`, `straggler`<br>• failure-class enum `transient`, `rate_limit`, `usage_limit`, `spend_cap`, `auth`, `policy`, `timeout`, `invalid_output`, `cancelled` with actions `retry`, `wait`, `failover`, `park`, `voice`, `none`<br>• schema `provider-health`<br>• `scheduler` config gains the retry budget ratio | contract | S | | W20 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a `breaker` event with no `provider`, a class outside the enum, an action outside the list, and a retry ratio above 1 fail (negative ×4) | `E25` |
| W23-02 | Failure classes in `audit-process.mjs`: `classOf(failure)` returns `{class, retryable, action, retryAfterMs?, resetKnown}` from structured error frames only; a spend-cap 429 (no `retry-after`) is `spend_cap`; a CLI message that states a reset time is parsed into `retryAfterMs`, one that does not gives `resetKnown: false`. Fixtures are the frames of the saved runs (run 1's Claude usage limit) and the W23-00 frames; API-shaped frames are labelled synthetic | engine | S | | W23-01 | `engine/scripts/audit-process.mjs`, `engine/scripts/audit-process.test.mjs` | `node --test engine/scripts/audit-process.test.mjs` → the recorded usage-limit frame gives `usage_limit` and `park`; synthetic API frames (429 with `retry-after`, spend cap, 529, auth, policy) give the expected class and action; a log line saying "rate limit" with no frame gives `unknown` (negative); a message with no reset time gives `resetKnown: false` (negative: no invented time); every existing reason keeps its current class | `E28`, AGENTS.md |
| W23-03 | Scheduler core `orchestrator-scheduler.mjs`:<br>• a lane per provider with a width<br>• classes `critical`, `normal`, `sheddable`<br>• an eligibility predicate per task<br>• a deadline per task<br>• cancellation<br>• injected clock and random source | engine | M | | W23-01 | `engine/scripts/orchestrator-scheduler.mjs`, `engine/scripts/orchestrator-scheduler.test.mjs` | `node --test engine/scripts/orchestrator-scheduler.test.mjs` → over 200 seeded schedules: a lane never exceeds its width; FIFO within a class; `critical` starts before `sheddable`; a cancelled task frees its lane in one tick; a task eligible on two lanes runs on the first free one; a task past its deadline fails `deadline` and frees its lane; a task with no eligible lane is rejected at once with `no_eligible_lane` (negative) | `E29`, `E30` |
| W23-04 | Retry policy `orchestrator-retry.mjs`:<br>• transient transport errors: the session's own recovery through the `maxRecoveries` option W20-04 passes down, up to the configured attempts (the runner caps recoveries at 2, so at most 3 attempts)<br>• rate limit: wait the stated time if it fits the deadline, else fail over<br>• timeout: never the same provider again<br>• invalid output: classified `voice` and not retried here<br>• one retry budget of 10% of tasks per provider, counting every attempt beyond the first of any task, including a `-a2` session started by the voice layer (W22-06) | engine | M | | W23-02 | `engine/scripts/orchestrator-retry.mjs`, `engine/scripts/orchestrator-retry.test.mjs` | `node --test engine/scripts/orchestrator-retry.test.mjs` → under 30% injected transient failures (seeds 1–20) repeated attempts stay within 10% of tasks plus a burst of 2; attempts per task never exceed 3; a `usage_limit` is never retried; a `retry-after` longer than the remaining deadline is not waited for; an `invalid_output` result is returned unretried (negative); an `-a2` session counts against the budget (negative: the layers share one budget) | `E25`, `E21` |
| W23-05 | Provider health `orchestrator-health.mjs`:<br>• rolling window per provider; closed, open and half-open states<br>• `usage_limit` parks until the stated reset, or until the owner resumes when `resetKnown` is false<br>• one low-priority probe in half-open<br>• written to `harness/host/provider-health.json` (host-only; display and hint)<br>• feeds `run.providerFailures` | engine | M | | W23-02 | `engine/scripts/orchestrator-health.mjs`, `engine/scripts/orchestrator-health.test.mjs` | `node --test engine/scripts/orchestrator-health.test.mjs` → the breaker opens after N failures in the window; a half-open success closes it; a parked provider starts nothing before its reset; a park with an unknown reset is never lifted by the clock (negative); `--resume-from` with a hand-edited health file still reads the recorded structured reasons and ignores the file (negative) | `E27`, `E28`, AGENTS.md |
| W23-06 | Middleware `orchestrator-mw-lanes.mjs` and `orchestrator-mw-retry.mjs` put the scheduler, retry and health in front of every session, in the nesting W20-02 fixed. Width 1 and today's attempts are the defaults | engine | M | | W23-03, W23-04, W23-05, W23-10, W20 | `engine/scripts/orchestrator-mw-lanes.mjs`, `engine/scripts/orchestrator-mw-retry.mjs`, `engine/scripts/reviewer-plan-feature-scheduler.mjs`, their tests | `node --test engine/scripts/orchestrator-mw-lanes.test.mjs engine/scripts/orchestrator-mw-retry.test.mjs` → at the defaults a scripted run's artifacts equal today's except the event log (neutral); with width 2 the chaos provider shows two overlapping sessions of one reviewer and never three; the failure class from the structured result is on the `session_end` event; `--plan` lists lane width and retry attempts as active | `M9` |
| W23-07 | Straggler policy `orchestrator-straggler.mjs`, with `orchestrator-review.mjs` submitting jobs to lanes:<br>• with `--straggler-grace <seconds>`, after the last other reviewer finishes wait at most that long for a straggler<br>• then cut its running pass if a pass-1 submission is committed, **convert the cut into a collected job with one pass completed** (not a failure) and list its surface as partial<br>• the cut applies to the running job only; the provider's later surfaces still run<br>• a missing pass 2 is a coverage gap shown in the general review (as a partial surface is today) and does not by itself make the run INCOMPLETE | engine | M | | W23-06 | `engine/scripts/orchestrator-review.mjs`, `engine/scripts/orchestrator-straggler.mjs`, `engine/scripts/orchestrator-straggler.test.mjs`, `engine/scripts/orchestrator-passes.test.mjs` | `node --test engine/scripts/orchestrator-straggler.test.mjs engine/scripts/orchestrator-passes.test.mjs` → with latencies 1×, 1×, 6× and a 300 s grace the run moves on 300 s after the others, the straggler's job is `collected` with `passesCompleted: 1` and `partialSurfaces` names it (run 2's numbers: the others end at 676 s, so Grok at 1817 s is cut near 976 s); without the flag the run is as today (neutral); a straggler with no committed pass 1 is not cut (negative); a cut job's exit is not recorded as a failed auditor (negative) | `M8`, `M14` |
| W23-08 | Hedging `orchestrator-hedge.mjs`, a library for callers whose task any eligible vendor may answer (W26 judge seats): launch a backup on another eligible vendor after the role's p95 for that vendor (fixed 90 s until 8 samples), cancel the loser, cap hedges at 10% of tasks, never hedge onto an open breaker, record which vendor answered. Default off (`--hedge`) | engine | M | | W23-03, W23-05, W23-06, W23-10 | `engine/scripts/orchestrator-hedge.mjs`, `engine/scripts/orchestrator-hedge.test.mjs` | `node --test engine/scripts/orchestrator-hedge.test.mjs` → under a heavy-tail latency model (seeds 1–20) p99 task latency improves by at least 30% with at most 10% extra sessions (these bounds are the design spec; the model is ours); the loser is cancelled and the orphan detector finds none; the result names the vendor that answered (positive); a `sheddable` task, a task with one eligible lane, a hedge onto an open breaker, and a task marked vendor-specific are each not hedged (negative ×4); with the flag off nothing changes | `E26` |
| W23-09 | Failover helper `orchestrator-failover.mjs`: run a task on the best eligible vendor and, on class `timeout`, `usage_limit`, `spend_cap` or an open breaker, start it on the next eligible vendor with that vendor's own session identity; record `failover{from, to, reason}`; at most 2 failovers per task | engine | M | | W23-03, W23-05, W23-06, W23-10 | `engine/scripts/orchestrator-failover.mjs`, `engine/scripts/orchestrator-failover.test.mjs` | `node --test engine/scripts/orchestrator-failover.test.mjs` → a task whose first vendor reports `usage_limit` runs once on the second and the result names it; a third failure ends the task `failover_exhausted` (negative); a task with one eligible vendor is not failed over (negative); a failed-over task's session names are valid identities for each vendor (reuses W20-11's patterns) | `E27` |
| W23-10 | Chaos harness `harness-chaos.mjs`: seeded fake providers on a virtual clock; latency models, injected timeout, 429 with `retry-after`, `usage_limit` at a time with a known or unknown reset, invalid output and lost transport; a concurrency meter and an orphan-session detector | test | M | | W23-01 | `engine/scripts/harness-chaos.mjs`, `engine/scripts/harness-chaos.test.mjs` | `node --test engine/scripts/harness-chaos.test.mjs` → the same seed gives the same event sequence (equal sha); the clock advances only when every timer is pending; a session still running when the run ends is reported as an orphan (negative); the meter reports the maximum concurrent sessions per provider | — |
| W23-11 | Wave check:<br>• `tests/e2e/engine/w23.test.mjs`: skewed scenario, usage-limit scenario, retry budget, neutral defaults<br>• fill `tools/wave-checks.json` for W23<br>• `checks/w23-check.md`, tag `wave-23` | test | S | | W23-02..10 | `tests/e2e/engine/w23.test.mjs`, `tools/wave-checks.json` (the W23 key), `docs/plan/checks/w23-check.md`, `docs/RULES.md` (append-only: lanes, retry, parking) | `npm run check:w23` → green; `npm run check:all` → green; the neutral-defaults test compares artifacts with `OMNI_NO_MW=1` | — |

**Parallel groups:**
1. W23-00 (spike, owner lane), W23-01 (lead).
2. W23-02, W23-03, W23-10.
3. W23-04, W23-05 (both need W23-02).
4. W23-06.
5. W23-07, W23-08, W23-09.
6. W23-11.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `audit-process.test.mjs` (extended), `orchestrator-scheduler.test.mjs`, `orchestrator-retry.test.mjs`, `orchestrator-health.test.mjs`, `orchestrator-hedge.test.mjs`, `orchestrator-failover.test.mjs`, `orchestrator-straggler.test.mjs`, `orchestrator-mw-lanes.test.mjs`, `orchestrator-mw-retry.test.mjs`, `harness-chaos.test.mjs`, `orchestrator-passes.test.mjs` (extended), `tests/e2e/engine/w23.test.mjs`. A test file the plan names that does not exist yet is created by its issue.
- **Coverage:** the gate → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`audit-process` 100 / 100, `orchestrator-review` 98.3 / 92.9).
- **Determinism:** every property test names its seed range; a failing seed is printed.

## Analytics

- **Events:** `lane_wait{provider,waitMs}`, `retry{attempt,class,backoffMs}`, `breaker{provider,state,reason,until}`, `hedge{task,launched,winner,cancelled}`, `failover{task,from,to,reason}`, `straggler{reviewer,waitedMs,cut}`.
- **Metrics (defined in W21, null until the events exist):** `lane_utilisation{provider}` (busy time over wall time), `lane_wait_p95`, `retry_rate`, `retry_recovery_rate`, `breaker_open_minutes{provider}`, `hedge_rate`, `hedge_win_rate`, `failover_rate`, `straggler_cuts`, `wall_minutes_by_stage`, `orphan_sessions` (must be 0).
- **Artifacts:** `harness/host/provider-health.json`, events, scorecard (W21).
- **Watch:** `lane_utilisation` under 0.5 on a three-provider run means the queue is starved; `orphan_sessions` above 0 is a leak and fails the live proof.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P3 chaos | Skewed scenario, 25 tasks, three providers at 1×, 1×, 6×, every task eligible on two, seeds 1–20 | lane wall time at most 0.5 of serial; no lane over its width at any virtual instant; zero orphans |
| P3 chaos | Usage limit at a virtual time, with a known and an unknown reset | the parked provider starts nothing before a known reset and nothing at all with an unknown one; its in-flight task fails over once; every task completes or is listed `parked`; none is lost |
| P3 chaos | 30% transient failures | repeated attempts at most 10% of tasks plus the burst; attempts at most 3 |
| P3 chaos | Heavy-tail latency with hedging | p99 improves at least 30% at no more than 10% extra sessions (these bounds are the design spec; the simulation shows the code meets them) |
| P4 neutrality | Defaults, `runOrchestratedAudit` over the scripted fixture | artifacts equal today's except the event log; equal with `OMNI_NO_MW=1` |
| P5 live (owner lane, after OD-21 and OD-22) | One 3-vendor run on `fullstack-dapp` S3 at `--lane-width 2 --straggler-grace 300` | zero orphan sessions; no vendor error class above the baseline; wall time recorded against the 67 min of `M7`. No pass or fail on speed: it sets the number W30 compares |

## Risks and rollback

- **Vendor terms for parallel sessions.** Default width is 1; OD-21 decides more; W23-00 records what each vendor allows and the frames they return.
- **The straggler cut drops pass-2 findings** (`M14`: 0 to 7 seeded bugs per reviewer, 3 to 5 for the union). Default off; `bug_loss` in the scorecard is the guard; presets (W27) turn it on only with the owner's agreement.
- **Hedging doubles a turn's cost and lets the fastest vendor answer.** Default off, capped at 10% of tasks, only for tasks any vendor may answer, and the answering vendor is recorded.
- **Reset times for CLIs are prose.** A park with an unknown reset waits for the owner, not for the clock.
- Rollback: revert the wave merge, or run with `OMNI_NO_MW=1` and the defaults.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w23`, `check:all`, `check:v2` green; coverage gate green; neutral-defaults proof green.
- Spike answers recorded; every new flag is in `docs/how-it-works.md` and `--plan` prints it as active.
- `docs/RULES.md` rules for lanes, retries and parking appended.
- No file outside owned paths changed; no key, host path or `reports/` content committed.
- `checks/w23-check.md` written from the running result. Tag `wave-23` after the owner check.
