# W06 — Orchestrator & Debate

> **Track:** Engine (E) · **Tag:** `wave-06` · **Check:** `npm run check:w06` (= `node --test scripts/debate-*.test.mjs scripts/orchestrator-*.test.mjs e2e/engine/w06.test.mjs`; the root script is added by the lead in the W06 pre-step) · **Fixture:** `eval/golden/` + `scripts/harness-fixtures/debate/`
> **Depends on waves:** W02 (read-only `/src` served by the bridge, per-role bridge tool files `scripts/bridge-tools-<role>.mjs`), W03 (family registry, the API tool loop, `scripted:*` reviewers), W05 (`reviewers/<id>/` folder, `usage.json`, the `report-contract.mjs` allow-list for new folders).
> **Soft dependencies:** W04 budget counters (when landed, debate turns use the bridge counter with `--debate-tool-budget`; until then W06-06 caps turns itself) · W07 renders `debate/` and `general-review.*` (W07 works from fixtures until this wave lands; this wave's e2e re-renders through W07 once both are in `main`).
> **Specs:** [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §0 (P1–P11), §2, §4, §5, §6, §7 · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-05, OD-14 · [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-10, R-18
> **Owned paths:** `scripts/debate-*.mjs` (+ tests), `scripts/orchestrator-briefs.mjs`, `scripts/orchestrator-resolve.mjs`, `scripts/orchestrator-phase-debate.mjs`, `scripts/orchestrator-phase-adjudicate.mjs`, `scripts/orchestrator-phase-general-review.mjs` (+ tests), `scripts/bridge-tools-debate.mjs`, `scripts/bridge-tools-orchestrator.mjs`, `scripts/crosscheck.mjs` (round-1 extension), `scripts/verify-and-adjudicate.mjs` (final-status integration; W01 has landed its refactor to an exported function), `scripts/harness-fixtures/debate/**`, `eval/**`, `e2e/engine/w06*`. Uses without owning: W01 phase registry (`scripts/orchestrator-phases.mjs`, this wave only **adds** phase files), W03 family registry, W05 `reviewers/` writer and report-contract allow-list, `cluster-findings.mjs` (read; a change goes through a change request to the lead).
> **Not owned (change requests to the lead):** `shared/schemas/**`, root `package.json`, both skill copies.

## Goal

After the per-model reviews, an **orchestrator model** takes the lead. It runs a fixed workflow in code (BEA P1):

1. Cluster the findings.
2. Skip debate for findings that several vendors agree on and whose evidence checks out.
3. Run **anonymized, citation-checked challenge / defend / rebut rounds**, with a hard cap and an early stop.
4. Have a **cross-family judge** adjudicate each disputed cluster from evidence only.
5. Write a **general review**.

Every step is a file, and every argument's `file:line` quote is checked mechanically. A failed step makes the run INCOMPLETE without hiding any per-model finding.

The **golden eval** decides whether debate earns its cost: it must beat union and majority vote (OD-14, P9).

## Demo story (the check in words)

1. Run `./bin/audit run --repo eval/golden/near-escrow --reviewers scripted:baseline,scripted:paranoid,scripted:wrong,scripted:lazy --orchestrator recommended --plan`. The plan prints the orchestrator it resolved and why, the alternate judge, debate rounds `2` (max `3`) and the debate cluster cap `25`.
2. Run the same command without `--plan` (`--orchestrator scripted:judge`, no Docker needed for the bundled fixture per OD-10). Look at the run folder:
   - `debate/clusters.json` lists every cluster. Clusters that ≥ 2 vendors reported with passing citations have status `AGREED` and no rounds.
   - The rest are ordered by `severityWeight × (1 + disagreement)`.
3. Open `debate/round-1/`:
   - Each file is named `Reviewer A.json`, `Reviewer B.json` and so on.
   - No file contains a model name, vendor or vote count.
   - Each cluster has exactly one `devil_advocate: true` argument.
   - `debate/anonymization.json` holds the seed and the map.
4. Open `debate/citations.json`. The `scripted:wrong` reviewer's arguments cite lines that do not contain the quote. They show `valid: false` and are listed as **discarded**.
5. Open `debate/round-2/`. The authors of disputed clusters defend or concede. `scripted:lazy` conceded without a new citation, so that verdict change is kept but marked `conformity_suspect: true`. A cluster with no verdict change in round 2 has no round-3 file (early stop).
6. Open `debate/adjudication.json`:
   - Each cluster has a `finalStatus` (`CONFIRMED | LIKELY | DISPUTED | REFUTED | INSUFFICIENT_EVIDENCE`), a judge vendor different from every author's vendor, and a rationale.
   - A cluster whose author shares the orchestrator's vendor names the alternate judge.
   - The seeded single-source true bug is `LIKELY`, not dropped.
7. Open `general-review.md`. It has an executive summary, a risk posture from the fixed enum, top findings with statuses, coverage and gaps, open disagreements, a per-reviewer contribution table, the methodology, and the sentence "Model agreement and passing checks do not certify security."
8. Kill the run during the debate phase (`OMNI_FAULT=debate-round-2`), then regenerate the report. `report-health.json` shows `state: INCOMPLETE` with a `stageFailures` entry `debate`, and every `reviewers/<id>/report.json` and its findings are still present.
9. Run `npm run eval:golden`. It prints, for **debate**, **union** and **majority vote**: recall, precision, decoy FP rate, dedup correctness, conformity rate (true findings lost in debate) and cost per confirmed finding, and writes `eval/RESULTS.md`.

## Hackathon slice

- **The hackathon check covers demo steps 1–9** with `scripted:*` reviewers. All of them run offline in CI.
- The **live** golden eval with the owner's real reviewers (W06-25) needs `OMNI_LIVE=1` and keys, and runs once, on D11–D12.
- **Deferred (`H+`):**
  - orchestrator merge suggestions (W06-12): deterministic clustering alone ships;
  - golden repos 7–10 (W06-22);
  - the LLM rubric judge on general reviews (W06-24).
- **Still true:** a run with `--debate-rounds 0` behaves exactly like today's crosscheck + adjudication. The legacy statuses `MODEL_ASSERTION | MODEL_AGREEMENT | UPHELD_REVIEW | PARTIAL_REVIEW | REFUTED_REVIEW` still appear in `findings-and-scores.json` next to `finalStatus`.

## Features covered

- [x] Schema additions for debate turns, adjudication, general review, run-config debate knobs — W06-01
- [x] Triage: clusters, `AGREED` skip, priority, cap, overflow as coverage gap — W06-02
- [x] Mechanical citation checker over read-only `/src` — W06-03
- [x] Seeded anonymization; `anonymization.json` hidden from judges — W06-04
- [x] Snapshot-tested brief templates (objective · output · tools · boundaries) — W06-05
- [x] Bridge role `debater` with `submit_debate_turn` — W06-06
- [x] Bridge role `orchestrator` with merge / adjudication / general-review submits, no `run_existing_tests` — W06-07
- [x] Round 1 challenge extends crosscheck with batching (R-10) — W06-08
- [x] Devil's advocate per cluster — W06-09
- [x] Rounds 2/3 defend/rebut with early stop — W06-10
- [x] Discard uncited arguments; `conformity_suspect` — W06-11
- [x] Orchestrator merge suggestions (H+) — W06-12
- [x] `--orchestrator <spec>|recommended` resolution in `--plan` — W06-13
- [x] Adjudicate phase with cross-family judge and alternate judge — W06-14
- [x] New final statuses mapped onto legacy ones; no silent drops; severity re-calibration — W06-15
- [x] General review phase + schema validation — W06-16
- [x] Stage failures → INCOMPLETE, per-model findings intact — W06-17
- [x] Full tracing (`debate/trace.jsonl`) — W06-18
- [x] Scripted debate strategies + `scripted:judge` so the phase runs offline — W06-19
- [x] Engine e2e — W06-20
- [x] Golden repos (6 in `H`, 4 more `H+`) — W06-21, W06-22
- [x] Eval runner with union and majority-vote baselines — W06-23
- [x] Rubric judge on general reviews (H+) — W06-24
- [x] Live eval + `eval/RESULTS.md` — W06-25
- [x] OD-14 default decision — W06-26
- [x] Wave check guide + tag — W06-27

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W06-01 | Contracts: change request to the lead for any fields missing from the W00 schemas.<br>`debate-round`: `{cluster, round, anon, verdict: upheld\|partial\|refuted\|insufficient_evidence, devil_advocate, citations[{file,startLine,endLine,quote}], argument, verdict_changed, conformity_suspect}`.<br>`adjudication`: `{cluster, finalStatus, legacyStatus, judge{spec,vendor,alternate}, severity, severityReason, rationale, rounds, discardedArguments}`.<br>`general-review`: risk-posture enum, contribution table, fixed sentence.<br>`run-config`: `debate{rounds, maxClusters, toolBudget, alternateJudge, seed}`.<br>Test-only validators in `scripts/debate-schema.test.mjs` | contract | S | H | — | `node --test scripts/debate-schema.test.mjs` → valid fixtures pass. A turn with no citation, a 4th round, or a risk posture `secure` each fail with a named error | ORCH §4, §4.4, §6 |
| W06-02 | `scripts/debate-cluster.mjs`: build `debate/clusters.json` from `cluster-findings.mjs` output. Status `AGREED` when ≥ 2 **vendors** reported and every citation is valid. Order the queue by `severityWeight × (1 + disagreement)`. Cap at `--debate-max-clusters` (default 25). Overflow keeps its legacy peer status and is written as a coverage gap | engine | M | H | W06-01, W06-03 | Unit test on a 30-cluster fixture → 25 queued in priority order, 5 listed under `coverageGaps` with reason `debate_cap`. A 2-vendor cluster with valid citations is `AGREED` with `rounds: 0` | ORCH §4.1 |
| W06-03 | `scripts/debate-citations.mjs`: mechanical checker. Read the cited range from the read-only `/src` through the bridge `read_file` (W02 roots; in demo mode, the bundled-fixture snapshot). Do a whitespace-normalized substring match of `quote`. Reject paths outside the snapshot. Write every check to `debate/citations.json` | engine | M | H | W06-01 | Unit test: an exact quote → `valid`. The same quote with tabs vs spaces → `valid`. Off by 10 lines → `invalid: quote_not_found`. `../etc/passwd` → `invalid: path_outside_snapshot` | ORCH §4.2, P5 |
| W06-04 | `scripts/debate-anonymize.mjs`: per-cluster relabel to `Reviewer A/B/C…` with a recorded seed. Shuffle the order and strip model, vendor, reviewer id and vote counts. Normalize text to the schema fields (no free-form headers). Write `debate/anonymization.json`, which is never passed to any brief | engine | S | H | W06-01 | Unit test: anonymize a cluster with 3 vendors twice with the same seed → identical output; a different seed → a different order. Grep the output for `claude\|codex\|grok\|glm\|qwen\|gemini` → no match | ORCH §4.2, P8 |
| W06-05 | `scripts/orchestrator-briefs.mjs`: templates for review pass k, challenge, devil's advocate, defend, rebut, judge, general review and merge suggestions. Each has **Objective · Output schema · Tools and sources · Boundaries**: one cluster only, cite `file:line` + quote or be discarded, "insufficient_evidence is allowed", "no new findings" for the general review, the budget number. Snapshot-tested | engine | M | H | W06-01 | `node --test scripts/orchestrator-briefs.test.mjs` → 8 snapshots match. Removing the "Boundaries" block from any template fails the structural test that requires all four headings | ORCH §5, P3 |
| W06-06 | `scripts/bridge-tools-debate.mjs`: bridge role `debater` with read tools (`get_audit_context`, `read_file`, `search_code`, `list_files`) and `submit_debate_turn`. The submit validates the schema, requires ≥ 1 citation unless the verdict is `insufficient_evidence`, and refuses a second submit for the same `(cluster, round, anon)`. Turn cap `--debate-tool-budget` (default 12): use the W04 counter if present, else a local counter in `harness/debate-budget-<anon>.json` | engine | M | H | W06-01 | Bridge unit test: `tools/list` for role `debater` → exactly 5 tools, no `run_existing_tests`. The 13th inspection call answers "budget exhausted: call submit_debate_turn now" | ORCH §3, §4.2, P11 |
| W06-07 | `scripts/bridge-tools-orchestrator.mjs`: bridge role `orchestrator` with read tools + `submit_merge_suggestions`, `submit_adjudication`, `submit_general_review`, each schema-validated and committed hash-first like `audit-submission.mjs`. No `run_existing_tests`, no `submit_audit_report` | engine | S | H | W06-01 | Bridge unit test: role `orchestrator` → `run_existing_tests` absent. `submit_general_review` with a finding that is not in `adjudication.json` → rejected `new_finding_in_general_review` | ORCH §4.5, §5 |
| W06-08 | Round 1 = challenge, extending `scripts/crosscheck.mjs`: only non-authors of a cluster review it. Clusters go in **batches** (`--debate-batch` default 5 clusters per turn). Each batch is committed on its own, so a failed batch loses only itself (fixes R-10). Write `debate/round-1/<anon>.json`. Keep writing the legacy `auditors/crosscheck-<agent>.json` so old report code still works | engine | M | H | W06-04..06 | Scripted run with 12 queued clusters and `--debate-batch 5` → 3 batches per challenger. Inject a failure in batch 2 → batches 1 and 3 are committed, and batch 2's clusters show `challenge_missing` in `clusters.json` | ORCH §4.2, R-10 |
| W06-09 | Devil's advocate: for each cluster, pick one non-author challenger with the recorded seed, and give it the devil's-advocate brief variant (argue the strongest false-positive case). Mark its argument `devil_advocate: true` | engine | S | H | W06-08 | Scripted run → every debated cluster in `round-1/` has exactly one argument with `devil_advocate: true`, and that reviewer is not an author of the cluster | ORCH §4.2 |
| W06-10 | Rounds 2 and 3 in `scripts/orchestrator-phase-debate.mjs` (registered in the W01 phase registry).<br>Round 2: authors see the anonymized challenges and defend with **new** citations or concede.<br>Round 3 (rebut): only for clusters where a verdict changed in round 2.<br>`--debate-rounds R` (default 2, max 3; values > 3 are rejected at plan time).<br>Early stop per cluster after a round with zero verdict changes | engine | M | H | W06-08 | Scripted run with `--debate-rounds 3` → a cluster with no change in round 2 has no `round-3` entry. A cluster where `scripted:paranoid` flipped gets a round-3 entry. `--debate-rounds 4` → plan error `debate_rounds_max_3` | ORCH §4.2, P2 |
| W06-11 | Evidence rules in `scripts/debate-rules.mjs`.<br>An argument with no `valid` citation is **discarded**: kept in `adjudication.json.discardedArguments`, never shown to the judge.<br>A verdict change without a new valid citation is kept but marked `conformity_suspect: true` and given zero weight for the judge brief | engine | S | H | W06-03, W06-10 | Scripted run → `scripted:wrong`'s arguments appear only under `discardedArguments`. `scripted:lazy`'s round-2 concession has `conformity_suspect: true` and is absent from the judge brief snapshot | ORCH §4.2, P5, P8 |
| W06-12 | Orchestrator merge suggestions: one orchestrator call over the cluster list (titles + citations only) via `submit_merge_suggestions`. Apply a merge only if both members cite the same file. Log each with its one-line reason in `debate/merges.json` | engine | S | H+ | W06-02, W06-07, W06-13 | Scripted orchestrator proposes 3 merges, one across different files → 2 applied, 1 rejected `different_file`. All 3 are in `merges.json` with reasons | ORCH §4.1 |
| W06-13 | `scripts/orchestrator-resolve.mjs`: `--orchestrator <spec>\|recommended` and `--alternate-judge <spec>`. Validate the spec through the W03 family registry. `recommended` = first available of `cli:claude:opus` → `key:anthropic:claude-opus-5-5` → `openrouter:anthropic/claude-opus-5.5` → `key:zai:glm-5.3` → `scripted:judge` (demo only; refused for real targets). Default alternate = strongest available reviewer of another vendor. `--plan` prints both with the reason | engine | S | H | W06-01 | With only `OPENROUTER_API_KEY` set and no claude CLI → `--plan` prints `orchestrator: openrouter:anthropic/claude-opus-5.5 (recommended: claude CLI not found, ANTHROPIC_API_KEY unset)`. `scripted:judge` with `--github owner/repo` → refused `scripted_judge_demo_only` | ORCH §4.5, OD-05 |
| W06-14 | `scripts/orchestrator-phase-adjudicate.mjs`: one judge call per debated cluster. The judge gets the claim, verified quotes and valid arguments only (no vendors, model names or tallies).<br>**Cross-family rule:** the judge's vendor ≠ every author's vendor, else use the alternate judge; if that also conflicts, `finalStatus: DISPUTED` with reason `no_independent_judge`.<br>One retry on transport failure only. Write `debate/adjudication.json` | engine | M | H | W06-05, W06-07, W06-13 | Scripted run where the orchestrator is vendor `anthropic` and cluster 3 has an `anthropic` author → cluster 3's `judge.alternate: true` with a non-anthropic vendor. The judge brief snapshot contains no reviewer ids | ORCH §4.3, P7, P8 |
| W06-15 | Final statuses in `verify-and-adjudicate.mjs`: `AGREED`, `CONFIRMED`, `LIKELY`, `DISPUTED`, `REFUTED`, `INSUFFICIENT_EVIDENCE`.<br>Map each to the legacy status, and keep `status` for back-compat.<br>`findings-and-scores.json` gains `finalStatus`, `judge`, `debateRounds`, `severityReason`.<br>**No silent drop:** a single-source finding becomes `REFUTED` only with ≥ 1 valid refuting citation, else `LIKELY`.<br>Scores use `finalStatus` multipliers | engine | M | H | W06-01, W06-14 (reads `discardedArguments` per the W06-01 schema; W06-11 fills it) | Golden fixture with a seeded true bug found by one reviewer and refuted only by uncited arguments → `finalStatus: LIKELY` and it appears in the report. An old run folder without `debate/` still validates with legacy statuses only | ORCH §4.3 |
| W06-16 | `scripts/orchestrator-phase-general-review.mjs`: one orchestrator call reading paths to `adjudication.json`, coverage and health, plus W05 `usage.json` per reviewer. Writes `general-review.json` (schema-validated) and `.md`:<br>• executive summary<br>• risk posture `critical-exposure\|high-risk\|moderate\|low-observed`<br>• top findings with statuses<br>• per-surface coverage and gaps<br>• open disagreements<br>• contribution table (unique confirmed, refuted, budget used, cost)<br>• methodology<br>• the fixed sentence | engine | M | H | W06-05, W06-07, W06-13 | Scripted run → `general-review.md` contains the fixed sentence verbatim and one contribution row per reviewer id. A scripted orchestrator that adds an unknown finding → submit rejected and the stage marked failed | ORCH §4.4 |
| W06-17 | Stage failures: a failure in debate, adjudicate or general-review → `meta.stageFailures[]` + `report-health.errors[]` → `state: INCOMPLETE`. Per-model `reviewers/*` and legacy peer statuses are untouched. `OMNI_FAULT=<stage>` fault-injection hook (tests only) | engine | S | H | W06-10, W06-14, W06-16 | `OMNI_FAULT=general-review` scripted run → health `INCOMPLETE` with `stageFailures: ["general-review"]`, and `reviewers/index.json` lists every reviewer with findings | ORCH §6, P10 |
| W06-18 | Tracing in `debate/trace.jsonl`: one line per call with brief template id + hash, anon id (never the model in judge-visible files), tool calls, tokens, cost, stop reason, verdict deltas.; `debate/` and `general-review.*` are already accepted by W05-02's allow-list | engine | S | H | W06-10, W06-14 | Scripted run → `trace.jsonl` has one `judge` line per debated cluster and one `general_review` line. `report-contract` validation of the run → no `unexpected_artifact` errors | ORCH §6, P10 |
| W06-19 | Scripted debate strategies on the W03 `scripted:*` family:<br>• `baseline`: upholds with correct citations<br>• `paranoid`: refutes, then flips in round 2<br>• `wrong`: cites wrong lines<br>• `lazy`: concedes without evidence<br>• `scripted:judge`: deterministic rule — evidence-weighted, ties → `DISPUTED`<br>Fixtures in `scripts/harness-fixtures/debate/` | test | M | H | W06-06, W06-07 | `node --test scripts/debate-scripted.test.mjs` → the four strategies produce the expected verdict sequences on the fixture, with no network and no Docker | ORCH §1 (`scripted`), §7 |
| W06-20 | Engine e2e `e2e/engine/w06.test.mjs`: scripted run on `eval/golden/near-escrow` through all phases. Asserts demo steps 2–8 on files (clusters, anonymization, citations, rounds, early stop, adjudication, general review, fault-injected INCOMPLETE) | test | M | H | W06-02..11, W06-13..19 | `node --test e2e/engine/w06.test.mjs` → all 7 assertions pass in < 2 min on a laptop without provider keys | — |
| W06-21 | `eval/golden/` part 1: 6 small repos:<br>• `near-escrow` (Rust near-sdk)<br>• `solana-vault` (Anchor)<br>• `ts-api` (Express/Fastify)<br>• `py-fastapi`<br>• `near-client` (near-api-js wallet signing)<br>• `rust-crate`<br>Each has `expected.json` (seeded bugs: file, line range, class) and ≥ 2 **decoys** (looks vulnerable, is safe, with the reason). No secrets, no live URLs | test | M | H | — | `node eval/validate.mjs` → 6 repos, each with ≥ 2 bugs and ≥ 2 decoys, every `expected.json` line range points at existing lines | ORCH §7 |
| W06-22 | `eval/golden/` part 2: 4 more repos (`near-intents-client`, `py-django`, `node-worker`, `mixed-monorepo`) | test | M | H+ | W06-21 | `node eval/validate.mjs` → 10 repos valid | ORCH §7 |
| W06-23 | `eval/run.mjs` + root script `eval:golden` (lead pre-step). Runs the selected reviewers on each golden repo (`scripted:*` by default; real models with `OMNI_LIVE=1`). Computes, per mode **debate / union / majority vote**:<br>• recall, precision<br>• decoy FP rate<br>• dedup correctness<br>• **conformity rate** (seeded bugs present before debate, absent or `REFUTED` after)<br>• cost per confirmed finding<br>Baselines are computed from the same submissions, with no extra calls | test | M | H | W06-15, W06-19, W06-21 | `npm run eval:golden` → a table with 3 rows × 6 metrics per repo plus totals. A run where `scripted:lazy` concedes a seeded bug → conformity rate > 0 for that repo | ORCH §7, P9 |
| W06-24 | Rubric judge: one LLM-judge call per general review scoring evidence accuracy, severity calibration, remediation quality and coverage honesty (0.0–1.0 each, plus pass/fail). `scripted` rubric offline | test | S | H+ | W06-16, W06-23 | `npm run eval:golden -- --rubric` → each repo row gains 4 scores and a pass/fail column | ORCH §7 |
| W06-25 | Live eval: run `OMNI_LIVE=1 npm run eval:golden -- --preset mixed` once with the owner's keys and subscriptions. Write `eval/RESULTS.md` (date, commit, reviewers, orchestrator, budgets, the 3-mode table, cost, caveats). Raw outputs go under `eval/runs/<date>/` (gitignored), with only the summary committed | test | M | H | W06-10, W06-15, W06-16, W06-23 | Open `eval/RESULTS.md` → a dated table for debate, union and majority vote across ≥ 6 repos, with total cost and the exact command used | ORCH §7 |
| W06-26 | OD-14 decision. If debate beats union **and** majority vote on precision without losing more than one seeded bug of recall → keep `--debate-rounds 2` as default. Else set the default to 1 (challenge only) in `run-config` defaults, and write the reason into `eval/RESULTS.md` (W14 copies it to the README). Ask the lead to flip OD-14 in DECISIONS.md | docs | S | H | W06-25 | `./bin/audit run --repo eval/golden/near-escrow --plan` → the printed default debate rounds match the decision line at the top of `eval/RESULTS.md` | OD-14, P9 |
| W06-27 | Wave check: run demo steps 1–9 on the wave worktree, write `docs/plan/checks/w06-check.md` (commands, paths to open, what to see), gates green (`harness --self-test`, `npm test`, `npm run check:w06`), tag `wave-06` at landing | docs | S | H | W06-20, W06-26 | Follow `checks/w06-check.md` from a clean worktree → every step shows what it says | PRODUCT_WAVES §7 |

## Wave DoD

- `node scripts/harness.mjs --self-test && npm test && npm run check:w06` is green, and every earlier engine wave check still passes.
- Demo steps 1–9 pass offline with `scripted:*` reviewers. CI never needs a provider key.
- No judge-visible file (`debate/round-*/`, judge briefs) contains a model name, vendor, reviewer id or vote count (grep test in W06-04 / W06-14).
- `--debate-rounds 0` reproduces today's crosscheck + adjudication output for an old fixture (legacy statuses unchanged).
- `eval/RESULTS.md` exists with the live run, and OD-14 is decided from it.
- Tag `wave-06` on the merge commit.
