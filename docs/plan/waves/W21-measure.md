# W21 — Measure: scorecard, replay bundles, fixed twin and baseline protocol

> **Track:** Engine (E, `engine/eval/`) with Lead (schemas, pre-registration) · **Tag:** `wave-21` · **Check:** `npm run check:w21` (= `node tools/wave-check.mjs 21`: `tests/e2e/engine/w21*.test.mjs`, `npm run eval:replay -- engine/eval/replays/run2`, then the coverage gate over `engine/eval/*.mjs`)
> **Depends on waves:** W20 (the `run-event` contract, the event log, the coverage gate, the wave-check runner).
> **Soft dependencies:** W22 (the baseline campaign runs on the commit after W22 lands, so plumbing failures do not hide the behaviour being measured).
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D1 and §6 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M1`–`M19`, `E35`
> **Owned paths:** `engine/eval/**` (including new `scorecard.mjs`, `scorecard-metrics/**`, `policies/**`, `bundle.mjs`, `replay.mjs`, `canaries.mjs`, `baseline.mjs`, `spikes/**`, `replays/**`, `twins/**`), `tests/e2e/engine/w21*.test.mjs`, `tests/e2e/engine/live-score.test.mjs`, `docs/plan/DEBATE_V2_BASELINE.md`, `docs/plan/DEBATE_V2_PREREG.md`, `docs/how-it-works.md` (append-only), `engine/scripts/debate-fixtures.mjs` (the fixture roots list only, W21-05), `packages/schemas/**` (W21-01, lead), `tools/wave-checks.json` (the W21 key), `docs/plan/checks/w21-check.md`
> **Not owned:** `engine/scripts/**` (read-only for this wave: the scorecard reads artifacts and events, it does not edit the engine), except the one-line fixture-roots addition of W21-05.

## Goal

Every later claim in this series is about a number. This wave makes the numbers reproducible and honest:

- A **scorecard** per run: stages, providers, status transitions, quality against the answer key, with a plug-in directory so each later wave adds its metrics and replay policies as files.
- **Replay bundles** of the two live runs behind `DEBATE_V2_EVIDENCE.md` §2, small and field-allow-listed, so anyone can reproduce that table offline with no model. Run 2 is re-triaged by the current code; run 1 used the old clustering, so it is replayed from its recorded rows.
- A **fixed twin** of `fullstack-dapp` outside the `golden/*` discovery rule: the same product with at least K seeded bugs repaired. A finding on a repaired site is a known false positive at the exact right place, which the current fixture (about 94–97% true findings) cannot supply.
- **Canary** claim sets from the fixed twin and the decoys. They instrument ladder variants against each other (W25-05 injects them); the baseline arm is measured on natural false positives instead, because the legacy path has no injection point.
- A **baseline protocol** and a **pre-registration** (`DEBATE_V2_PREREG.md`) that fix thresholds, arms and the analysis rule from repeated runs before any ladder run is scored.

## Demo story (the check in words)

1. `npm run eval:replay -- engine/eval/replays/run2` → prints the table of `M1`–`M6`, `M12`, `M13`, `M18`, `M19` for run 2 (cross-check `refuted` 0 of 292, devil turns 10 / 2 / 0, clusters debated 13 of 24, …) in under 10 seconds, no model, no Docker. `… replays/run1` prints run 1's rows from its recorded clusters and adjudication.
2. `npm run eval:replay -- engine/eval/replays/run2 --policy partial-as-doubt` → the same table plus a diff: exactly the clusters that carry a `partial` cross-check verdict change status, and the count is printed.
3. `node engine/eval/scorecard.mjs <run-dir> --key engine/eval/golden/fullstack-dapp/expected.json` → stage table, provider table, transition matrix and the quality block with T1–T8's metrics. Without `--key` the quality block is `null`.
4. `npm run eval:live:prepare -- --twin fixed --repeat 3` → three target directories with distinct names and no answer key, and the three review commands.
5. `node engine/eval/baseline.mjs <score1> <score2> <score3>` → mean, standard deviation, min and max per metric and a **proposed** thresholds block, written into `DEBATE_V2_PREREG.md` for the owner to sign at gate G1. Two scorecards → a refusal.

## Slice

All rows are blank in the `H` column. The live baseline runs are an owner-lane step ([`DEBATE_V2.md`](../DEBATE_V2.md) §9, O1) that uses this wave's tools and is gated on OD-22, not part of this wave's check.

## Wave DoR

- [ ] `wave-20` is in `main`.
- [ ] The lead has landed W21-01.
- [ ] W21-00 spike answered below (bundle size, the sanitiser's patterns, K for the fixed twin, canary kinds).
- [ ] OD-25 (committing sanitised replay bundles) is recorded; without it W21-03 writes bundles to the ignored `engine/eval/runs/replays/` and the P2 proofs run only on the owner's host.
- [ ] `check:w21`, `eval:scorecard` and `eval:replay` are reserved (W20-01).
- [ ] The two live run folders are on the host that runs W21-03 (`engine/eval/runs/live/20261110-124221`, `20261110-192244`; gitignored and 150–180 MB each).

## Spike answers

Open until W21-00 is done. Record: bundle sizes for both runs; the patterns the sanitiser had to remove; K and the per-layer split of repairable bugs; which canary kinds survive review for realism.

## Features covered

- [ ] Contracts: W21-01
- [ ] Scorecard and its plug-in directories: W21-02
- [ ] Replay bundles and offline replay: W21-03, W21-04
- [ ] Fixed twin and canaries: W21-05, W21-09, W21-06
- [ ] Live-eval integration, baseline protocol, pre-registration: W21-07, W21-08
- [ ] Wave check and tag: W21-10
- [ ] Spike: W21-00

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W21-00 | Spike:<br>• extract both saved runs into bundles by hand and measure size<br>• list what the sanitiser must remove<br>• repair seeded bugs in a trial order and record the cost per bug, then choose K<br>• record the answers in this file | test | S | | W20 | `docs/plan/waves/W21-measure.md` (Spike answers) | On the host with the two saved runs, run the extraction by hand and the repair trial → "Spike answers" lists sizes (target under 2 MB per bundle), the removed patterns, K with its web2, web3 and infra split, and the canary kinds | `M14` |
| W21-01 | Lead contract: schemas `scorecard`, `replay-bundle` (a field allow-list: enums, ids and numbers, finding titles and quotes of the fixture only; a manifest with sha256 per file), `canary-set` and `campaign-env` | contract | S | | W20 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; invalid ones fail (missing sha, negative minutes, canary without `site`, unknown stage name, a bundle field outside the allow-list, a free-text field holding a path) | — |
| W21-02 | `engine/eval/scorecard.mjs`:<br>• input: `events.jsonl`, run artifacts, optional answer key<br>• blocks: stages, providers, transitions, quality, coverage<br>• every metric is a module in `scorecard-metrics/` so later waves add theirs as files<br>• T1–T8's metrics are defined here for **both** arms: `fp_catch_rate`, `true_bug_refute_rate`, `decoy_survival`, `bug_loss`, `wall_minutes`, `tokens_per_kept_finding`, `depth_coverage` (legacy depth is 1 when a non-author vendor gave a counted verdict), `unanswered_task_rate`<br>• plus metric modules for the events the series plans in W22–W24 (`refusal_rate`, `judge_success_rate`, `lane_utilisation`, `retry_rate`, `breaker_open_minutes`, `hedge_rate`, `failover_rate`, `straggler_cuts`, `spend_by_stage`, `budget_used_pct`, `resume_saved_minutes`), each `null` until a run has the events | engine | M | | W21-01, W20 | `engine/eval/scorecard.mjs`, `engine/eval/scorecard-metrics/w21-*.mjs`, `tests/e2e/engine/w21-scorecard.test.mjs` | `node --test tests/e2e/engine/w21-scorecard.test.mjs` → a committed fixture run gives the exact expected numbers for all eight metrics; a decoy reported by two vendors counts once; with no key the quality block is `null`, never zeros (negative); an event line of an unknown kind is counted under `other`, a line that is not valid JSON is reported and skipped, never a crash (negative); a module dropped into `scorecard-metrics/` appears in the output (plug-in); each planned W22–W24 metric returns `null` on a run without its events and a number on a fixture that has them | `M1`–`M14` |
| W21-03 | `engine/eval/bundle.mjs`: report folder → `replays/<id>/`<br>• claims per pass (pass 1 and final), cross-check verdicts, debate turns, trace, clusters, adjudication, per-session timings and usage (structured frames only; marked a lower bound for the old runs)<br>• validated against the `replay-bundle` allow-list schema<br>• sanitiser: absolute paths of any platform, emails, UUIDs, `keyFingerprint`, session logs dropped<br>• size cap 2 MB<br>• commit the two bundles (OD-25) | engine | M | | W21-00, W21-01 | `engine/eval/bundle.mjs`, `engine/eval/replays/**`, `tests/e2e/engine/w21-bundle.test.mjs` | `node engine/eval/bundle.mjs <run> --out engine/eval/replays/run2` → under 2 MB; `grep -rE -e '/Users/' -e '/home/' -e '/private/' -e keyFingerprint engine/eval/replays` → no match; `node --test` → a report whose finding quote holds a key-shaped string is refused by the secret sweep (negative); a field outside the allow-list fails validation (negative); the manifest hashes verify | `AGENTS.md` key policy |
| W21-04 | `engine/eval/replay.mjs`:<br>• run 2: re-run the current triage and rules over the bundle<br>• run 1: print its recorded clusters and adjudication (its clustering predates the same-site rule)<br>• `--policy <module>` applies a what-if rule from `policies/` to the recorded turns<br>• prints the `M`-table | engine | M | | W21-02, W21-03 | `engine/eval/replay.mjs`, `engine/eval/policies/partial-as-doubt.mjs`, `tests/e2e/engine/w21-replay.test.mjs` | `npm run eval:replay -- engine/eval/replays/run2` → `M1` 0 of 292, `M3` 10 / 2 / 0, `M5` 13 of 24, `M18` 24 / 11 / 28, exit 0 in under 10 s; `… replays/run1` → `M5` 8 of 25 from the recorded rows; `--policy partial-as-doubt` changes exactly the clusters carrying a `partial` (the test counts them); a bundle with one tampered byte fails closed (negative) | `M1`–`M6`, `M18`, `M19` |
| W21-05 | Fixed twin, part 1 (web2 and infra): `engine/eval/twins/fullstack-dapp-fixed/` is a copy of the fixture with minimal repairs of K/2 or more seeded bugs, decoys untouched; `expected.json` lists `canaries[]` (the original claim text and the repaired site); `validate-twin.mjs` checks it. The twin lives outside `golden/*`, so `run.mjs`, `validate.mjs` and the README eval table do not enumerate it; it is added to the fixture roots of `debate-fixtures.mjs` so the scripted judge may run on it (it is our own inert fixture) | engine | M | | W21-00 | `engine/eval/twins/**`, `engine/eval/validate-twin.mjs`, `engine/scripts/debate-fixtures.mjs` (the fixture roots list only), `tests/e2e/engine/w21-twin.test.mjs` | `node engine/eval/validate-twin.mjs` → every canary range exists and is real code; `isFixtureTarget` accepts the twin so scripted proofs may run on it, and still refuses any path outside OmniSwarm's own fixtures (negative); a test compares the twin to the original and finds changes only at the repaired sites (negative: a stray edit fails); `npm run eval:golden` output is unchanged (negative: the twin is not enumerated) | `M12` |
| W21-09 | Fixed twin, part 2 (web3: Solana, NEAR, EVM repairs): the rest of K, same rules | engine | M | | W21-05 | `engine/eval/twins/**`, `engine/eval/validate-twin.mjs`, `tests/e2e/engine/w21-twin.test.mjs` | `node engine/eval/validate-twin.mjs` → K or more canaries across web2, web3 and infra, each real code; the stray-edit test still passes | `M12` |
| W21-06 | `engine/eval/canaries.mjs`:<br>• canary claims from repaired sites, from the decoys' `claim` texts, and by relocating a true claim to a safe look-alike site<br>• deterministic by seed; claims shaped as reviewer findings<br>• `canaryCatch(results, set)`<br>• the set is an instrument for comparing ladder variants; it is **not** the baseline's T1 | engine | M | | W21-05, W21-09 | `engine/eval/canaries.mjs`, `tests/e2e/engine/w21-canaries.test.mjs` | `node --test tests/e2e/engine/w21-canaries.test.mjs` → the same seed gives the same set (equal sha); claims validate against the reviewer-report schema; no claim text contains "canary", "synthetic" or "test" (negative: not self-identifying); `canaryCatch` is 1.0 for a scripted perfect verifier and 0.0 for a rubber stamp | `M13` |
| W21-07 | `live.mjs`: `prepare --twin fixed --repeat N` (run directories get a distinct suffix per repeat, the current stamp is to the second); `score` prints the scorecard and canary results | engine | S | | W21-02, W21-06 | `engine/eval/live.mjs`, `engine/eval/score.mjs`, `tests/e2e/engine/live-score.test.mjs` | `npm run eval:live:prepare -- --twin fixed --repeat 3` → three distinct target directories and no `expected.json` in any (`find` returns none), plus three printed commands; `npm run eval:live:score -- <bundle-run>` prints the scorecard block; `--repeat 0` is refused (negative) | — |
| W21-08 | `engine/eval/baseline.mjs`, `docs/plan/DEBATE_V2_BASELINE.md` and `docs/plan/DEBATE_V2_PREREG.md` (template):<br>• aggregate N scorecards: mean, sd, min, max per metric; refuse N below 3<br>• print a **proposed** thresholds block by the rule in `DEBATE_V2.md` §6.1 into the pre-registration<br>• the pre-registration holds arms, targets, repeats, the analysis rule and the choices the spikes made<br>• the owner-lane baseline campaign (O1) is run from this wave's check guide | engine | M | | W21-02 | `engine/eval/baseline.mjs`, `docs/plan/DEBATE_V2_BASELINE.md`, `docs/plan/DEBATE_V2_PREREG.md`, `tests/e2e/engine/w21-baseline.test.mjs` | `node --test tests/e2e/engine/w21-baseline.test.mjs` → three fixture scorecards give exact mean and sd; two are refused (negative); a metric with sd 0 falls back to its minimum-effect floor; proposed thresholds never loosen a regression guard; the generated PREREG has every section | `E35` |
| W21-10 | Wave check:<br>• fill `tools/wave-checks.json` for W21; the `eval:replay` command is listed only when OD-25 has put the bundles in git, otherwise it is an owner-host step in the check guide<br>• `checks/w21-check.md` (including the O1 steps)<br>• tag `wave-21` | test | S | | W21-02..09 | `tools/wave-checks.json` (the W21 key), `docs/plan/checks/w21-check.md` | `npm run check:w21` → green; `npm run eval:replay -- engine/eval/replays/run2` reproduces the run 2 `M`-table | — |

**Parallel groups:**
1. W21-00 (spike).
2. W21-01 (lead).
3. W21-02, W21-03, W21-05.
4. W21-04, W21-09, W21-08 (W21-09 follows W21-05 in the twin files; W21-04 follows W21-03; W21-08 follows W21-02).
5. W21-06.
6. W21-07.
7. W21-10.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `tests/e2e/engine/w21-scorecard.test.mjs`, `w21-bundle.test.mjs`, `w21-replay.test.mjs`, `w21-twin.test.mjs`, `w21-canaries.test.mjs`, `w21-baseline.test.mjs`, `live-score.test.mjs` (extended).
- **Coverage:** `npm run check:w21` runs the gate → `engine/eval/*.mjs` new modules at least 95% lines, 85% branches, 90% functions; `score.mjs` and `live.mjs` not below baseline.
- **Fixtures:** small committed run folders (events, adjudication, key slice) under `engine/eval/replays/fixtures/`, hand-sized so expected numbers can be checked by eye.

## Analytics

This wave defines the metrics every later wave reports. All come from the scorecard.

| Metric | Definition |
|---|---|
| `commit_rate{role,vendor}` | sessions that committed a valid submission over sessions started |
| `latency_p50_p95{role,vendor}` | `session_end.durationMs` percentiles |
| `tokens_per_session{role,vendor}` | mean of the canonical `usage.total` (input plus output, cache apart); `null` sessions excluded and counted |
| `stage_minutes`, `stage_tokens` | by phase |
| `transition_matrix` | cluster counts by status at triage → final status |
| `status_change_rate{stage}` | share of clusters whose status a stage changed |
| `fp_catch_rate` (**T1**) | claims that match a decoy or a repaired site in the key and end REFUTED or DISPUTED, or end not CONFIRMED where the legacy rules would have confirmed them from the same recorded turns, over such claims reported; measured on natural false positives in every arm. A pair in which either arm reported none is excluded; a target with fewer than 3 usable pairs makes T1 `inconclusive` there |
| `true_bug_refute_rate` (**T2**) | seeded bugs reported that end REFUTED or DISPUTED, over seeded bugs reported (narrowing to LIKELY is not counted here; `bug_loss` and the status transition matrix show it) |
| `decoy_survival` (**T3**) | decoys still open at the end over decoys reported |
| `bug_loss` (**T4**) | seeded bugs reported but not open at the end |
| `wall_minutes` (**T5**) | run wall time |
| `tokens_per_kept_finding` (**T6**) | total canonical tokens over findings open at the end; compared only within one panel and counter definition |
| `depth_coverage` (**T7**) | clusters at depth 1 or more over all clusters; legacy depth is 1 when a non-author vendor gave a counted verdict |
| `unanswered_task_rate` (**T8**) | tasks refused or unanswered over tasks |
| `canary_catch_rate` | canaries refuted or downgraded over canaries presented; ladder arms only |

Landing places: `scorecard.json` beside the run, a "Scorecard" block in `live-score.md`, `docs/plan/DEBATE_V2_BASELINE.md`.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P2 replay | `npm run eval:replay` over the two bundles | the numbers of `DEBATE_V2_EVIDENCE.md` §2 that the bundle can carry and that the evidence marks exact (`M1`–`M6`, `M12`, `M13`, `M18`, `M19`) are reproduced, by a test with the constants. `M8` and `M10` are not pinned |
| P4 fixture | Scripted perfect verifier and scripted rubber stamp over the fixed twin | catch rate 1.0 and 0.0; scorecard quality block valid |
| P5 live | None in this wave's CI check. The baseline campaign (owner lane O1, after OD-22) uses the tools: 3 repeats on `fullstack-dapp` S3 and 3 on the fixed twin, same commit, same panel | Sets thresholds and signs the pre-registration at G1; has no pass or fail |

## Risks and rollback

- **The fixed twin takes longer than planned.** The spike decides K; below 30 the canaries from decoys and relocation carry the proof and the twin shrinks to its repaired subset.
- **A bundle leaks a path, an email or a key shape.** The allow-list schema, the sanitiser and the secret sweep gate the commit; the bundle test fails closed.
- **Replay drifts from the live pipeline.** The replay reuses the engine's own `buildClusters` and rules modules, never a copy.
- **Natural false positives are few** (7–8 decoys reported per run). The baseline pools its repeats; the sample is small and the report says so.
- Rollback: delete `engine/eval/replays/**` and the twin. Nothing in `engine/scripts/` changed.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w21`, `check:all`, `check:v2` green; coverage gate green.
- `npm run eval:replay` reproduces the evidence table; the test pins only the numbers marked exact.
- `docs/how-it-works.md` (append-only) documents `--twin`, `--repeat` and the replay command.
- No file outside owned paths changed; no host path, key shape or `reports/` content in any committed bundle.
- `checks/w21-check.md` written from the running result, with the O1 steps and their cost. Tag `wave-21` after the owner check.
