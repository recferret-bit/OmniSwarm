# W30 — Proof campaign and decision

> **Track:** Lead (tools, docs, spec) and Engine (E, `engine/eval/`) with the owner lane · **Tag:** `wave-30`, then `debate-v2` · **Check:** `npm run check:w30` (= `node tools/wave-check.mjs 30`: `tests/e2e/engine/w30*.test.mjs`, then `npm run check:v2`, then the coverage gate over `engine/eval/*.mjs`)
> **Depends on waves:** W20, W21, W22, W23, W24, W25, W26, W27, W28 and W29 (every wave of the series).
> **Soft dependencies:** none.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §6, §9, §10 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) §2.1 and §4 · [`DEBATE_V2_BASELINE.md`](../DEBATE_V2_BASELINE.md) · [`DEBATE_V2_PREREG.md`](../DEBATE_V2_PREREG.md)
> **Owned paths:** `engine/eval/campaign*.mjs`, `engine/eval/compare*.mjs`, `engine/eval/live.mjs` (the `--fixture` option only), `engine/eval/golden/heldout-*/**`, `engine/eval/build-expected.mjs` (held-out fixture rows only), `engine/eval/validate.mjs` (held-out fixture only), `engine/eval/replays/campaign-*/**`, `engine/omniswarm.config.example.json` (the `verify.mode` of the presets, only after gate G4), `docs/plan/DEBATE_V2_PREREG.md` (extension only; the thresholds block is frozen at G1), `docs/plan/DEBATE_V2_RESULTS.md`, `docs/plan/DEBATE_V2_BASELINE.md` (final), `docs/spec/ORCHESTRATION.md`, `docs/spec/DECISIONS.md`, `docs/RULES.md`, `docs/how-it-works.md`, `README.md` (eval table and operator section only), `tools/wave-checks.json` (the W30 key), `tests/e2e/engine/w30*.test.mjs`, `tests/e2e/engine/live-score.test.mjs`, `docs/plan/checks/w30-check.md`
> **Not owned:** every other `engine/scripts/**` file. This wave changes no behaviour except the `verify.mode` of two presets, and only on a pass.

## Goal

Decide, with a protocol fixed before the runs, whether the new pipeline earns its place, and say so plainly either way.

- **A pre-registration signed at G1** (arms, targets, repeats, metrics, thresholds, the analysis rule). This wave only **extends** it with the held-out fixture and the larger campaign; the thresholds block is frozen, and a test compares it with the tagged one.
- **A campaign tool** that prepares the runs in an interleaved order, records the environment, and refuses to run models without an owner-supplied ceiling; and a **comparison tool** with an exact paired permutation test and the per-pair table for every metric, not only the favourable ones.
- **A held-out fixture** the pipeline was not tuned on: a different product with at least 30 seeded bugs and 10 decoys across at least three stacks. Every earlier spike and proof used `fullstack-dapp` and its twin; the verdict must not rest on one codebase family.
- **A decision record:** gate G4 sets `verify.mode: ladder` in the `standard` and `deep` presets only for an arm that passes, or keeps `debate`, documents which threshold failed, and says what is next.

## Demo story (the check in words)

1. `node engine/eval/campaign.mjs docs/plan/DEBATE_V2_PREREG.md --dry-run` → the run list in interleaved order (`A0, A2, A3, A0, …` per target and repeat), each with its target, preset and command, the environment record it will write, and the total token and minute ceiling from the cost table. No model is called. `--run` without `OMNI_LIVE=1`, `--ceiling-tokens` and `--ceiling-minutes` is refused.
2. `node engine/eval/compare.mjs engine/eval/replays/fixtures/campaign-demo` → one table: every metric T1–T8, the per-pair differences, the exact permutation p-value, the threshold and a verdict `pass`, `fail` or `inconclusive`. Run it twice: identical output.
3. `node engine/eval/compare.mjs` on data missing one arm of one pair → a refusal naming the pair.
4. Edit a threshold in `DEBATE_V2_PREREG.md` and run `node --test tests/e2e/engine/w30-prereg.test.mjs` → it fails: the thresholds block no longer equals the one in the commit tagged `prereg-v2`.
5. After a pass, `./bin/audit run … --preset standard --plan` shows `verify: ladder`. After a fail, it still shows `debate` and `DEBATE_V2_RESULTS.md` names the threshold that failed. The `hosted` preset is unchanged either way (W27-06).

## Slice

All rows are blank in the `H` column. The live campaign is the owner lane (`DEBATE_V2.md` §9, O4).

## Wave DoR

