# W05 — Per-Reviewer Reports

> **Track:** Engine (E) · **Tag:** `wave-05` · **Check:** `npm run check:w05` (`node --test e2e/engine/w05.test.mjs`) · **Fixture:** `scripts/report-fixtures/w05-run/` (a committed, finished report directory with 4 reviewers of 3 families, built from the current report shape plus W01 `meta.reviewers`)
> **Depends on waves:** W01 (reviewer registry and `meta.reviewers[{id, family, provider, vendor, model}]`, reviewer id ≠ vendor ≠ model, importable `verify-and-adjudicate.mjs` (R-18b), the `report` phase in `scripts/orchestrator-phases.mjs`). Soft: W04 (raw `harness/usage/<reviewer>/<surface>-pass-<k>.json`; until W04 lands each reviewer gets a one-pass usage stub with `stop: submitted|unknown`), W03 (`scripted` reviewers make live fixture runs cheap; the committed fixture is enough).
> **Specs:** [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §1 (reviewer id, vendor, family), §6 (report v2 layout) · [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-17b, R-18a
> **Owned paths:** `scripts/reviewer-reports.mjs` (new), `scripts/report-cards.mjs` (new: finding-card / verified-safe renderers extracted from `generate-html-report.mjs`, which then imports them — the only edit W05 makes to that file), the `reviewers/` / `debate/` / `general-review.*` acceptance rules in `scripts/report-contract.mjs`, `scripts/report-fixtures/w05-run/**`, their `*.test.mjs`, `e2e/engine/w05.test.mjs`. Lead pre-step (change request): `shared/schemas/reviewer-report.schema.json` and `reviewers-index.schema.json` if W00 did not land them in final form. W07 owns `generate-html-report.mjs`, `report-style.css`, `report-browser.js` and `report-pdf.mjs` after this wave.

## Goal

The owner wants **the audit result of each model saved into its own report, by provider**. After every run, `reports/<run>/reviewers/<reviewer-id>/` holds that model's findings across all surfaces it reviewed (`report.json`, `report.md`, `report.html` in today's visual style), its usage (`usage.json`, `passes/`), and its status. `reviewers/index.json` and `reviewers.html` group reviewers by family (approach 1/2/3/demo) and vendor. The canonical, hash-committed `submissions/` and `auditors/` stay as they are; the per-reviewer folders are derived from them, and the report contract accepts the new folders instead of marking the run INCOMPLETE.

## Demo story (the check in words)

1. `node scripts/reviewer-reports.mjs scripts/report-fixtures/w05-run` → `reviewers/` appears with one folder per reviewer (`cli-claude-opus`, `key-zai-glm-5-3`, `openrouter-qwen-qwen3-8-max`, `scripted-baseline`), each with `report.json`, `report.md`, `report.html`, `usage.json` and `passes/`.
2. Open `reviewers/key-zai-glm-5-3/report.html` → it looks like today's `report.html` (same rail, fonts, finding cards, severity filter) but shows only GLM's findings, with a header strip "Approach 2 · API key · vendor zai · model glm-5.3 · 2 passes · 63 calls · $0.41".
3. Open `reviewers.html` → three groups: **Local subscriptions** (`cli`), **API keys** (`key`), **OpenRouter** (`openrouter`), plus **Demo** (`scripted`); each row links to the reviewer's report and shows findings by severity, unique findings and cost.
4. `node scripts/report-contract.mjs scripts/report-fixtures/w05-run` (or the existing validation entry) → COMPLETE; drop an unknown file into `auditors/` → still INCOMPLETE (the strict rule for canonical folders is unchanged).
5. Delete one reviewer's submission for surface S2 from a copy of the fixture and re-derive → that reviewer's report says **INCOMPLETE — S2 not submitted (reason from `workers.json`)**; the reviewer still appears in the index, never silently dropped.
6. `cat reviewers/by-provider/openrouter-alibaba.json` → the roll-up for OpenRouter's Qwen reviewers (one entry here), totals by severity and cost.

## Hackathon slice

- The `@hack` check covers all six demo steps on the committed fixture.
- **Deferred to W07:** reviewer pages in the PDF export (`report-pdf.mjs` `PAGES`), the rail link from `report.html` to `reviewers.html` (W07 owns `generate-html-report.mjs`). W05 exposes `reviewers/index.json.pages[]` for W07 to consume.

## Features covered

- [ ] Reviewer report and index schemas, `meta.reviewers` reading — W05-01
- [ ] Report contract accepts `reviewers/`, `debate/`, `general-review.*` (R-18a) — W05-02
- [ ] Committed report fixture with 4 reviewers / 3 families — W05-03
- [ ] Derive `reviewers/<id>/report.json` from canonical submissions — W05-04
- [ ] `usage.json` and `passes/` from W04 records (stub without W04) — W05-05
- [ ] Per-reviewer `report.md` — W05-06
- [ ] Extract finding-card renderers to `report-cards.mjs` — W05-07
- [ ] Per-reviewer `report.html` in today's style — W05-08
- [ ] `reviewers/index.json` grouped by family and vendor — W05-09
- [ ] `reviewers.html` index page — W05-10
- [ ] `reviewers/by-provider/` roll-ups — W05-11
- [ ] INCOMPLETE reviewers shown, never dropped — W05-12
- [ ] Hook into the `report` phase — W05-13
- [ ] Wave check — W05-14

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W05-01 | Contract: change request for `reviewer-report.schema.json` (`{reviewer {id, family, provider, vendor, model, servedModel?, keyFingerprint?}, status: COMPLETE|INCOMPLETE, gaps[], surfaces[], findings[], verifiedSafe[], usage}`) and `reviewers-index.schema.json` (`{groups[{family, label, vendors[{vendor, reviewers[]}]}], totals, pages[]}`); `reviewer-reports.mjs` reads reviewer metadata only from `meta.reviewers` (W01), never by parsing job names | contract | S | H | W00-05..10, W01-06 | `node --test scripts/reviewer-reports.test.mjs` → a sample reviewer report validates; one whose `reviewer.family` is `foo` is rejected | ORCH §6, R-17b |
| W05-02 | `report-contract.mjs`: accept `reviewers/**`, `debate/**`, `general-review.json`, `general-review.md`, `reviewers.html` as derived artifacts (validated against their schemas when present, never required); keep today's strict rule for `submissions/` and `auditors/` (any unexpected `auditors/*.json` that is not `crosscheck-*` still makes the run INCOMPLETE) | engine | S | H | W05-01 | `node --test scripts/report-contract.test.mjs` → a run with `reviewers/x/report.json` and `debate/clusters.json` validates COMPLETE; adding `auditors/stray.json` → INCOMPLETE with "unexpected auditor stray"; a malformed `reviewers/x/report.json` → INCOMPLETE naming the file | R-18a |
| W05-03 | Committed fixture `scripts/report-fixtures/w05-run/`: a finished run (findings, cross-check, `findings-and-scores.json`, `meta.reviewers`, `workers.json`, `harness/usage/…`) with reviewers `cli:claude:opus`, `key:zai:glm-5.3`, `openrouter:qwen/qwen3.8-max-0902`, `scripted:baseline` over surfaces S1–S3; built by running the `scripted` preset and editing identities, no real model output, no secrets | test | S | H | W05-01 | `node scripts/report-contract.mjs scripts/report-fixtures/w05-run` (current validator entry) → COMPLETE, and `npm test` stays green with the fixture present | ORCH §6 |
| W05-04 | `reviewer-reports.mjs` core: for each `meta.reviewers[]` entry collect its canonical submissions (`submissions/<reviewer>-<surface>.json`, last pass wins per surface), merge findings across surfaces with their `surface` kept, attach the final cluster status and score from `findings-and-scores.json` by `claimId`, collect `verified_safe`, write `reviewers/<id>/report.json` atomically | engine | M | H | W05-02, W05-03 | Demo step 1 → `reviewers/key-zai-glm-5-3/report.json` lists exactly the GLM claim ids present in `findings-and-scores.json`, each with its cluster `status`, and validates against the schema | ORCH §6 |
| W05-05 | `usage.json` + `passes/pass-<k>.json` per reviewer from W04's `harness/usage/<reviewer>/<surface>-pass-<k>.json` (summed per pass index across surfaces; totals for calls, tokens, cost, `costSource`); without W04 files write one stub pass per surface with `stop` from `workers.json` (`submitted` or `unknown`) | engine | S | H | W05-04 | On the fixture → `reviewers/scripted-baseline/usage.json` totals equal the sum of its `harness/usage` files; on a copy with `harness/usage/` deleted → one stub pass per surface, `stop: "submitted"` | ORCH §3, §6 |
| W05-06 | Per-reviewer `report.md`: header (family label, vendor, model, served model, passes, calls, cost), findings table (severity, title, `file:line`, final status), verified-safe list, gaps; same wording rules as today's auditor `.md` | engine | S | H | W05-04, W05-05 | `reviewers/openrouter-qwen-qwen3-8-max/report.md` on the fixture matches the committed snapshot and contains "Approach 3 · OpenRouter" and every claim title from its `report.json` | ORCH §6 |
| W05-07 | Extract the finding-card, severity-pill, verified-safe and page-shell renderers from `generate-html-report.mjs` into `report-cards.mjs` with **byte-identical** output; `generate-html-report.mjs` imports them (no other change to that file) | engine | S | H | W05-02 | Regenerate `report.html` and `findings-by-model.html` for the fixture before and after → `diff` is empty | owner: "keep the logic and visuals the same" |
| W05-08 | Per-reviewer `report.html`: reuses `report-cards.mjs`, `report-style.css` (copied or linked as `report.html` does today), the CSP-nonce pattern and `report-browser.js` severity filter/search; header strip with family label, vendor, model, passes, calls, cost; links back to `../../report.html` and `../../reviewers.html` | engine | M | H | W05-04, W05-05, W05-07 | Demo step 2 → the page renders with today's styling (rail, cards, filter), shows only that reviewer's findings, and the CSP header/meta blocks inline scripts other than the nonce'd one (checked by the existing CSP test pattern) | ORCH §6 |
| W05-09 | `reviewers/index.json`: groups `cli` → "Local subscriptions", `key` → "API keys", `openrouter` → "OpenRouter", `scripted` → "Demo (no LLM)", then by vendor; per reviewer: status, findings by severity, unique findings (claims in clusters with a single vendor), confirmed / refuted counts once W06 statuses exist (else today's statuses), calls, cost, report paths; `pages[]` lists every HTML page for W07's PDF export | engine | S | H | W05-04, W05-05 | On the fixture → `index.json` validates, has 4 groups in that order, and `totals.findings` equals the number of claims in `findings-and-scores.json` | ORCH §6 |
| W05-10 | `reviewers.html`: one table per family group, rows per vendor/reviewer with severity counts, unique findings, status badge (COMPLETE / INCOMPLETE), cost, link to the reviewer report; same rail and styles as `findings-by-model.html` | engine | S | H | W05-08, W05-09 | Demo step 3 → four group headings, four rows, each link opens the matching `reviewers/<id>/report.html` | ORCH §6 |
| W05-11 | `reviewers/by-provider/<family>-<vendor>.json` and `.md`: roll-up per provider (all reviewers of that family + vendor, e.g. two OpenRouter models from one vendor) with totals by severity, unique findings and cost | engine | S | H | W05-09 | Demo step 6 → `by-provider/openrouter-alibaba.json` exists with `reviewers: ["openrouter-qwen-qwen3-8-max"]` and totals equal to that reviewer's; `by-provider/cli-anthropic.json` lists `cli-claude-opus` | owner: "report by provider" |
| W05-12 | INCOMPLETE reviewers: a reviewer with a missing surface submission, a failed pass, `model_mismatch` or a provider failure gets `status: INCOMPLETE` with `gaps[{surface, reason}]` taken from `workers.json` / `meta.stageFailures`; it stays in every index and roll-up | engine | S | H | W05-04, W05-09 | Demo step 5 → the reviewer's `report.json` has `status: INCOMPLETE` and `gaps[0].surface: "S2"`, and `reviewers.html` shows the INCOMPLETE badge on its row | R-03 spirit, ORCH §4.3 "no silent drops" |
| W05-13 | Hook: register `reviewer-reports` in the W01 `report` phase after adjudication and before HTML generation (a phase-list entry, no orchestrator edit); failures are written to `meta.stageFailures` and make the run INCOMPLETE without hiding the main report | engine | S | H | W05-04..12 | `./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline,scripted:paranoid --surface s1` (with W03 landed) or the fixture replay → `reviewers/` is produced by the run itself; forcing `reviewer-reports` to throw → `meta.stageFailures` names it and `report.html` still renders | ORCH §2, §6 |
| W05-14 | Wave check: `e2e/engine/w05.test.mjs` runs demo steps 1–6 on the fixture; `npm run check:w05` (lead pre-step); `checks/w05-check.md` from the running result; tag `wave-05` | test | S | H | W05-01..13 | `npm run check:w05 && node scripts/harness.mjs --self-test && npm test` → green on the merged wave branch | PRODUCT_WAVES §7 |

## Wave DoD

- Every reviewer in `meta.reviewers` has `reviewers/<id>/report.{json,md,html}`, `usage.json` and `passes/`, and appears in `reviewers/index.json`, `reviewers.html` and its `by-provider` roll-up — including INCOMPLETE reviewers.
- `report.html` and `findings-by-model.html` output is byte-identical to before the wave (W05-07 diff test).
- The report contract accepts the new derived folders and still rejects unexpected canonical files.
- `node scripts/harness.mjs --self-test`, `npm test` and `npm run check:w05` pass offline.
- Tag `wave-05` on the merge commit.
