# W26 — Verification ladder II: refuter, one exchange and a judge panel

> **Track:** Engine (E) with Lead (schemas, spec) · **Tag:** `wave-26`, then `wave-26.2` · **Check:** `npm run check:w26` (= `node tools/wave-check.mjs 26`: the refute, exchange, panel, refuter-role, adjudicate and report-label tests and `tests/e2e/engine/w26*.test.mjs`, then the coverage gate over this wave's modules)
> **Depends on waves:** W25 (levels 0 and 1), W23 (failover and hedging for judge seats, the chaos harness).
> **Soft dependencies:** W24 (budgets), W27 (the judge pool). W26-05 reads `plan.pool` and treats a missing pool as empty; W27-09 wires it after this wave. W26-11 re-runs the budget scenario once W24 is in `main`, as `wave-26.2`.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D2, D3, D8 and §6 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M3`, `M4`, `M18`, `E1`, `E6`, `E7`, `E8`, `E13`, `E17`, `E18`, `E33`, `E34`, `E37` · [`docs/RULES.md`](../../RULES.md) rules 8–15
> **Owned paths:** `engine/scripts/debate-refute*.mjs`, `engine/scripts/bridge-tools-registry.test.mjs` (the role list), `engine/scripts/debate-exchange*.mjs`, `engine/scripts/debate-panel*.mjs`, `engine/scripts/bridge-tools-refuter.mjs`, `engine/scripts/orchestrator-briefs-refute.mjs`, `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-adjudicate.mjs`, `engine/scripts/debate-run.mjs`, `engine/scripts/orchestrator-phase-debate.mjs`, `engine/scripts/orchestrator-phase-adjudicate.mjs`, `engine/scripts/verify-and-adjudicate.mjs` (labels and appendix rows), `engine/scripts/verify-and-adjudicate-debate.mjs`, `engine/scripts/generate-html-report-evidence.mjs` (the `incompleteLabelOf` function only), `engine/scripts/report-contract.mjs`, `engine/scripts/reviewer-plan-feature-refute.mjs`, `engine/eval/policies/ladder-contested.mjs`, `engine/eval/scorecard-metrics/w26-*.mjs`, `engine/eval/spikes/w26-*.mjs`, `docs/RULES.md`, `docs/how-it-works.md` (append-only), `docs/spec/ORCHESTRATION.md` (lead, W26-09), `docs/spec/DECISIONS.md` (lead, W26-09), `packages/schemas/**` (W26-01, lead), `tools/wave-checks.json` (the W26 key), `tests/e2e/engine/w26*.test.mjs`, `docs/plan/checks/w26-check.md`
> **Not owned:** `engine/scripts/debate-rounds.mjs` (the legacy contested path stays for `--verify debate`), `report-section-*.mjs` and the report rendering (W29), `run-config.mjs`, `debate-plan.mjs` (W27-09 adds `plan.pool`), both skill copies (unchanged; a test asserts it).

## Goal

Level 1 says whether a finding survives a blind look. This wave decides what happens to the contested ones, and replaces the pieces the evidence does not support:

- **Level 2, the refuter:** a model that has not already supported the claim is told a control exists and must find it, with a search record. The existing citation relevance gate (`debate-citations.mjs`: within 3 lines or the same function within 80 lines) already rejects a quote about something else; this wave **tightens** it for a refutation: the control lines must be code in a guard or call position (not a comment, string or dead branch) inside the enclosing function or on a caller path, and a **critical** finding needs two independent anchored refutations. A third-party target can plant a look-alike guard, so plant-resistance fixtures are part of the tests.
- **Level 3, one exchange and a panel:** the author may answer a counted refutation with a fresh verified citation, or concede. No second round, no devil's advocate (`E1`, `E7`, `E13`, `E17`). Then a **panel** of up to three judges, each reading both orderings in separate sessions, rules first: the counted-turn rule fixes the statuses a judge may return, the panel picks among them, a tie is DISPUTED (`E8`, `E34`). Seats come from (1) vendors that did not author, verify or refute the cluster, (2) a pool member if configured, (3) a fresh session of an author vendor, flagged. With three vendors a one-vendor cluster has at most two cross-vendor seats, so a panel of two or one is normal and is recorded with its size and independence.
- **Level 4:** DISPUTED, with the open question written out for a human.
- **A refuted finding is kept** in an appendix with its refutation record; none is deleted (`E19`).
- **A run is labelled `PARTIALLY CHECKED`,** as an addition to and not a replacement for `INCOMPLETE VERIFICATION` (which means tests and scanners did not run), when fewer than 90% of clusters reach level 1 (OD-19).

## Demo story (the check in words)

1. A scripted ladder run with a refuter that cites an unrelated control, and one that cites a control inside a comment: the finding keeps its status, the row shows `refutation.anchored: false`, and the refutation is not counted.
2. The same run with an anchored control on a high finding: the author gets one exchange; with no fresh citation the row records a concession and the finding is REFUTED, stays in `findings-and-scores.json` with its refutation, and is listed in the appendix data. On a critical finding one anchored refutation is not enough.
3. A panel with one judge down: the remaining seats decide; the row shows `panel` with the size, each vote and each seat's independence. A tie gives DISPUTED with an `openQuestion`.
4. Swap the presentation order in the scripted judges: an order-inconsistent judge counts as an abstention, not a vote.
5. A run where 70% of clusters reach level 1 → the report carries `PARTIALLY CHECKED`; a run whose scanners did not run still carries `INCOMPLETE VERIFICATION`; a failed reviewer still makes the run INCOMPLETE.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-25` and `wave-23` are in `main`; the lead has landed W26-01.
- [ ] Gate G2 passed (the W25 live proof met T1, T2 and T4) and OD-18 and OD-19 are recorded.
- [ ] W26-00 answered below with an explicit **go** before W26-06 starts. It is an owner-lane step after OD-22.
- [ ] No other open wave owns a listed path. `debate-rounds.mjs` is not edited by this wave.

## Spike answers

Open until W26-00 is done. Record: of the 78 seeded bugs a live refuter was run against, how many received a verified control citation, how many of those the tightened anchoring rejected, how many survived it (the rate against the T2 cap), with and without the two-refuter rule for critical findings, and the line **go**, **go with two refuters for high too**, or **no-go**.

## Features covered

- [ ] Contracts: W26-01
- [ ] Refuter, its anchoring and plant resistance: W26-02
- [ ] Exchange: W26-03
- [ ] Panel rules and runner: W26-04, W26-05
- [ ] Spike gate: W26-00
- [ ] Phase wiring: W26-06
- [ ] Appendix and labels: W26-07
- [ ] Scenarios, docs, chaos: W26-08, W26-09, W26-10
- [ ] Budget second landing: W26-11
- [ ] Wave check and tags: W26-12

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W26-00 | Spike gate (owner lane, `OMNI_LIVE=1`, after OD-22, after W26-02): run a live refuter through `engine/eval/spikes/w26-refute.mjs` over the 78 seeded bugs (true findings). Count verified control citations, those the tightened anchoring rejects, and those that survive it. Decide go, go with two refuters for high too, or no-go | test | M | | W26-02, W25 | `engine/eval/spikes/w26-*.mjs`, `docs/plan/waves/W26-ladder-2.md` (Spike answers) | Run `node engine/eval/spikes/w26-refute.mjs --dry-run` → it prints the target list, the commands and the token estimate (about 2.5 million tokens, an estimate); after OD-22 the owner runs it live and "Spike answers" holds the three counts and the line. No-go: more than the T2 cap of seeded bugs end with a counted refutation | `E18`, `E22` |
| W26-01 | Lead contract:<br>• `refutation` `{controlCitation, mechanism, searchRecord[], anchored}`<br>• `exchange-turn`<br>• `panel-judgment` `{seat, independence, ordering, vote, quotes[]}`<br>• `adjudication` gains `refutation`, `panel`, `openQuestion`<br>• run-event kinds `refute_result`, `exchange`, `panel_vote`, `escalation`<br>• the label `PARTIALLY CHECKED` | contract | M | | W25 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a refutation with `anchored: true` and no citation, a panel with 0 seats, an unknown ordering, an unknown independence, and a row with `openQuestion` but a status other than DISPUTED fail (negative ×5) | `E8` |
| W26-02 | Refuter:<br>• `bridge-tools-refuter.mjs` and `orchestrator-briefs-refute.mjs`: "a control exists; find it; return the search record", no author reasoning, no vendor names<br>• `debate-refute.mjs`: pick a vendor that has not supported the claim, run, and apply the anchoring: the existing relevance gate plus the control lines being code in a guard or call position inside the enclosing function or on a caller path<br>• a critical finding needs two independent anchored refutations; `--refute off` skips the level | engine | M | | W26-01 | `engine/scripts/bridge-tools-refuter.mjs`, `engine/scripts/orchestrator-briefs-refute.mjs`, `engine/scripts/debate-refute.mjs`, `engine/scripts/debate-refute-anchor.mjs`, `engine/scripts/bridge-tools-registry.test.mjs` (the role list gains the new role), their tests | `node --test engine/scripts/debate-refute.test.mjs engine/scripts/bridge-tools-refuter.test.mjs` → a control in the enclosing function is `anchored`; a control on a caller path is `anchored`; a control in an unrelated function or file, in a comment, in a string, in a dead branch, or a look-alike name such as a planted `requireUser` stub are each `anchored: false` and not counted (negative ×5, with plant-resistance fixtures); one anchored refutation on a critical finding is not enough (negative); the brief holds no author reasoning or vendor name (negative); the refuter is never a vendor that supported the claim when another exists | `E18`, `E22` |
| W26-03 | Exchange `debate-exchange.mjs`: the author answers one counted refutation with a fresh verified citation or concedes. A flip without fresh evidence carries no weight, as today. No second round | engine | M | | W26-01 | `engine/scripts/debate-exchange.mjs`, `engine/scripts/debate-exchange.test.mjs` | `node --test engine/scripts/debate-exchange.test.mjs` → a defence with a fresh valid citation stands; one that repeats a line already in the cluster is discarded as `no_fresh_citation` (negative); no turn after the exchange is ever requested (negative); a concession ends the cluster as REFUTED | `E1`, `E7` |
| W26-04 | Panel rules `debate-panel-rules.mjs` (pure):<br>• each seat votes in two presentation orders, each in its own session; an inconsistent seat abstains<br>• the vote is restricted to the statuses `allowedVerdicts` permits<br>• majority wins; a tie is DISPUTED with an `openQuestion`<br>• prose is capped at 150 words after the verified quotes | engine | M | | W26-01 | `engine/scripts/debate-panel-rules.mjs`, `engine/scripts/debate-panel-rules.test.mjs` | `node --test engine/scripts/debate-panel-rules.test.mjs` → a truth table over 1 to 3 seats with votes, abstentions and inconsistent orders gives status and `openQuestion`; a vote outside the allowed set is clamped to the mechanical status (negative); two inconsistent seats of three leave the single remaining vote decisive and record panel size 1; property: permuting seats never changes the result | `E8`, `E34` |
| W26-05 | Panel runner `debate-panel.mjs`:<br>• seats from vendors that did not author, verify or refute the cluster, then `plan.pool ?? []`, then a fresh session of an author vendor flagged `same_vendor`<br>• both orders as separate sessions through the W23 failover and hedge helpers<br>• record the panel size and each seat's independence | engine | M | | W26-04, W23 | `engine/scripts/debate-panel.mjs`, `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-panel.test.mjs` | `node --test engine/scripts/debate-panel.test.mjs` → on three vendors a one-vendor cluster gets 2 cross-vendor seats, a two-vendor cluster gets 1 cross-vendor seat plus a flagged same-vendor seat, an all-vendor cluster gets only flagged same-vendor seats; a pool member fills a seat when `plan.pool` has one and the pool being empty is not an error (positive and negative); a seat that refuses at submit is retried once (W22) and counts as a vote or an abstention, never a crash; a down seat shrinks the panel and the record says so | `E8`, `M18` |
| W26-06 | Phase wiring under `--verify ladder`:<br>• the escalation queue goes to the refuter, then the exchange, then the panel<br>• an uncontested cluster gets no judge (the W22 rule)<br>• `--refute off` skips level 2 and sends escalated clusters straight to the panel<br>• no devil's advocate and no rounds 2 or 3<br>• `--verify debate` untouched | engine | M | | W26-02, W26-03, W26-05, W26-00 | `engine/scripts/orchestrator-phase-debate.mjs`, `engine/scripts/orchestrator-phase-adjudicate.mjs`, `engine/scripts/debate-adjudicate.mjs`, `engine/scripts/debate-run.mjs`, `engine/scripts/verify-and-adjudicate-debate.mjs`, `engine/scripts/reviewer-plan-feature-refute.mjs`, their tests | `node --test engine/scripts/debate-phases.test.mjs engine/scripts/verify-and-adjudicate-debate.test.mjs` → a ladder run produces no `devil-advocate` or `round-2` artifact; escalated clusters carry `refutation`, an exchange and a `panel`; with `--refute off` no refuter session starts and escalated clusters reach the panel (negative); `--verify debate` equals today's output (neutral) | `M3` |
| W26-07 | Appendix and labels:<br>• a REFUTED row stays in `findings-and-scores.json` with its `refutation` record<br>• `PARTIALLY CHECKED` when fewer than 90% of clusters reach level 1 (T7), shown in addition to `INCOMPLETE VERIFICATION` when scanners or tests did not run<br>• INCOMPLETE stays for review coverage and reviewer provider failures<br>• `report-health.json`'s `ladder` block lists depth counts and the label | engine | M | | W26-01, W25 | `engine/scripts/verify-and-adjudicate.mjs`, `engine/scripts/verify-and-adjudicate-debate.mjs`, `engine/scripts/generate-html-report-evidence.mjs` (`incompleteLabelOf` only), `engine/scripts/report-contract.mjs`, their tests | `node --test engine/scripts/verify-and-adjudicate.test.mjs engine/scripts/report-contract.test.mjs` → a refuted cluster is present with its record and not counted among open findings; 70% depth coverage gives `PARTIALLY CHECKED`, and a run whose scanners did not run also keeps `INCOMPLETE VERIFICATION` (positive); a failed reviewer still gives INCOMPLETE (negative); 95% depth coverage gives no `PARTIALLY CHECKED` | OD-19, `E19` |
| W26-08 | Scenarios with scripted voices: unanchored refuter, planted look-alike guard, anchored refuter with and without a fresh defence, panel with one seat down, order flip, a tie | test | M | | W26-06, W26-07 | `tests/e2e/engine/w26-ladder.test.mjs` | `node --test tests/e2e/engine/w26-ladder.test.mjs` → each of the seven scenarios ends in the status and fields written in the Demo story; the unanchored and the planted guards never lower a status (negative); the tie is DISPUTED with an `openQuestion` | `M3`, `M4` |
| W26-09 | Rules, spec and decisions: `docs/RULES.md` rules for levels 2 to 4, the appendix and the label (the devil's advocate stays described for `--verify debate`); `docs/spec/ORCHESTRATION.md` §4 updated (lead); `docs/spec/DECISIONS.md` rows for OD-18 and OD-19 flipped **only by copying the owner's quoted statement and date**. Both skill copies are not edited; a test asserts it | docs | M | | W26-06 | `docs/RULES.md`, `docs/spec/ORCHESTRATION.md`, `docs/spec/DECISIONS.md`, `docs/how-it-works.md`, `tests/e2e/engine/w26-skill.test.mjs` | `node --test tests/e2e/engine/w26-skill.test.mjs` → the skill copies are byte-equal and, when a `main` or `origin/main` ref exists locally, unchanged against the merge base (negative; skipped with a message in a shallow CI checkout where the existing `cmp` still runs); `grep -n "devil" docs/RULES.md` still finds the `--verify debate` description | AGENTS.md |
| W26-10 | Chaos scenarios with the W23 harness: a slow judge seat hedged to another vendor; a usage limit during the panel; skewed lanes | test | S | | W26-06, W23 | `tests/e2e/engine/w26-chaos.test.mjs` | `node --test tests/e2e/engine/w26-chaos.test.mjs` → the slow seat's cluster is decided by the hedge with at most 10% extra sessions and no orphan, and the row names the vendor that answered; a parked seat is filled by another eligible vendor or the panel shrinks and records it; every cluster has a status | `E26` |
| W26-12 | Wave check:<br>• fill `tools/wave-checks.json` for W26<br>• `checks/w26-check.md`<br>• the contested-path scenario policy over the run 2 clusters (P4: the bundles hold no recorded refuter or panel output)<br>• tag `wave-26` | test | S | | W26-02..10 | `tests/e2e/engine/w26.test.mjs`, `tools/wave-checks.json` (the W26 key), `docs/plan/checks/w26-check.md` | `npm run check:w26` → green; `npm run check:all` → green; `npm run eval:replay -- engine/eval/replays/run2 --policy ladder-contested` prints the escalation count and panel sizes **from scripted voices** (labelled P4, not a measurement of models) | `M3`, `M4` |
| W26-11 | Budget scenario (second landing, after `wave-24`): the envelope runs out mid-escalation | test | S | | W26-10, W24 | `tests/e2e/engine/w26-budget.test.mjs` | `node --test tests/e2e/engine/w26-budget.test.mjs` → clusters not yet escalated keep their level 1 status and a depth gap; the report is written; the labels follow W26-07 exactly | `E24` |

**Parallel groups:**
(Groups 3 onward need W26-02.)
1. W26-01 (lead).
2. W26-02, W26-03, W26-04, W26-07.
3. W26-00 (spike gate; owner lane), W26-05.
4. W26-06 (after the go line).
5. W26-08, W26-09, W26-10.
6. W26-12.
7. Second landing, after `wave-24`: W26-11.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `debate-refute.test.mjs`, `bridge-tools-refuter.test.mjs`, `debate-exchange.test.mjs`, `debate-panel-rules.test.mjs`, `debate-panel.test.mjs`, `debate-judge.test.mjs`, `debate-phases.test.mjs`, `verify-and-adjudicate.test.mjs`, `verify-and-adjudicate-debate.test.mjs`, `report-contract.test.mjs`, `tests/e2e/engine/w26*.test.mjs`. A test file the plan names that does not exist yet is created by its issue.
- **Coverage:** the gate → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`debate-judge` 95.7 / 94.6).
- **Neutrality:** `--verify debate` golden unchanged.

## Analytics

- **Events:** `refute_result{clusterId,anchored,vendor}`, `exchange{clusterId,fresh}`, `panel_vote{clusterId,size,votes,abstentions}`, `escalation{clusterId,from,to}`.
- **Metrics (module files in `scorecard-metrics/`):** `escalation_rate`, `refuter_anchored_rate`, `unanchored_refutation_rate`, `exchange_concession_rate`, `panel_size_mean`, `panel_same_vendor_share`, `panel_abstain_rate`, `disputed_rate`, `judge_sessions_per_run`, `true_bug_refuted_after_gate` (with the key).
- **Artifacts:** `debate/refutations.json`, panel records in `debate/adjudication.json`, scorecard blocks, `report-health.json` `ladder`.
- **Watch:** `unanchored_refutation_rate` above 0.3 means the refuter hunts for any quote; `panel_abstain_rate` above 0.25 means an ordering bias; `panel_same_vendor_share` high means the panel is too small and the pool is needed; `true_bug_refuted_after_gate` above the T2 cap fails the live proof.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P4 scripted | The seven scenarios in W26-08 and the three chaos scenarios in W26-10 (scripted voices: they show the plumbing, not model skill) | as written |
| P4 neutrality | `--verify debate` through `runOrchestratedAudit` | identical to before the wave |
| P4 policy | The run 2 clusters through `--policy ladder-contested` | prints escalation counts and panel sizes; no cluster loses its status |
| P5 live (owner lane, after OD-22, gate G3) | Arm A2 (`--verify ladder`, ladder I and II, default flags) against the baseline A0, 3 repeats on the fixed twin and on `fullstack-dapp` S3; A1 is reported alongside for comparison | T1–T8 as fixed at G1 (primary T1, T2, T4: every pair clears the line on both targets), plus `true_bug_refuted_after_gate` at most the T2 cap; `disputed_rate` recorded; judge sessions per run below the legacy count of `M4` |

## Risks and rollback

- **A refutation that is verified but irrelevant hides a real bug** (`E18`: filtering suppresses true findings). The tightened anchoring, plant-resistance fixtures, the two-refuter rule for critical findings, the spike, and the appendix (nothing is deleted) are the controls.
- **A panel adds cost.** It runs only on escalated clusters, three seats at most, each order in its own session, and a cluster with nothing to decide gets none (W22-08). Six judge sessions of about 150k tokens each (`M11`) per escalated cluster is the worst case.
- **Seats may share a vendor with the authors.** They are flagged `same_vendor`, and a tie among them is DISPUTED, not decided.
- **Judges near chance on hard pairs** (`E33`). The rules fix the allowed statuses first; the panel only chooses among them.
- Rollback: `--refute off --panel 1` gives ladder I behaviour (tested in W26-06), or revert the merge; `--verify debate` is untouched.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w26`, `check:all`, `check:v2` green; coverage gate green; neutrality proof green.
- Both skill copies unchanged and identical; `docs/RULES.md`, `docs/spec/ORCHESTRATION.md` and `docs/spec/DECISIONS.md` updated, with OD rows flipped only from the owner's statement.
- Spike go line present; gate G3 numbers recorded in `checks/w26-check.md`.
- No file outside owned paths changed; no key, host path or `reports/` content committed; no execution path added.
- Tag `wave-26` after the owner check; `wave-26.2` after `wave-24` lands.