- [ ] Every wave W20–W29 is tagged in `main`, or the owner has recorded which ones are out of scope and the pre-registration names the arms that exist.
- [ ] Gate G3 passed and `DEBATE_V2_BASELINE.md` is final; the thresholds T1–T9 are the ones signed and tagged `prereg-v2` at G1 (no change since).
- [ ] OD-22 (spend and schedule) is recorded with the W30-00 cost table accepted, and OD-24 (the held-out fixture) is recorded. Without OD-24, G4 can set no preset default.
- [ ] W30-00 answered below.
- [ ] The held-out fixture (W30-04, W30-05) has not been used in any spike, proof or run before the campaign (the pre-registration says so).

## Spike answers

Open until W30-00 is done. Record: the campaign's cost in tokens and wall time computed from the baseline scorecards (a range, with its assumptions), how it is split across days and quota resets, and which runs the owner starts.

## Features covered

- [ ] Cost and schedule: W30-00
- [ ] Pre-registration extension and its tag check: W30-01
- [ ] Campaign tool: W30-02
- [ ] Comparison tool: W30-03
- [ ] Held-out fixture and its live option: W30-04, W30-05, W30-06
- [ ] Execution and results (owner lane): W30-07
- [ ] Decision and preset flip: W30-08
- [ ] Legacy deprecation note: W30-09
- [ ] Wave check and tags: W30-10

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W30-00 | Spike (offline): compute the campaign's tokens and wall time from the baseline scorecards and `M10`, as a range, split it over days and quota resets, and write the owner's run list. The plan's own figure is a placeholder: 13 target-repeats (5 on the twin, 5 on `fullstack-dapp`, 3 on the held-out fixture) times 3 arms is 39 runs; A0 at about 67 minutes and 6.1 million cumulative tokens (`M7`, `M10`), A2 at 1 to 1.25 times the time and 1 to 1.5 times the tokens, A3 (the `deep` preset, 120-minute budget, 3 passes, 3 verifiers) at up to 2 hours and about 2 to 2.5 times the tokens, so about 55 to 59 hours and about 290 to 400 million cumulative tokens (these include cached reads, so billed cost is lower; the review stage is a lower bound) | test | S | | W21, W27 | `docs/plan/waves/W30-proof-campaign.md` (Spike answers) | Compute the cost from the baseline scorecards → "Spike answers" holds a cost table (per arm and in total, a range with assumptions), a day-by-day schedule and the list of runs the owner starts | `M10` |
| W30-01 | Pre-registration extension in `DEBATE_V2_PREREG.md`: the held-out fixture, N = 5 for the twin and `fullstack-dapp` and 3 for the held-out fixture, the interleave order, the re-run rule for a provider outage, the stopping rule, and the list of choices the spikes made. The thresholds block is untouched. A test checks it against the tag | docs | S | | W30-00 | `docs/plan/DEBATE_V2_PREREG.md`, `tests/e2e/engine/w30-prereg.test.mjs` | `node --test tests/e2e/engine/w30-prereg.test.mjs` → every section is present; the thresholds block equals the one at the commit tagged `prereg-v2`; that tag commit is an ancestor of the first ladder run bundle and of every campaign bundle; changing a threshold fails the test (negative); a bundle committed before the tag fails it (negative) | `E35` |
| W30-02 | `engine/eval/campaign.mjs`: from the pre-registration prepare the run directories in interleaved order, print each command, write an environment record (commit, `--version` of each CLI, model ids, preset, date, the `campaign-env` schema); `--resume` skips finished runs; `--run` executes them one after another and requires `OMNI_LIVE=1` and an owner-supplied `--ceiling-tokens` and `--ceiling-minutes` that match the accepted cost table (named so they cannot be mistaken for the engine's reserved `--max-tokens` and `--max-minutes`, which are not passed to any arm) | engine | M | | W30-01, W21 | `engine/eval/campaign.mjs`, `tests/e2e/engine/w30-campaign.test.mjs` | `node --test tests/e2e/engine/w30-campaign.test.mjs` → the order is `A0, A2, A3` repeated per target and repeat (interleaved, not blocked by arm); the environment record has the commit and the CLI versions and validates against `campaign-env`; `--run` without `OMNI_LIVE=1`, or without a ceiling, is refused (negative ×2); `--run` stops when the ceiling is reached (negative); `--resume` skips a finished run | `E35` |
| W30-03 | `engine/eval/compare.mjs`: paired differences by target and repeat; an exact paired sign-flip permutation test and the per-pair table; a verdict table for T1–T8 under the pre-registered rule (every pair clears the line on every main target, with the exact p-value reported beside it); all metrics shown; no interval is claimed from fewer than 5 pairs | engine | M | | W30-01, W21 | `engine/eval/compare.mjs`, `tests/e2e/engine/w30-compare.test.mjs` | `node --test tests/e2e/engine/w30-compare.test.mjs` → fixtures with known differences give the expected p-value and verdict (with 5 pairs the smallest attainable two-sided p is 1/16, so the p-value is descriptive and the decision is the unanimity rule); a null fixture (no real difference) is never `pass` (negative); the same input gives byte-identical output; data missing one arm of a pair is refused naming the pair (negative); a metric absent from one arm is listed, never dropped (negative) | `E35` |
| W30-04 | Held-out fixture, part 1: `engine/eval/golden/heldout-<name>/`, a different product from `fullstack-dapp` (not a tip jar), web2 and infra stacks, at least 15 seeded bugs and 5 decoys, with `expected.json` built from code needles; `validate.mjs` covers it | engine | M | | W30-00 | `engine/eval/golden/heldout-*/**`, `engine/eval/build-expected.mjs`, `engine/eval/validate.mjs`, `tests/e2e/engine/w30-heldout.test.mjs` | `node engine/eval/validate.mjs` → every range exists and is real code; no source is shared with another golden repo; `npm run eval:golden` includes it as a normal golden repo and the README table is regenerated | `E35` |
| W30-05 | Held-out fixture, part 2: web3 stacks (at least two of EVM, Solana, NEAR), at least 15 more seeded bugs and 5 more decoys, same rules | engine | M | | W30-04 | `engine/eval/golden/heldout-*/**`, `engine/eval/build-expected.mjs`, `tests/e2e/engine/w30-heldout.test.mjs` | `node engine/eval/validate.mjs` → at least 30 bugs and 10 decoys in total across at least three stacks, each range real code; `node engine/eval/build-expected.mjs --check` passes | `E35` |
| W30-06 | `live.mjs` accepts `--fixture <golden repo>`; prepare writes a target without its answer key and score reads that repo's `expected.json` | engine | S | | W30-05, W21 | `engine/eval/live.mjs`, `tests/e2e/engine/live-score.test.mjs` | `npm run eval:live:prepare -- --fixture heldout-<name>` → a target directory with no `expected.json`; `npm run eval:live:score -- <run>` scores against that fixture's key; an unknown fixture name is refused listing the available ones (negative) | — |
| W30-07 | Execute the campaign (owner lane O4): run the pre-registered list, commit sanitised bundles under `engine/eval/replays/campaign-<id>/` (OD-25), run `compare.mjs`, write `DEBATE_V2_RESULTS.md` with the pre-registration tag and hash, the table, the environment records, every deviation and rerun, and a plain reading | docs | M | | W30-02, W30-03, W30-06 | `engine/eval/replays/campaign-*/**`, `docs/plan/DEBATE_V2_RESULTS.md` | Run `node engine/eval/compare.mjs` over the campaign bundles → `DEBATE_V2_RESULTS.md` lists every threshold with its verdict and p-value, every run with its commit and CLI versions, each rerun and its reason, and each deviation from the pre-registration; the bundles pass the secret sweep and hold no host path | `E35` |
| W30-08 | Decision record and gate G4:<br>• for each arm that passes the primary thresholds (T1, T2, T4) on every main target with T5–T8 inside their guards, set `verify.mode: ladder` in the matching preset (`standard` for A2, `deep` for A3) in `engine/omniswarm.config.example.json`<br>• on a miss, keep `debate`, name the failed thresholds, and record next steps<br>• rewrite `docs/spec/ORCHESTRATION.md` §4 to match, update `docs/RULES.md`, copy the owner's quoted answer into `DECISIONS.md` for OD-18, regenerate the README eval table | docs | M | | W30-07 | `engine/omniswarm.config.example.json`, `docs/spec/ORCHESTRATION.md`, `docs/spec/DECISIONS.md`, `docs/RULES.md`, `README.md` (eval table and operator section) | `node --test tests/e2e/engine/w30-decision.test.mjs` → each preset's `verify.mode` equals what `DEBATE_V2_RESULTS.md` records for its arm; the `hosted` preset and the code default of `--verify` are unchanged (negative: the flip is a preset edit, never a code default); `npm run eval:golden` → the README table is current; `--verify debate` still works (negative: the legacy path is not removed) | `E1`, `E2` |
| W30-09 | Legacy note: `docs/RULES.md` and `docs/how-it-works.md` mark `--verify debate` as the legacy path with a proposed removal date and the condition for it. Nothing is removed in this wave | docs | S | | W30-08 | `docs/RULES.md`, `docs/how-it-works.md` | Run `grep -n "legacy path" docs/RULES.md docs/how-it-works.md` → the note is found in both; `./bin/audit run … --verify debate --plan` still prints a plan (negative: not removed) | — |
| W30-10 | Wave check:<br>• fill `tools/wave-checks.json` for W30<br>• `checks/w30-check.md`<br>• `check:v2` runs every wave check of the series<br>• tags `wave-30` and `debate-v2` | test | S | | W30-01..09 | `tests/e2e/engine/w30.test.mjs`, `tests/e2e/engine/w30-decision.test.mjs`, `tools/wave-checks.json` (the W30 key), `docs/plan/checks/w30-check.md` | `npm run check:w30` → green; `npm run check:v2` → green; `npm run check:all` → green | — |

**Parallel groups:**
1. W30-00 (spike).
2. W30-01, W30-04.
3. W30-02, W30-03, W30-05.
4. W30-06.
5. W30-07 (owner lane; days of wall time).
6. W30-08.
7. W30-09.
8. W30-10.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `tests/e2e/engine/w30-prereg.test.mjs`, `w30-campaign.test.mjs`, `w30-compare.test.mjs`, `w30-heldout.test.mjs`, `w30-decision.test.mjs`, `live-score.test.mjs` (extended), `tests/e2e/engine/w30.test.mjs`.
- **Coverage:** the gate → `campaign.mjs` and `compare.mjs` at least 95% lines, 85% branches, 90% functions; `live.mjs` not below baseline.
- **Statistics:** `compare.mjs` is tested against fixtures whose true differences are known and against a null fixture, which must come out `inconclusive` or `fail`, never `pass`.

## Analytics

- **The comparison table is the analytics product of the whole series:** T1–T8 plus every other scorecard metric, per arm, per target, per pair.
- **Also reported:** cost per kept finding, minutes per run, canonical tokens per run, pool spend, provider failure classes per arm, panel and effort settings.
- **Artifacts:** `DEBATE_V2_RESULTS.md`, the campaign bundles, the environment records.
- **Watch:** a metric that is better in the ladder only on the fixed twin and not on `fullstack-dapp` or the held-out fixture means the gain is fixture-specific and the decision says so.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tool tests above | green; coverage gate green |
| P2 | `compare.mjs` on known and null fixtures | expected p-values and verdicts; the null fixture never `pass` |
| P5 live (owner lane, gate G4) | The pre-registered campaign: arms A0, A2, A3; targets the fixed twin and `fullstack-dapp` S3 (5 repeats each) and the held-out fixture (3) | verdicts for T1–T8 per target, every deviation listed; the preset flip follows the rule in W30-08 and nothing else |

## Risks and rollback

- **Quota and time.** A cost table before the first run, a hard ceiling in `--run`, interleaved arms so a quota reset or a slow day hits every arm alike, a re-run rule for provider outages (both runs recorded).
- **Model or CLI drift mid-campaign.** Versions recorded per run; the interleaving spreads drift across arms.
- **Fitting thresholds to the result.** The pre-registration is tagged at G1, the thresholds block is frozen, and a test compares it. A threshold changed after the fact fails the wave check.
- **Too few repeats for statistics.** The decision rule is unanimity of pairs, the exact p-value is reported beside it, and no interval is claimed from fewer than 5 pairs.
- **The held-out fixture is built by the same people.** It is built last, never used before the campaign, and the pre-registration says so; it is still our own fixture and the result says that.
- **The owner is unavailable.** The wave can land its tools with the campaign pending: W30-07 and W30-08 then stay open and no preset changes.
- Rollback: the only behaviour change is the `verify.mode` of two presets; revert W30-08 or pass `--verify debate`.

## Wave DoD

- Acceptance passes for every issue; the campaign rows are marked done only with the results file in place.
- `check:w30`, `check:all`, `check:v2` green; coverage gate green.
- `DEBATE_V2_RESULTS.md` carries the pre-registration tag and hash, the full table and the plain reading; the decision matches the rule.
- `docs/spec/ORCHESTRATION.md`, `docs/RULES.md` and `docs/spec/DECISIONS.md` match the decision; the README eval table is regenerated.
- No file outside owned paths changed; no key, host path or `reports/` content committed.
- `checks/w30-check.md` written from the running result. Tags `wave-30` and `debate-v2` after the owner check.
