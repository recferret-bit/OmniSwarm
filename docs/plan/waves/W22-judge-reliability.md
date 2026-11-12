# W22 — Submit contract and judge reliability

> **Track:** Engine (E) with Lead (schemas) · **Tag:** `wave-22` · **Check:** `npm run check:w22` (= `node tools/wave-check.mjs 22`: the debate, bridge, briefs and session tests and `tests/e2e/engine/w22.test.mjs`, then the coverage gate over this wave's modules)
> **Depends on waves:** W20 (the event log, the wave-check runner and coverage gate, and the attempt suffix on debate and judge session names, W20-11).
> **Soft dependencies:** none.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D2, D6 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M4`, `M4b`, `M16`, `M19` · [`docs/RULES.md`](../../RULES.md) rules 14, 18
> **Owned paths:** `engine/scripts/bridge-tools-orchestrator.mjs`, `engine/scripts/bridge-tools-debater.mjs`, `engine/scripts/debate-bridge.mjs`, `engine/scripts/debate-bridge-roles.test.mjs`, `engine/scripts/orchestrator-briefs.mjs`, `engine/scripts/report-fixtures/__snapshots__/briefs/**`, `engine/scripts/debate-voices.mjs`, `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-run.mjs`, `engine/scripts/debate-adjudicate.mjs`, `engine/scripts/debate-summary.mjs`, `engine/scripts/debate-general-review.mjs`, `engine/scripts/debate-plan.mjs` (the `summaryVoiceFor` function only), `engine/scripts/debate-phases.test.mjs`, `engine/scripts/agent-session.mjs` (`submitNowText`, the submitted-tracking in `onSessionUpdate`, and the lazy initialisation of its per-turn set), `engine/scripts/harness-fixtures/submit-refusals/**`, `engine/scripts/harness-fixtures/judge-uncontested/**`, `packages/schemas/**` (W22-01, lead), `docs/RULES.md` (append-only), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W22 key), `tests/e2e/engine/w22.test.mjs`, `docs/plan/checks/w22-check.md`
> **Not owned:** `engine/scripts/debate-rounds.mjs`, `debate-cluster.mjs`, `debate-rules.mjs` (W25), both skill copies, the auditor and cross-check bridge tools (they keep refusing a wrong field).

## Goal

In run 2 the judge produced no verdict, and in run 1 six of eight. The causes found in the saved runs were plumbing, not model quality (`M16`):

- A refused submit was never nudged. `onSessionUpdate` marks the turn submitted from the in-progress tool call, and the failed update frame carries only a `toolCallId`, so the failure is not matched to the submit and the end-of-turn "submit now" prompt does not fire. The brief also says "call once".
- Codex sent `verdict` for `finalStatus`, `reasoning` for `rationale` and `executive_summary` for `executiveSummary`; about a dozen refused submit frames sit in 12 sessions of the two saved runs (two scans of the logs differ by one).
- Three failures in a row ended judging for the whole run, and for 39 of 63 clusters no vendor outside the authors was left to judge.
- The trace printed `judge|CONFIRMED` for a judge that never answered, which is how run 2 was first misread.
- 9 of the 13 clusters debated in run 2 had no refuting or partial turn and no severity disagreement, so there was nothing for a judge to decide (`M19`).

Fix the plumbing before anyone judges a better design. This wave deliberately changes defaults (it adds a retry and removes some judge calls) and says so (`DEBATE_V2.md` D7 exempts plumbing fixes); each change is covered by a test and listed in the check guide. Where the judge answered in the saved runs it never changed the rules status (`M4`), so no ruling is expected to change.

## Demo story (the check in words)

1. Replay a failed-submit frame sequence written to the recorded shape through `onSessionUpdate` → `turn.submitted` is false after the failed frame and the end-of-turn nudge fires once; a successful submit leaves it true.
2. Replay the refused payload shapes of the saved runs (`harness-fixtures/submit-refusals/`, a manifest names which are accepted and which still refused) through the bridge. The `verdict`, `reasoning` and `executive_summary` shapes are accepted and recorded `aliased`, including snake_case rows nested in `open_disagreements`; the extra keys they carry are ignored as today; a missing `rationale` is refused with a message built from constants that names `rationale` and shows an example.
3. A scripted orchestrated run → `debate/adjudication.json` rows carry `outcome`: `judged`, `skipped_uncontested` or `unavailable`. `debate/trace.jsonl` never shows a status on a judge row whose outcome is `unavailable`.
4. Over a fixture of 13 clusters with the turn shapes of run 2's debated clusters → 9 get no judge session and 4 (those with a `partial` turn) still do.
5. A scripted run where judge A always refuses and judge B is healthy: the remaining clusters are judged by B, not handed to the rules.

## Slice

All rows are blank in the `H` column. The plan opens after 2026-11-14.

## Wave DoR

- [ ] The lead has landed W22-01.
- [ ] The fixtures are **written by hand to the recorded shapes** (field names, key sets, error texts, frame keys) from the refused frames and the failed update frame of the saved runs; nothing is copied from a log, because the logs carry the account email and plan, session ids and absolute paths. The saved runs are read on the owner's host to write them.
- [ ] The lead has recorded in `docs/RULES.md` that field aliasing for debater and orchestrator submits is a deliberate contract change, not a fixture fix (AGENTS.md: "Do not weaken a refusal to make a fixture pass"); the auditor and cross-check tools do not alias.
- [ ] No other open wave owns a path listed above. `debate-run.mjs` is split by W22-02 before anything else edits it.
- [ ] No owner decision is needed. INCOMPLETE semantics stay as today (OD-19 changes them in W26).

## Features covered

- [ ] Contracts: W22-01
- [ ] `debate-run.mjs` split into stages: W22-02
- [ ] Alias and structured refusal at the bridge: W22-03
- [ ] Briefs name their fields; a failed submit is noticed and nudged: W22-04, W22-05
- [ ] One retry on a refused submit: W22-06
- [ ] Honest judge outcome; no judge call when nothing can change; a judge chain: W22-07, W22-08, W22-09
- [ ] General review retry: W22-10
- [ ] Events: W22-11
- [ ] Wave check and tag: W22-12

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W22-01 | Lead contract:<br>• `submit-refusal` record `{tool, code, field?, expected[], aliased?, at}`; `code` is an enum, `expected[]` holds bridge constants, `field` matches `^[A-Za-z_]\w{0,40}$`, no other free text<br>• optional `outcome` on `adjudication` rows (`judged`, `skipped_uncontested`, `unavailable`, `rules_threshold` for the `judge_threshold` rows; rows for CAPPED, AGREED and unheard clusters carry none)<br>• run-event kinds `submit_refused` and `judge_outcome` | contract | S | | W20 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a refusal with an unknown `code`, a `field` with a space or over 41 characters, an unknown `outcome`, and a `judge_outcome` event with no `clusterId` fail (negative ×4) | `M4` |
| W22-02 | Split `debate-run.mjs` without behaviour change: `debateStage` stays; `adjudicateStage` and its threshold row move to `debate-adjudicate.mjs`; `generalReviewStage` and `missingAnswersError` move to `debate-summary.mjs`; `debate-run.mjs` re-exports all three names so every importer (`orchestrator-phase-adjudicate.mjs`, `orchestrator-phase-general-review.mjs`, two tests) is unchanged; the moved code inherits `debate-run`'s coverage baseline (`--moved`), and the tests it needs for the branches the baseline leaves open are added | engine | M | | W20-07 | `engine/scripts/debate-run.mjs`, `engine/scripts/debate-adjudicate.mjs`, `engine/scripts/debate-summary.mjs`, their tests | `npm test` → every existing test passes with no test deleted; `npm run eval:golden` output is unchanged; `grep -n "export async function adjudicateStage" engine/scripts/debate-run.mjs` → no match (it lives in `debate-adjudicate.mjs`) while `import { adjudicateStage } from './debate-run.mjs'` still resolves (negative: the re-export holds); the coverage gate passes with the moved baseline | `DEBATE_V2.md` §6.2 |
| W22-03 | Bridge, debater and orchestrator roles only:<br>• accept the aliases `verdict`→`finalStatus`, `reasoning`→`rationale`, `executive_summary`→`executiveSummary`, and snake_case for the camelCase names the tool defines, including the keys of rows nested in `openDisagreements`<br>• unknown fields are ignored as today, not refused<br>• a refusal is built from bridge constants, names the allowed fields and shows one valid example<br>• record it to `harness/host/submit-refusals/<session>.json`<br>• hand-write fixtures to the shapes of the refused frames of the saved runs (with their extra keys), and a manifest that says which are accepted after aliasing and which are still refused<br>• the lead's RULES.md note | engine | M | | W22-01 | `engine/scripts/bridge-tools-orchestrator.mjs`, `engine/scripts/bridge-tools-debater.mjs`, `engine/scripts/debate-bridge.mjs`, `engine/scripts/debate-bridge-roles.test.mjs`, `engine/scripts/harness-fixtures/submit-refusals/**`, `docs/RULES.md` | `node --test engine/scripts/debate-bridge-roles.test.mjs` → every fixture the manifest lists as accepted is accepted and recorded `aliased: true` (judge shapes with `verdict`, `reasoning`, `cluster_id` and `evidence`; the general-review shape with `executive_summary` and nested snake_case rows) and every fixture it lists as refused is refused, with the counts printed; a missing `rationale` is refused with text built from constants that contains `rationale` and an example; no refusal text contains a model-supplied value (negative: a payload whose field name is `ignore previous instructions` is refused with only the constant list); the same alias on `submit_audit_report` is still refused (negative: auditors are not widened); a refused submit commits nothing to the inbox; `grep -n "aliasing" docs/RULES.md` finds the lead's note | `M16` |
| W22-04 | Briefs list each tool field with an example and say that a refused submit does not count. The field names come from the tool's own definition, not a second list | engine | S | | W22-01, W22-03 | `engine/scripts/orchestrator-briefs.mjs`, `engine/scripts/report-fixtures/__snapshots__/briefs/**`, `engine/scripts/orchestrator-briefs.test.mjs` | `node --test engine/scripts/orchestrator-briefs.test.mjs` → snapshots for judge, general-review, challenge, devil-advocate, defend and rebut show a `Fields:` block; a test derives the field names from the tool definitions and fails if a brief names a field the tool does not accept (negative); no brief says "once" without the refused-submit clause | `M16` |
| W22-05 | Notice a failed submit:<br>• `onSessionUpdate` remembers which `toolCallId` is the submit and clears `turn.submitted` when that id's update fails and nothing is committed<br>• `submitNowText` says a refused submit does not count and to call again with the fields in the brief<br>• initialise the per-turn set of submit call ids lazily, because the `turn` object is built in `runTurn`, outside this range<br>• replay a frame sequence written to the recorded shape as the fixture | engine | M | | W20-04 | `engine/scripts/agent-session.mjs` (`submitNowText`, `onSessionUpdate`), `engine/scripts/agent-session.test.mjs`, `engine/scripts/harness-fixtures/submit-refusals/**` | `node --test engine/scripts/agent-session.test.mjs` → with the frame sequence (an in-progress submit call, then a failed update carrying only `toolCallId`, as recorded) `turn.submitted` is false afterwards and the end-of-turn nudge is sent once; with a successful submit it stays true and no nudge is sent; a failed update for a **non-submit** call does not clear `turn.submitted` (negative); the nudge text contains the refused-submit clause; every existing session test still passes | `M16` |
| W22-06 | Voice retry, the single retry layer for invalid output on debate and judge roles: when a session ends with no commit and a refusal record exists, run one more session named `<name>-a2` (W20-11 makes the suffix valid for every debate and judge name) with its own turn clock, and a host-written line built from the record's constants appended to the brief. Applies to challenge, devil, defend, rebut, judge and general review. W23's retry ladder does not retry invalid output | engine | M | | W22-03, W22-05, W20-11 | `engine/scripts/debate-voices.mjs`, `engine/scripts/debate-voices.test.mjs` | `node --test engine/scripts/debate-voices.test.mjs` → refused then valid: the body is returned from two sessions (the second named `…-a2`, read from its own inbox entry) and the trace row has `attempt: 2`; each attempt has its own turn clock, so a retry after a 150 s first attempt is not cut at 30 s (negative); refused twice: `unavailable: submit_refused` after exactly two sessions, never three (negative); a timeout does not trigger the retry (negative); a log that says "refused" with no record triggers nothing (negative); the appended line holds only record constants (negative: a hostile `field` value never reaches the prompt) | `M16`, D6 |
| W22-07 | Honest judge outcome: an unavailable judge writes trace `stop: unavailable` with its reason and the row `outcome: unavailable`; a judged row has `outcome: judged` and `judge` names the reviewer that answered | engine | S | | W22-02 | `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-adjudicate.mjs`, their tests | `node --test engine/scripts/debate-judge.test.mjs engine/scripts/debate-phases.test.mjs` → a judge that returns nothing leaves a trace row with `stop: unavailable` and never a status; the row's status is the rules status and `outcome` is `unavailable`; a normal judgement has `outcome: judged` (positive); after a retry the row's `judge` is the replacement that answered (positive) | `M4` |
| W22-08 | No judge call when there is nothing to decide: `citationsOk`, no counted turn with verdict `refuted` or `partial` (devil included), and the cluster's severities agree. Such a cluster gets a rules row `outcome: skipped_uncontested`. This removes the judge's option to lower CONFIRMED to LIKELY with no new evidence; in the saved runs no judge ever did | engine | M | | W22-07 | `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-adjudicate.mjs`, `engine/scripts/harness-fixtures/judge-uncontested/**`, their tests | `node --test engine/scripts/debate-adjudicate.test.mjs` → a cluster with only upheld turns and equal severities makes zero judge calls (the voice counter is 0); one `partial` turn, a devil `partial`, or one severity disagreement makes the judge run (negative ×3); a hand-written fixture of 13 clusters with the turn shapes of run 2's debated clusters gives 9 skipped and 4 judged | `M4`, `M19` |
| W22-09 | Judge chain: when a judge fails or refuses twice, the cluster goes to the next eligible judge (orchestrator, alternate, then another vendor that neither authored nor argued), up to three. A judge blocked by `usage_limit`, `auth_required` or `provider_policy` is skipped without spending a retry. The three-in-a-row limit (`maxJudgeUnavailable`) becomes per judge reviewer, so one flaky judge does not stop the others; only when the chain is empty does the rules row with `judge_threshold` (outcome `rules_threshold`) apply. A chain helps only where a vendor outside the authors is left (24 of 63 clusters in run 2 have one author vendor and 11 two); the pool (W27) and same-vendor fresh sessions (W26) cover the rest | engine | M | | W22-08 | `engine/scripts/debate-judge.mjs`, `engine/scripts/debate-adjudicate.mjs`, their tests | `node --test engine/scripts/debate-adjudicate.test.mjs` → judge A refuses on every cluster and judge B answers: clusters after A's second failure are judged by B; every judge unavailable: the rest get `judge_threshold` as today (positive for the unchanged path); a flaky judge that trips its own limit is skipped for the rest of the run while the next judge continues (positive); a provider-blocked judge costs no session (negative); a cluster authored by all vendors gets `no_independent_judge` as today (negative: the chain does not invent one) | `M4`, `M18` |
| W22-10 | General review retry: if the summary is unavailable, retry once with the next judge in the chain through a new `plan.summaryVoiceFor(reviewer)` (today `plan.summaryVoice` is bound to the orchestrator), then fall back to the rules summary as today | engine | S | | W22-02, W22-09 | `engine/scripts/debate-summary.mjs`, `engine/scripts/debate-general-review.mjs`, `engine/scripts/debate-plan.mjs` (`summaryVoiceFor` only), their tests | `node --test engine/scripts/debate-phases.test.mjs` → first unavailable, second valid: the summary comes from the second and the methodology names both; both unavailable: the rules summary and `general_review_unavailable` exactly as before (negative) | `M4b` |
| W22-11 | Events: emit `submit_refused` and `judge_outcome` through the event log | engine | S | | W22-06, W22-07 | `engine/scripts/debate-voices.mjs`, `engine/scripts/debate-adjudicate.mjs`, their tests | `node --test engine/scripts/debate-voices.test.mjs engine/scripts/debate-adjudicate.test.mjs` → a scripted run writes valid `submit_refused` and `judge_outcome` events; with the event log unwritable the run still completes (negative) | `M16` |
| W22-12 | Wave check:<br>• `tests/e2e/engine/w22.test.mjs`: the refused-payload manifest; the failed-frame replay; 200 scripted clusters at a 30% seeded refusal rate; uncontested skip; judge chain<br>• fill `tools/wave-checks.json` for W22<br>• `checks/w22-check.md`, tag `wave-22` | test | S | | W22-02..11 | `tests/e2e/engine/w22.test.mjs`, `tools/wave-checks.json` (the W22 key), `docs/plan/checks/w22-check.md`, `docs/RULES.md` (append-only: judge retry and chain) | `npm run check:w22` → green; `npm run check:all` → green; both skill copies are still byte-identical (negative: a test fails if either changed) | — |

**Parallel groups:**
1. W22-01 (lead), W22-02, W22-05 (disjoint paths).
2. W22-03 (needs W22-01), W22-07 (needs W22-02).
3. W22-04 (needs W22-03), W22-06 (needs W22-03, W22-05), W22-08 (needs W22-07).
4. W22-09 (needs W22-08).
5. W22-10 (needs W22-09), W22-11 (needs W22-06, W22-07).
6. W22-12.

`agent-session.mjs` was edited by W20 first (usage accumulation, `ROLE_TOOLS`, `maxRecoveries`); W22 owns `submitNowText`, the submitted-tracking in `onSessionUpdate` and the lazy per-turn set. W22 merges `main` first.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `debate-bridge-roles.test.mjs`, `orchestrator-briefs.test.mjs`, `agent-session.test.mjs`, `debate-voices.test.mjs`, `debate-judge.test.mjs`, `debate-phases.test.mjs`, a new `debate-adjudicate.test.mjs` (and `debate-summary` cases in `debate-phases.test.mjs`), `tests/e2e/engine/w22.test.mjs`. A test file the plan names that does not exist yet is created by its issue.
- **Coverage:** the gate → new modules (`debate-adjudicate`, `debate-summary`) at least 95% lines, 85% branches, 90% functions (the split inherits `debate-run`'s uncovered branches, so W22-02 adds tests for them); changed modules not below their `M17` baseline (`debate-judge` 95.7 / 94.6, `debate-voices` 96.8 / 85.7, `agent-session` 100 / 80.2).
- **Regression:** `npm run eval:golden` and `npm run check:fullstack` unchanged.

## Analytics

- **Events:** `submit_refused{tool, code, aliased}` (no field name in the event), `judge_outcome{clusterId, outcome, judge, attempt}`.
- **Metrics (defined in W21, null until the events exist):** `refusal_rate{role,vendor}`, `judge_success_rate{vendor}`, `judge_sessions_per_run`, `uncontested_skip_rate`, `retry_recovery_rate`.
- **Artifacts:** `harness/host/submit-refusals/<session>.json`, `outcome` on each adjudication row, `scorecard.json` (W21).
- **Watch:** a refusal rate above zero after W22-03 means a new field-name mismatch; the fixture list grows by one file per new shape.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P2 replay | The refused-payload shapes of the saved runs through the bridge; the failed-update frame shape through `onSessionUpdate` | every fixture the manifest lists as accepted is accepted; the nudge fires on the frame shape |
| P4 fixture | The hand-written 13-cluster fixture through the uncontested rule | 9 of 13 get no judge session, 4 do; statuses unchanged |
| P4 scripted | A scripted judge refusing at a seeded 30% rate per attempt over 200 clusters, seeds 1–20, pooled over the 4,000 clusters | with the voice retry and the per-judge limit disabled in the test, at least 89% get a ruling from one judge (the expected value is 91%); with a second judge in the chain at least 98% (the expected value is 99.2%); a separate test shows a judge that fails three in a row is skipped while the next continues; never more than two sessions per judge per cluster |
| P4 neutrality | `runOrchestratedAudit` over the scripted fixture | `findings-and-scores.json` identical to today; `adjudication.json` identical except the new `outcome` field, and rows the skip rule turned into rules rows |
| P5 live (owner lane, optional, after OD-22) | 10 pinned clusters from the run 2 bundle, judged by each of Claude, Codex and Grok, before and after | refused submits at most 1 of 10 per vendor and none unanswered after the retry. Cost: 30 sessions, about 3 million tokens by the `M11` averages, shared subscription quota |

## Risks and rollback

- **Aliases widen accepted input.** Limited to the debater and orchestrator roles, validated against the schema after normalising, unknown fields still ignored (not echoed), the auditor and cross-check tools untouched (negative test).
- **The nudge fix changes every role.** A failed submit now gets one more prompt inside the same session, not a new session.
- **The refusal line feeds a prompt.** It is built only from bridge constants and a field name that matches a strict pattern (negative test with a hostile name).
- **Skipping the judge drops its option to lower CONFIRMED to LIKELY.** It applies only with no `refuted` or `partial` turn and equal severities; the severity-exact count in the scorecard is the guard in the live proof.
- **A chained judge may be a weaker model.** The chain keeps the independence rule (no author's vendor) and is capped at three.
- Rollback: revert the wave merge; the only format changes are the additive `outcome` field and the attempt suffix accepted in session names.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w22`, `check:all`, `check:v2` green; coverage gate green (the moved code inherits its baseline).
- Neutrality proof green; both skill copies unchanged and identical.
- `docs/RULES.md` rule text for the aliasing decision, the judge retry and the chain appended; `docs/how-it-works.md` notes the nudge and retry behaviour; no key, host path or `reports/` content committed.
- `checks/w22-check.md` written from the running result. Tag `wave-22` after the owner check.
