# W28 — Discovery lenses and additional attempts

> **Track:** Engine (E) with Lead (schemas) · **Tag:** `wave-28` · **Check:** `npm run check:w28` (= `node tools/wave-check.mjs 28`: the lens, brief, pass, pass-loop, auditor-tool and review tests and `tests/e2e/engine/w28*.test.mjs`, then the coverage gate over this wave's modules)
> **Depends on waves:** W21 (scorecard and bundles to measure pass-level gains), W22 (the refusal record and its constants-only format), W23 (lanes, the straggler policy, the shedding class), W24 (the budget decides whether an extra attempt may start).
> **Soft dependencies:** W27 (presets switch lenses and extra attempts on).
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D1, D5 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M8`, `M14`, `M15`, `E4`, `E10`, `E35` · [`CLAUDE.md`](../../../CLAUDE.md) "Keep stack behavior consistent"
> **Owned paths:** `engine/scripts/reviewer-lenses*.mjs`, `engine/scripts/review-briefs.mjs`, `engine/scripts/review-passes.mjs`, `engine/scripts/reviewer-pass-loop.mjs`, `engine/scripts/bridge-tools-auditor.mjs` (recording a refusal only), `engine/scripts/orchestrator-review.mjs`, `engine/scripts/reviewer-plan-feature-discovery.mjs`, `engine/eval/scorecard-metrics/w28-*.mjs`, `engine/eval/spikes/w28-*.mjs`, `packages/schemas/**` (W28-01, lead), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W28 key), `tests/e2e/engine/w28*.test.mjs`, `docs/plan/checks/w28-check.md`
> **Not owned:** both skill copies (this wave changes briefs, not the skill, and a test asserts it), `reviewer-plan*.mjs`, `run-config.mjs`, `debate-*.mjs`, `stack-detect.mjs`.

## Goal

More attempts only help when they add something new. In both runs the second pass, the self-check of a reviewer's own citations, added 0 to 7 seeded bugs per reviewer (3 to 5 to the union) and removed none; decoys reported rose (`M14`). Three reviewers on one surface gave a union of 53 to 57 against 47 to 51 for the best one. Asking a model to reconsider with no new information does not help (`E4`); resampling raises recall but plateaus without a verifier (`E35`), and the ladder (W25, W26) is now the verifier.

- **Lenses:** with `--lenses auto`, pass 2 becomes a pass with a stated risk lens (money flows and state ordering, access control and admin keys, untrusted input to a sink, configuration, CI and secrets), chosen from the detected stack and layer, with a different lens for each reviewer where the lens list allows.
- **Resampling:** with `--extra-attempts N`, extra independent discovery passes on the highest-risk files, started only when the budget allows, shown no earlier findings so they do not anchor.
- **Retry with new information:** a pass that commits nothing is retried once with the tool's structured refusal, never by repeating the same ask.

Defaults are today's passes and briefs.

## Demo story (the check in words)

1. `./bin/audit run --repo engine/eval/golden/fullstack-dapp … --lenses auto --plan` → the plan lists, per reviewer, the pass roles (`discover`, then a lens by name). A Python-only repo lists no Solidity lens.
2. A scripted run with `--extra-attempts 1` and a roomy envelope → a `resample` pass on at most K files; with a tiny envelope the pass is skipped, the event says `budget`, and no session started.
3. `cat reports/<run>/harness/usage/<reviewer>/*-pass-2.json` → the usage row carries `role: lens` and the lens id.
4. A scripted reviewer whose first submit is refused by the auditor tool → one retry whose prompt carries the refusal text from the record. A reviewer that commits nothing with no refusal record is not retried.
5. The scripted orchestrated run with no flag (`runOrchestratedAudit`) → byte-identical briefs and findings.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-21`, `wave-23` and `wave-24` are in `main`; the lead has landed W28-01.
- [ ] W28-00 answered below. It is an owner-lane step after OD-22 and runs after W28-03 exists. If the lens arm fails its kill criterion, W28-02 and W28-03 shrink to the resample role and the lens flag is removed from the plan.
- [ ] No other open wave owns a listed path.

## Spike answers

Open until W28-00 is done. Record, for one fast reviewer on the fixed twin and `fullstack-dapp` S3: seeded bugs added and decoys added by (a) self-verify (baseline), (b) a lens pass, (c) a resample pass on the top-K risk files; tokens per new seeded bug; and the line **go**, **go for resample only**, or **no-go**.

## Features covered

- [ ] Contracts: W28-01
- [ ] Lenses and selection: W28-02
- [ ] Pass roles and briefs: W28-03
- [ ] Risk targeting and extra attempts: W28-04
- [ ] Retry with new information: W28-05
- [ ] Scheduling class and the straggler: W28-06
- [ ] Skill-unchanged proof and docs: W28-07
- [ ] Wave check and tag: W28-08
- [ ] Spike gate: W28-00

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W28-00 | Spike gate (owner lane, `OMNI_LIVE=1`, after OD-22, after W28-03): for one fast reviewer, run pass 2 as self-verify, as a lens pass and as a resample pass on the top-K risk files through `engine/eval/spikes/w28-lens.mjs`. Count seeded bugs and decoys each adds, and tokens per new seeded bug. Decide go, resample only, or no-go | test | M | | W28-03, W21 | `engine/eval/spikes/w28-*.mjs`, `docs/plan/waves/W28-discovery.md` (Spike answers) | Run `node engine/eval/spikes/w28-lens.mjs --dry-run` → it prints the arms, the target, the commands and the token estimate (three partial runs of one reviewer, an estimate); after OD-22 the owner runs it live and "Spike answers" holds the three arms and the line. No-go: the lens adds fewer new seeded bugs than the self-verify baseline of `M14`, or adds decoys above the baseline's `decoys_added_by_pass` | `M14`, `E10` |
| W28-01 | Lead contract:<br>• schema `lens` `{id, text, appliesTo:{layers, stacks}}`<br>• pass role enum gains `lens` and `resample` in the usage and pass records<br>• run-event kind `pass_role` | contract | S | | W21 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a lens with no `appliesTo`, a pass role `deepen2`, and a `pass_role` event with no reviewer fail (negative ×3) | — |
| W28-02 | Lenses `reviewer-lenses.mjs`: a lens list per layer and stack; deterministic selection from the detected stacks and from `--scope` (a lens of another layer is dropped, because the bridge refuses a finding that cites another layer first); a different lens per reviewer while lenses outnumber reviewers; absent ecosystems get none; every lens id is checked against the layer and surface tables of `audit-plans-data-surfaces.mjs` by a consistency test | engine | M | | W28-01 | `engine/scripts/reviewer-lenses.mjs`, `engine/scripts/reviewer-lenses.test.mjs` | `node --test engine/scripts/reviewer-lenses.test.mjs` → on `fullstack-dapp` the lenses cover web2, EVM, Solana, NEAR and infra; a Python-only fixture gets no Solidity, Solana or NEAR lens (negative); with `--scope web3` no infra lens is chosen (negative); 3 reviewers and 4 lenses give 3 distinct lenses; `--lenses off` gives none; an unknown lens id is refused (negative); the consistency test fails if a lens names a layer or surface the tables do not have (negative) | `CLAUDE.md`, AGENTS.md "Stack routing" |
| W28-03 | Pass roles and briefs:<br>• `passRole` returns `lens` for pass 2 when a lens is chosen, and `resample` for extra passes<br>• the lens brief names the lens and the files still unread<br>• the resample brief shows no earlier finding<br>• usage rows carry the role and lens id | engine | M | | W28-01 | `engine/scripts/review-briefs.mjs`, `engine/scripts/review-passes.mjs`, their tests | `node --test engine/scripts/review-briefs.test.mjs engine/scripts/review-passes.test.mjs` → with no flag the briefs are byte-identical to today's (golden); the lens brief holds the lens text and the unread file list; the resample brief holds no earlier finding title (negative); the usage row has `role` and `lens` | `E35` |
| W28-04 | Risk targeting and extra attempts in `reviewer-pass-loop.mjs`: rank files by the lead-scan risk, `resample` only the top K (default 10), run `--extra-attempts N` passes only when the budget's `canStart` allows | engine | M | | W28-01, W24 | `engine/scripts/reviewer-pass-loop.mjs`, `engine/scripts/reviewer-pass-loop.test.mjs` | `node --test engine/scripts/reviewer-pass-loop.test.mjs` → with `--extra-attempts 1` and a roomy envelope a resample pass runs on at most K files; with a tiny envelope it is skipped with reason `budget` and no session starts (negative); without the flag no extra pass (neutral); K is never exceeded | `E35` |
| W28-05 | Retry with new information:<br>• `bridge-tools-auditor.mjs` records a refusal in the W22 format, constants only (no behaviour change, no alias)<br>• a pass that commits nothing is retried once with a host-written line built from the record's constants<br>• no record means no retry; this is the one retry layer for auditors | engine | M | | W28-04 | `engine/scripts/bridge-tools-auditor.mjs`, `engine/scripts/reviewer-pass-loop.mjs`, their tests | `node --test engine/scripts/bridge-tools-auditor.test.mjs engine/scripts/reviewer-pass-loop.test.mjs` → a refused first submit gives one retry whose prompt holds the refusal text; a second refusal ends the pass with its gap; a pass that commits nothing and has no refusal record is not retried (negative); an alias on `submit_audit_report` is still refused (negative: auditors are not widened) | `E4` |
| W28-06 | Scheduling class: lens and resample tasks are `sheddable` for the scheduler, and the straggler cut covers them; pass 1 is never cut | engine | S | | W28-03, W23 | `engine/scripts/orchestrator-review.mjs`, `engine/scripts/orchestrator-review.test.mjs` | `node --test engine/scripts/orchestrator-review.test.mjs` → a straggler with a committed pass 1 and a running lens pass is cut at the grace and keeps pass 1; a straggler still in pass 1 is not cut (negative); a `critical` task starts before a queued `sheddable` resample | `E30` |
| W28-07 | Skill unchanged and docs: a test asserts both skill copies are untouched and identical; `docs/how-it-works.md` documents `--lenses` and `--extra-attempts` | docs | S | | W28-03, W28-04 | `docs/how-it-works.md`, `tests/e2e/engine/w28-skill.test.mjs` | `node --test tests/e2e/engine/w28-skill.test.mjs` → both skill copies are byte-equal and, when a `main` or `origin/main` ref exists locally, `git diff --quiet <merge-base> -- engine/skills .claude/skills/security-audit/SKILL.md` exits 0 (negative: the test fails if either copy changed on the wave branch; skipped with a message in a shallow CI checkout, where the existing `cmp` still runs); the doc names both flags | CLAUDE.md |
| W28-08 | Wave check:<br>• `tests/e2e/engine/w28.test.mjs`: lens selection, pass roles, resample budget gate, neutrality<br>• `check:w28`, `checks/w28-check.md`, tag `wave-28` | test | S | | W28-02..07 | `tests/e2e/engine/w28.test.mjs`, `docs/plan/checks/w28-check.md` | `npm run check:w28` → green; `npm run check:all` → green | — |

**Parallel groups:**
1. W28-01 (lead).
2. W28-02, W28-03, W28-04.
3. W28-00 (spike gate; owner lane), W28-05, W28-06.
4. W28-07.
5. W28-08.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `reviewer-lenses.test.mjs`, `review-briefs.test.mjs`, `review-passes.test.mjs`, `reviewer-pass-loop.test.mjs`, `bridge-tools-auditor.test.mjs`, `orchestrator-review.test.mjs`, `tests/e2e/engine/w28*.test.mjs`.
- **Coverage:** `npm run test:coverage -- w28` → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`review-briefs` 100 / 100, `review-passes` 100 / 80.0, `reviewer-pass-loop` 99.1 / 83.3, `orchestrator-review` 98.3 / 92.9).
- **Stack consistency:** the lens test reads the same stack detection the plan uses (`stack-detect.mjs`), so an ecosystem absent from the target never gets a lens.

## Analytics

- **Events:** `pass_role{reviewer,pass,role,lens}`.
- **Metrics:** `union_gain_by_pass_role` (new seeded bugs per pass role, needs the key), `decoys_added_by_pass`, `lens_hit_rate` (findings in the lens's class over findings in the pass), `resample_duplicate_rate`, `tokens_per_new_bug`, `passes_skipped_budget`.
- **Artifacts:** usage rows with `role` and `lens`, the scorecard (W21), the run bundle's per-pass claims.
- **Watch:** `resample_duplicate_rate` above 0.8 means the extra attempt finds what pass 1 found; `decoys_added_by_pass` above the guard means a lens invites false positives.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P2 replay | Pass-level gains from the two bundles | `union_gain_by_pass_role` for self-verify equals `M14` (0 to 7 per reviewer, 3 to 5 for the union) |
| P4 neutrality | No flag, `runOrchestratedAudit` over the scripted fixture | briefs, findings and usage rows identical to before |
| P4 selection | Lens tests | deterministic, no lens for an absent ecosystem |
| P5 live (owner lane) | Arms on the fixed twin and `fullstack-dapp` S3, 3 repeats: self-verify (baseline), lens, lens plus one resample | `union_gain` at least the self-verify baseline's mean; `decoys_added_by_pass` at most the baseline's plus its sd; `tokens_per_new_bug` at most 1.5 times the baseline's. A miss removes the lens or the resample from the presets, not from the code |

## Risks and rollback

- **A lens narrows recall.** It replaces only the self-verify pass, which `M14` shows adds little, and the spike and live proof compare them.
- **A lens invites false positives.** The ladder verifies what it finds, and `decoys_added_by_pass` is a watched metric.
- **Resampling repeats pass 1.** The brief hides earlier findings, clustering merges duplicates, and `resample_duplicate_rate` shows the waste.
- Rollback: the flags are off by default; revert the merge.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w28`, `check:all`, `check:v2` green; coverage gate green; neutrality and skill-unchanged proofs green.
- Spike go line present; `--lenses` and `--extra-attempts` documented and shown as active by `--plan`.
- No file outside owned paths changed; no key, host path or `reports/` content committed.
- `checks/w28-check.md` written from the running result. Tag `wave-28` after the owner check.
