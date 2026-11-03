# W07 — Report v2

> **Track:** Engine (E) · **Tag:** `wave-07` (integration re-check after W06 may land as `wave-07.2`) · **Check:** `npm run check:w07` (= `node --test scripts/report-section-*.test.mjs e2e/engine/w07.test.mjs`; the root script is added by the lead in the W07 pre-step) · **Fixture:** `scripts/report-fixtures/v2-run/` (a complete v2 run folder built from `shared/schemas/` examples)
> **Depends on waves:** W05 (`reviewers/<id>/report.json`, `usage.json`, `reviewers/index.json`, the report-contract allow-list).
> **Soft dependencies:** W06 writes `debate/`, `findings-and-scores.json.finalStatus` and `general-review.*`. Until W06 is in `main`, every new section renders from the fixture. W07-20 re-renders a real scripted W06 run once both waves have landed. W01's branding fix (R-16, "AUDIT / CORE" → OmniSwarm) and `MODEL_ORDER` removal land in W01. This wave does not re-do them.
> **Specs:** [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §4.3 (final statuses), §4.4 (general review), §6 (report v2 layout) · [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-05, R-18a · owner's ask: "keep the logic and visuals of the current report the same, just extend it"
> **Owned paths:** `scripts/generate-html-report.mjs`, `scripts/report-browser.js`, `scripts/report-style.css`, `scripts/report-pdf.mjs`, `scripts/report-sections/**` (new), `scripts/report-section-*.test.mjs`, `scripts/report-fixtures/**`, `e2e/engine/w07*`, the report section of `docs/how-it-works.md`.
> **Not owned:** the per-reviewer `report.json`/`.md` writer (W05; this wave only renders its HTML through the shared shell, W07-12), `verify-and-adjudicate.mjs` (W06), `shared/schemas/**` (lead).

## Goal

The report people already know stays the same: the same left rail, hero, stat tiles, surface grid, finding cards, filters, evidence panels, colours and CSP. It **grows** where the new orchestration needs room:

- **05 Cross-check** and **06 General review** in the rail;
- a general-review hero on the Overview;
- a **debate timeline** inside every finding card;
- a `reviewers.html` index with **one page per reviewer**, badged by family and vendor, showing usage and cost;
- `findings-by-model.html` keyed by reviewer id;
- PDF export of all of it.

A string-snapshot harness proves that old runs render byte-identical. New sections are files in a registry, not edits to one 375-line generator.

## Demo story (the check in words)

1. Run `node scripts/generate-html-report.mjs scripts/report-fixtures/legacy-run/` (a pre-v2 run) → `report.html` matches the stored pre-refactor snapshot, apart from the CSP nonce and timestamps.
2. Run `node scripts/generate-html-report.mjs scripts/report-fixtures/v2-run/` and open `report.html`:
   - The rail reads **01 Overview · 02 Findings · 03 By model · 04 Evidence · 05 Cross-check · 06 General review**.
   - The Overview opens with the general-review hero: risk posture, a 3-line executive summary, the top findings with status pills, and the sentence "Model agreement and passing checks do not certify security."
3. Click **05 Cross-check**:
   - A table of clusters shows status pill, rounds, judge vendor, whether the alternate judge was used, and counts of valid and discarded arguments.
   - `AGREED` clusters are listed with `0 rounds`.
   - Clusters over the debate cap are listed as coverage gaps.
   - The status filter narrows the table.
4. Open any debated finding in **02 Findings** → its card has a **Debate** disclosure:
   - round 1 with Reviewer A/B/C arguments, the devil's-advocate tag, and a citation chip `file:line ✓` or `✗ quote_not_found`;
   - round 2 defenses, with a `conformity suspect` flag where one applies;
   - the judge rationale and the final status pill.

   The legacy "Peer reviews" disclosure still shows for runs without `debate/`.
5. In the status legend, every final status (`AGREED`, `CONFIRMED`, `LIKELY`, `DISPUTED`, `REFUTED`, `INSUFFICIENT_EVIDENCE`) and every legacy status has a pill and a one-line meaning.
6. Open `reviewers.html`:
   - Reviewers are grouped **cli → key → openrouter → scripted**, then by vendor.
   - Each card shows the model, passes, tool calls, tokens, cost and stop reasons.
   - It also shows findings submitted, unique confirmed and refuted counts.
   - Clicking a card opens `reviewers/<id>/report.html`, which has the same look as `report.html` and only that model's findings.
7. Open `findings-by-model.html` → one bar and one severity row per **reviewer id** (e.g. `cli-claude-opus`, `key-zai-glm-5-3`, `openrouter-qwen-qwen3-8-max`), each with a family/vendor badge.
8. Run `./bin/audit pdf scripts/report-fixtures/v2-run/` → `report.pdf` contains sections 05 and 06 with timelines expanded. `reviewers.pdf` and `findings-by-model.pdf` are written.
9. View source of any new page → every `<script>` and `<style>` carries the page nonce, there are no inline event handlers, and nothing is loaded from the network.

## Hackathon slice

- **The hackathon check covers demo steps 1–9** on fixtures.
- After W06 lands, W07-20 re-runs steps 2–7 on a real scripted W06 run (`wave-07.2` if W06 lands later).
- **Deferred (`H+`):**
  - a de-anonymize toggle that shows which reviewer id sat behind "Reviewer A" after adjudication (W07-10);
  - a top-level `report.md` summary (W07-18).
- **Still true:** a run folder without `reviewers/`, `debate/` or `general-review.*` renders exactly as today. Missing v2 artifacts in a v2 run show the existing INCOMPLETE notice banner, never an empty section that looks complete.

## Features covered

- [x] Section registry + v2/legacy fixtures — W07-01
- [x] HTML string-snapshot harness — W07-02
- [ ] Generator refactored onto the registry with zero visual change — W07-03
- [x] Status pills + legend for final and legacy statuses — W07-04
- [x] Family/vendor badge + usage/cost component — W07-05
- [x] Overview general-review hero — W07-06
- [x] Rail 06 General review — W07-07
- [x] Rail 05 Cross-check — W07-08
- [x] Per-finding debate timeline — W07-09
- [ ] De-anonymize toggle (H+) — W07-10
- [x] `reviewers.html` index — W07-11
- [x] Per-reviewer pages in the shared look — W07-12
- [x] `findings-by-model.html` keyed by reviewer id — W07-13
- [x] Filters and search over new statuses, reviewers and debate text — W07-14
- [x] PDF pages — W07-15
- [x] CSP nonce test — W07-16
- [x] Accessibility pass — W07-17
- [ ] Top-level `report.md` summary (H+) — W07-18
- [x] v2 snapshots + docs — W07-19
- [x] Integration with a real W06 run — W07-20
- [x] Wave check + tag — W07-21

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W07-01 | Contracts: `scripts/report-sections/` registry. A section is `{id, rail?: {num, label}, order, pages: ["report"\|"reviewer"\|"reviewers"\|"by-model"], render(ctx) → html}`, auto-discovered with a stable sort. Add `scripts/report-fixtures/legacy-run/` (copied from a pre-v2 run, scrubbed) and `v2-run/` (built from `shared/schemas/` examples: 4 reviewers in 3 families, debate rounds, adjudication, general review) | contract | S | H | — | `node --test scripts/report-section-registry.test.mjs` → the registry loads, sections sort by `order`, and both fixtures validate against `report-contract` + `shared/schemas` | ORCH §6 |
| W07-02 | Snapshot harness `scripts/report-section-snapshot.test.mjs`: render a fixture and normalize the CSP nonce, timestamps and run ids. Compare to `scripts/report-fixtures/__snapshots__/*.html`; `UPDATE_SNAPSHOTS=1` rewrites them. Store the **pre-refactor** snapshot of `legacy-run` from today's generator first | test | S | H | W07-01 | Change one CSS class name in the generator → the test fails with a diff that names the line. Revert → it passes | — |
| W07-03 | Refactor `generate-html-report.mjs` to render the existing sections (hero, tiles, surface grid, findings, by-model, evidence panels) through the registry. No visual or markup change | engine | M | H | W07-01, W07-02 | `node --test scripts/report-section-snapshot.test.mjs` → `legacy-run` output is byte-identical to the pre-refactor snapshot (after normalization) | owner ask |
| W07-04 | Status pills + legend: CSS tokens in `report-style.css` for `AGREED`, `CONFIRMED`, `LIKELY`, `DISPUTED`, `REFUTED`, `INSUFFICIENT_EVIDENCE`, alongside the legacy statuses. Add a legend section with a one-line meaning per status. Use `finalStatus` when present, else the legacy `status` | engine | S | H | W07-03 | Render `v2-run` → the legend lists 6 final + 5 legacy statuses. A finding with only a legacy status shows its legacy pill unchanged | ORCH §4.3 |
| W07-05 | `report-sections/_reviewer-badge.mjs`: family badge (`cli` / `key` / `openrouter` / `scripted`) + vendor + model, and a usage strip (passes, calls, tokens in/out, cost, stop reasons) read from W05 `usage.json`. Missing cost shows `—`, never `0` | engine | S | H | W07-03 | Unit test: a `usage.json` with `cost: null` → the strip shows `cost —`. An `openrouter` reviewer → badge text `openrouter · alibaba · qwen/qwen3.8-max-0902` | ORCH §1, §6 |
| W07-06 | Overview general-review hero (`report-sections/overview-general-review.mjs`): risk-posture pill, executive summary (first 3 lines), top 5 findings with status pills linking to their cards, and the fixed sentence. If `general-review.json` is absent in a v2 run → the existing notice banner with "General review not run — report INCOMPLETE" | engine | M | H | W07-04 | Render `v2-run` → the hero is the first block under the page header. Delete `general-review.json` from a copy → the banner text appears and no hero | ORCH §4.4 |
| W07-07 | Rail **06 General review** (`report-sections/general-review.mjs`): render `general-review.md` through a **safe markdown subset** (headings, lists, code, tables; all HTML escaped, links only to in-report anchors). Then the coverage-and-gaps table, open disagreements, the methodology block (reviewers, budgets, rounds, judge assignment) and the contribution table | engine | M | H | W07-04, W07-05 | Render `v2-run` with a general review containing `<script>alert(1)</script>` → it shows as text, the CSP test still passes, and the contribution table has one row per reviewer id | ORCH §4.4 |
| W07-08 | Rail **05 Cross-check** (`report-sections/crosscheck.mjs`): clusters table (title, final status, rounds, judge vendor, alternate-judge flag, valid/discarded argument counts, conformity flags). `AGREED` clusters show with `0 rounds`. Over-cap clusters go in a "Not debated (cap)" coverage-gap list. Status filter chips | engine | M | H | W07-04 | Render `v2-run` → the table row count equals `debate/clusters.json` length. Clicking the `DISPUTED` chip leaves only disputed rows | ORCH §4.1, §4.3 |
| W07-09 | Per-finding **Debate** disclosure in finding cards (`report-sections/finding-debate.mjs`): rounds in order. Each argument shows its anon label, verdict, `devil's advocate` tag, citation chips (`file:line ✓` / `✗ <reason>`), and a `conformity suspect` flag. Below them: discarded arguments collapsed, the judge rationale, the severity re-calibration reason, and the final status pill. Fall back to the legacy "Peer reviews" disclosure when there is no `debate/` | engine | M | H | W07-03, W07-04 | Render `v2-run` → the card for fixture cluster 3 shows 2 rounds, 1 devil's-advocate tag, 1 `✗ quote_not_found` chip and the judge rationale. `legacy-run` cards are byte-identical to the snapshot | ORCH §4.2, §4.3 |
| W07-10 | De-anonymize toggle: after adjudication, a per-card switch shows which reviewer id was behind each anon label, read from `debate/anonymization.json`. It is off by default and labelled "shown after judging" | engine | S | H+ | W07-09 | Toggle on cluster 3 → "Reviewer B" becomes `key-zai-glm-5-3`. Toggle off → the labels are back | ORCH §4.2 |
| W07-11 | `reviewers.html` index (`report-sections/reviewers-index.mjs`): group by family (`cli → key → openrouter → scripted`), then vendor. One card per reviewer with badge, usage strip, findings submitted, unique `CONFIRMED`, `REFUTED`, and a link to the per-reviewer page. Add it to the rail of every page as "Reviewers" | engine | M | H | W07-05 | Render `v2-run` → 4 cards in 3 family groups. The `scripted` card links to `reviewers/scripted-baseline/report.html` | ORCH §6 |
| W07-12 | Per-reviewer pages: render `reviewers/<id>/report.html` from W05's `report.json` through the **shared page shell** (same rail, hero, tiles, cards, filters), filtered to that reviewer. This replaces W05's minimal HTML page; W05 keeps writing `report.json` / `.md` | engine | M | H | W07-05 | Open `reviewers/key-zai-glm-5-3/report.html` from `v2-run` → the same header and rail as `report.html`, and only findings whose `auditors` include that reviewer | ORCH §6 |
| W07-13 | `findings-by-model.html` keyed by **reviewer id** instead of adapter: one bar and one severity row per reviewer, a family/vendor badge, and a validation column using final statuses. Two reviewers of the same vendor (`cli:claude:opus`, `openrouter:anthropic/claude-opus-5.5`) are separate rows | engine | M | H | W07-05 | Render `v2-run` → the row count equals `reviewers/index.json` length. Both Anthropic reviewers have their own row with distinct badges | ORCH §1, R-17 |
| W07-14 | `report-browser.js`: filters for final status and reviewer id, and search over debate arguments and the judge rationale. Filter chips are buttons with `aria-pressed`. Plain JS, no new dependency | client | S | H | W07-08, W07-09 | In `v2-run/report.html`, type `reentrancy` → only cards whose finding or debate text mentions it stay visible. Select reviewer `scripted-wrong` → only its findings remain | — |
| W07-15 | PDF: add `reviewers.html`, every `reviewers/<id>/report.html` and the new sections to `report-pdf.mjs` `PAGES`. Print CSS expands debate disclosures and the cross-check table | engine | S | H | W07-06..13 | `./bin/audit pdf scripts/report-fixtures/v2-run/` → `report.pdf` has headings "05 Cross-check" and "06 General review", and `reviewers.pdf` exists | ORCH §6 |
| W07-16 | CSP test `scripts/report-section-csp.test.mjs`: for every generated page, every `<script>` / `<style>` carries the page nonce, there are no `on*=` attributes, no `javascript:` URLs, and no `http(s)://` resource URLs | test | S | H | W07-06..13 | Add an `onclick=` to a section in a scratch branch → the test fails naming the page and section | — |
| W07-17 | Accessibility pass. `scripts/report-section-a11y.test.mjs` checks: one `<main>`, heading levels without skips, `aria-expanded` on every disclosure, `aria-pressed` on chips, and an `alt` or `aria-label` on badges and charts. New pill colours meet WCAG AA contrast against the card background (token check in the test). Manual keyboard walk recorded in the check guide | test | S | H | W07-06..14 | `node --test scripts/report-section-a11y.test.mjs` → passes on all pages. Lowering one pill's contrast below 4.5:1 → it fails naming the token | — |
| W07-18 | Top-level `report.md`: a short markdown summary of the run (general review summary, status counts, per-reviewer table, links to HTML pages) for readers without a browser | engine | S | H+ | W07-06, W07-11 | Render `v2-run` → `report.md` exists and contains the risk posture and one table row per reviewer | ORCH §6 |
| W07-19 | v2 snapshots for every new page (`report.html`, `reviewers.html`, one reviewer page, `findings-by-model.html`). Update the report section of `docs/how-it-works.md` (rail 05/06, reviewer pages, status meanings) | test | S | H | W07-06..17 | `node --test scripts/report-section-snapshot.test.mjs` → 5 snapshots match. `docs/how-it-works.md` names all 6 final statuses | — |
| W07-20 | Integration with W06: once W06 is in `main`, render a real `scripted:*` W06 run (from `e2e/engine/w06.test.mjs`'s output folder). Check that every cluster, round and the general review appear with no fixture-only fields missing. Lands as `wave-07.2` if W06 lands after W07 | test | S | H | W07-19, W06 engine e2e (soft) | `node --test e2e/engine/w07.test.mjs --test-name-pattern=w06-run` → 0 missing-field warnings, and the cross-check table row count equals the run's `debate/clusters.json` | — |
| W07-21 | Wave check: run demo steps 1–9, write `docs/plan/checks/w07-check.md` (which files to open, what to click, what to see, keyboard walk), gates green (`harness --self-test`, `npm test`, `npm run check:w07`), tag `wave-07` | docs | S | H | W07-19 | Follow `checks/w07-check.md` from a clean worktree → every step shows what it says | PRODUCT_WAVES §7 |
| W07-22 | "Verified" panel (OD-15, `H+`): on a reviewer page whose family is `nearai`, show each attestation check from `reviewers/<id>/attestation.json` with ok/fail and the nonce; a failed check shows a red pill and the reviewer's findings carry "unattested" | client | S | H+ | W07-12, W03-22 | Open the page for a replay `nearai` reviewer → the panel lists every check with its pass/fail pill; with a failed fixture the pill is red | OD-15 |

## Wave DoD

- `node scripts/harness.mjs --self-test && npm test && npm run check:w07` is green, and earlier engine wave checks still pass.
- `legacy-run` renders byte-identical to the pre-refactor snapshot (owner ask: same logic and visuals).
- Every new page passes the CSP and accessibility tests.
- `./bin/audit pdf` exports the new pages.
- Tag `wave-07` on the merge commit, and `wave-07.2` after W07-20 if W06 landed later.
