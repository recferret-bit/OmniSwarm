# W29 — Report and live progress surfaces

> **Track:** Engine (E, report and progress) with Intake (B), Front (F) and Lead (schemas) · **Tag:** `wave-29` · **Check:** `npm run check:w29` (= `node tools/wave-check.mjs 29`: the report-section and progress tests, `tests/e2e/engine/w29.test.mjs`, `node --test apps/api/test/unit/progress-detail.test.ts`, `npm run test:landing -- ProgressPanel` and `npm run test:e2e -- landing`, then the coverage gate over the engine modules)
> **Depends on waves:** W25 and W26 (the adjudication v2 fields and the labels that these surfaces show).
> **Soft dependencies:** W23, W24 and W27 (lanes, budget and pool states appear when those waves have landed and are omitted otherwise).
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D5, D8 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M5`, `M6` · [`docs/how-it-works.md`](../../how-it-works.md) "Following a run"
> **Owned paths:** `engine/scripts/orchestrator-progress.mjs`, `engine/scripts/report-section-verification*.mjs`, `engine/scripts/report-section-finding-debate.mjs`, `engine/scripts/report-section-v2-data.mjs`, `engine/scripts/report-section-status-legend.mjs`, `engine/scripts/generate-html-report*.mjs`, `engine/scripts/report-fixtures/**`, `apps/api/src/worker/progress-detail.ts`, `apps/api/src/worker/progress-tailer.ts`, `apps/api/src/http/schemas.ts`, `apps/api/openapi.json` (generated), `apps/api/test/unit/progress-detail.test.ts`, `apps/api/test/integration/local-real.test.ts` (W29-09 only), `apps/web/src/components/request/ProgressPanel*.tsx`, `apps/web/src/lib/api/schema.gen.ts` (generated), `tests/e2e/landing/**` (progress cases), `packages/schemas/intake-api.schema.json` (W29-01, lead), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W29 key), `tests/e2e/engine/w29.test.mjs`, `docs/plan/checks/w29-check.md`
> **Not owned:** `engine/scripts/debate-*.mjs`, `verify-and-adjudicate*.mjs`, the `incompleteLabelOf` function of `generate-html-report-evidence.mjs` (W26), the schemas other than `intake-api`.

## Goal

The user posts a job and should see what the new pipeline is doing, in a terminal and on the web, and a reader of the report should see how far each finding was checked. Today the progress shows phases and reviewers; the debate, the budget and a waiting provider are invisible, and a finding looks the same whether it was verified or never reached.

- **Terminal and snapshot:** counters for verification depth (`42 of 63 checked`), budget used, lanes busy, and a parked provider with its reset time.
- **Web progress panel:** the same, with the same honesty rules as before: fields absent when a feature is off, nothing claimed that the engine did not write.
- **Report:** a depth badge on every finding (0 to 4, with the word, not only a colour), the verification detail, an appendix of refuted findings with their refutation record, and the `PARTIALLY CHECKED` banner. PDF included.

Surfaces only. No engine decision changes in this wave.

## Demo story (the check in words)

1. A scripted ladder run in a terminal → the status row reads like `review done · verify 42/63 · budget 61% · codex parked until 21:40`, fits in 100 columns, and redraws in place.
2. `npm run stack:local`, post a local job with the ladder demo → `GET /api/local/jobs/:id` serves `progress.detail.verification`, and the web panel shows "Checked 42 of 63" and a budget bar while it runs.
3. Open the finished report → each finding carries a depth badge (`Depth 3: refuted by an anchored control, answered once, panel of 2`, say), the Verification section lists the answers and citations, and the appendix lists refuted findings. With 70% depth coverage a `PARTIALLY CHECKED` banner is at the top.
4. The same report built from a `--verify debate` run is byte-identical to before this wave.
5. A finding titled `<script>alert(1)</script>` renders as text in every new element.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-25` and `wave-26` are in `main` and gate G3 has passed; the lead has landed W29-01 and regenerated `openapi.json` and `schema.gen.ts`.
- [ ] No other open wave owns a listed path. W26 has finished editing `incompleteLabelOf` in `generate-html-report-evidence.mjs`.
- [ ] The report fixtures for a ladder run (a small committed run folder) exist from W25 and W26, or W29-03 builds them from the scripted scenarios.

## Features covered

- [ ] Contract and generated files: W29-01
- [ ] Engine snapshot and terminal line: W29-02
- [ ] Report data and rendering: W29-03, W29-04
- [ ] Intake mapping: W29-05
- [ ] Web panel and its e2e: W29-06, W29-07
- [ ] Docs: W29-08
- [ ] Wave check and tag: W29-09

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W29-01 | Lead contract: `progress-detail` gains optional `verification` `{total, byDepth[5], unavailable}`, `budget` `{usedPct, remainingMinutes, stage}`, `lanes[]` and `parked[]` `{provider, until}`. Regenerate `apps/api/openapi.json` and `apps/web/src/lib/api/schema.gen.ts` | contract | S | | W25, W26 | `packages/schemas/intake-api.schema.json`, `apps/api/openapi.json`, `apps/web/src/lib/api/schema.gen.ts` | `npm run test:schemas` → valid fixtures pass; a `byDepth` of length 4, a negative count, a `usedPct` of 120 and a `parked` entry with no `until` fail (negative ×4); `node apps/web/scripts/gen-api.mjs --check` and `npm run openapi --workspace apps/api -- --check` → in sync | — |
| W29-02 | Engine snapshot and terminal: `orchestrator-progress.mjs` adds the optional fields from in-process counters and the ledger; the status line shows depth, budget and a parked provider, fitted to the terminal width | engine | M | | W29-01 | `engine/scripts/orchestrator-progress.mjs`, `engine/scripts/orchestrator-progress.test.mjs` | `node --test engine/scripts/orchestrator-progress.test.mjs` → counters give the fields; a run with no ladder, budget or lanes writes a snapshot equal to today's (neutral); a parked provider is shown only while parked (negative); the line is at most 100 columns with every segment present; nothing is read from a log file (negative) | `M5` |
| W29-03 | Report data: `report-section-v2-data.mjs` builds per-cluster depth, answers, citations, refutation and panel from the adjudication v2 rows and `verification/*.json`; a missing record gives depth 0 with its reason | engine | M | | W25, W26 | `engine/scripts/report-section-v2-data.mjs`, `engine/scripts/report-fixtures/**`, `engine/scripts/report-section-v2-data.test.mjs` | `node --test engine/scripts/report-section-v2-data.test.mjs` → a ladder fixture gives depth and detail per cluster; a debate-mode fixture gives the data it gives today (neutral); a cluster with no `verification` record is depth 0 with a reason, never missing (negative) | `M6` |
| W29-04 | Report rendering: `report-section-verification.mjs` (depth badge with its word, verification detail, appendix of refuted findings, `PARTIALLY CHECKED` banner), updates to `report-section-finding-debate.mjs`, `report-section-status-legend.mjs` and `generate-html-report*.mjs`, PDF included | engine | M | | W29-03 | `engine/scripts/report-section-verification*.mjs`, `engine/scripts/report-section-finding-debate.mjs`, `engine/scripts/report-section-status-legend.mjs`, `engine/scripts/generate-html-report*.mjs`, their tests | `node --test engine/scripts/report-section-*.test.mjs tests/e2e/engine/w07.test.mjs` → a debate-mode report is byte-identical to the stored snapshot; a ladder report shows a badge with text on every finding and the appendix lists each refuted finding with its citation; a title of `<script>alert(1)</script>` is escaped in every new element (negative); the PDF text contains the appendix heading; below 90% depth coverage the banner is present, above it absent | `E19` |
| W29-05 | Intake mapping: `progress-detail.ts` copies only the schema's new fields with clamping, `progress-tailer.ts` treats a change in them as a change (30 s write throttle kept), `schemas.ts` mirrors them | server | M | | W29-01 | `apps/api/src/worker/progress-detail.ts`, `apps/api/src/worker/progress-tailer.ts`, `apps/api/src/http/schemas.ts`, `apps/api/test/unit/progress-detail.test.ts` | `node --test apps/api/test/unit/progress-detail.test.ts` → a snapshot with the new fields gives a schema-valid row; counts are clamped to integers of at least 0; an unknown extra key is dropped; a `byDepth` of the wrong length drops that field and keeps the row valid (negative ×2); writes of the new fields are throttled to one per 30 s | AGENTS.md |
| W29-06 | Web `ProgressPanel`: a verification meter ("Checked 42 of 63"), a budget bar, and a note "Waiting for Codex until 21:40" while a provider is parked; every field hidden when absent | client | M | | W29-05 | `apps/web/src/components/request/ProgressPanel*.tsx`, `apps/web/src/components/request/ProgressPanel.test.tsx` | `npm run test:landing -- ProgressPanel` → the meter, bar and note render from a fixture; a fixture without the fields renders exactly as before (neutral); the note is not shown once the request is finished (negative); axe reports 0 violations; at a 360 px width nothing scrolls horizontally | — |
| W29-07 | Landing e2e: a progress flow against the mock API that emits the new fields, desktop and mobile | test | S | | W29-06 | `tests/e2e/landing/**` (progress cases) | `npm run test:e2e -- landing` → the panel shows the meter and bar while running and neither after completion; at a 360 px viewport the page has no horizontal scroll | — |
| W29-08 | Docs: `docs/how-it-works.md` "Following a run" gains the new terminal segments, the panel fields and the report depth badge, with the definition of each depth: 0 not independently checked, 1 blind verification, 2 refuter ran, 3 exchange and panel, 4 disputed with an open question | docs | S | | W29-04, W29-06 | `docs/how-it-works.md` | Run `grep -c "Depth" docs/how-it-works.md` → at least 5 (one line per depth 0 to 4) | — |
| W29-09 | Wave check:<br>• `tests/e2e/engine/w29.test.mjs`: ladder fixture to report and to snapshot<br>• a gated real-engine case: with `OMNI_REAL_LOCAL=1` the local job route serves `verification` for a ladder demo<br>• fill `tools/wave-checks.json` for W29<br>• `check:w29`, `checks/w29-check.md`, tag `wave-29` | test | S | | W29-02..08 | `tests/e2e/engine/w29.test.mjs`, `apps/api/test/integration/local-real.test.ts`, `tools/wave-checks.json` (the W29 key), `docs/plan/checks/w29-check.md` | `npm run check:w29` → green; `npm run check:all` → green; `OMNI_REAL_LOCAL=1 DATABASE_URL=… node --test apps/api/test/integration/local-real.test.ts` → the local job route serves `progress.detail.verification` while the ladder demo runs | — |

**Parallel groups:**
1. W29-01 (lead).
2. W29-02, W29-03, W29-05.
3. W29-04, W29-06.
4. W29-07, W29-08.
5. W29-09.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `orchestrator-progress.test.mjs`, `report-section-*.test.mjs` (new and extended), `tests/e2e/engine/w07.test.mjs` (unchanged, must pass), `apps/api/test/unit/progress-detail.test.ts`, `ProgressPanel.test.tsx`, the landing e2e, `tests/e2e/engine/w29.test.mjs`.
- **Coverage:** `npm run test:coverage -- w29` for the engine modules → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`orchestrator-progress` 100 / 93.4). The API and web packages keep their own test runners and thresholds.
- **Security:** every new HTML element has an escape test; every new JSON field has a clamp or drop test.

## Analytics

- **What changes for the operator:** the three views a user has, now with the new fields. No new event kind.
- **Metrics shown to a reader:** `depth_coverage`, `budget_used_pct`, `parked_providers`, `verification_unavailable`.
- **Artifacts:** `harness/host/progress.json` (display only), `request_progress.detail`, the report's verification section, `report-health.json`.
- **Watch:** a panel that shows `depth_coverage` at 100% while the report shows depth 0 findings means the snapshot and the report disagree; the e2e compares them.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P4 neutrality | Debate-mode report and a no-feature snapshot | byte-identical to before the wave |
| P4 consistency | The ladder fixture through snapshot, intake row, panel and report | the same depth counts in all four |
| P4 security | Escape and clamp tests | all pass |
| P5 owner check | `npm run stack:local` with a scripted ladder job, watched in the terminal and the browser | the meter moves, the budget bar appears, the report shows badges; no key or paid run needed |

## Risks and rollback

- **A surface claims more than the engine wrote.** Fields are optional and come only from the snapshot; the consistency proof compares all four views.
- **A wide status line breaks a narrow terminal.** The line is fitted and tested at 100 columns.
- **The generated API files drift.** The two `--check` commands are in the wave check.
- Rollback: the new fields are optional; revert the merge and every consumer ignores them.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w29`, `check:all`, `check:v2` green; coverage gate green on the engine modules; neutrality and consistency proofs green.
- The two generated API files are in sync (`--check` commands pass).
- `docs/how-it-works.md` describes the new segments, fields and the depth scale.
- No file outside owned paths changed; no key, host path or `reports/` content committed.
- `checks/w29-check.md` written from the running result, with a screenshot-free step list for the browser. Tag `wave-29` after the owner check.
