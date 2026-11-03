# W07 — Report v2: owner check

Wave file: [`../waves/W07-report-v2.md`](../waves/W07-report-v2.md). About 5 minutes. No provider key and no Docker. A local Chrome-family browser is used only for the PDF step.

Render into a scratch copy so the committed fixtures stay clean:

```sh
OUT=$(mktemp -d)
cp -r scripts/report-fixtures/legacy-run "$OUT/legacy"
node scripts/report-fixtures/v2-build.mjs "$OUT/v2"
```

## Steps

**1. Legacy snapshot.** `node scripts/generate-html-report.mjs "$OUT/legacy"` exits 0. `report.html` matches `scripts/report-fixtures/__snapshots__/legacy-report.html` after the CSP nonce and timestamps are normalized. The rail is `01 Overview`, `02 Findings`, `03 By model`, `04 Evidence & scope`, with no Cross-check, General review or `reviewers/`.

**2. V2 overview.** `node scripts/generate-html-report.mjs "$OUT/v2"` exits 0. The rail reads `01 Overview · 02 Findings · 03 By model · 04 Evidence · 05 Cross-check · 06 General review · Reviewers`. The general-review hero shows `high-risk`, three summary lines, a link to `Missing owner check` and the sentence `Model agreement and passing checks do not certify security.`

**3. Cross-check.** The table has one row per debate cluster: `Missing owner check` `DISPUTED` 2 rounds with the alternate judge `zai`, `Agreed check` `AGREED` 0 rounds, `Logged secret` `LIKELY`, and `Unchecked arithmetic` `CAPPED`, listed under `Not debated (cap)` as `CLUSTER-3 debate_cap`. Activating the `DISPUTED` chip leaves the disputed row.

**4. Findings.** The final-status chips, the reviewer select, the severity buttons and the search box filter the same list together (`scripts/report-cards-browser.test.mjs`). Expand `Missing owner check`: the Debate disclosure has `Reviewer A` (devil's advocate, ✓), `Reviewer B` (`✗ quote_not_found`), `Reviewer C` (`✗ unchecked`: the checker never recorded that citation), `Reviewer D` (conformity suspect), the rationale `Verified quotes disagree.` and the `DISPUTED` pill. `Unchecked arithmetic` shows the peer status `partial review`.

**5. Legend.** Six final statuses (`AGREED`, `CONFIRMED`, `LIKELY`, `DISPUTED`, `REFUTED`, `INSUFFICIENT_EVIDENCE`) and the five the engine emits (`MODEL_AGREEMENT`, `MODEL_ASSERTION`, `UPHELD_REVIEW`, `PARTIAL_REVIEW`, `REFUTED_REVIEW`), each with one line of meaning.

**6. Reviewers.** `reviewers.html` groups `cli → key → openrouter → scripted`; badges read `family · vendor · model`; the OpenRouter Qwen card shows `cost —`. `reviewers/cli-claude-opus/report.html` uses the shared shell, today's cards, the severity filter and search, and links its findings to the debate.

**7. By model.** `findings-by-model.html` has one row per reviewer id with High, Medium, Low, Total and Validation. A run without `reviewers/index.json` keeps the adapter page (`tests/e2e/engine/w07.test.mjs`, third test).

**8. PDF.** `./bin/audit pdf "$OUT/v2"` writes `report.pdf`, `findings-by-model.pdf`, `reviewers.pdf` and one PDF beside each reviewer page. The print copy expands disclosures, so `05 Cross-check` and `06 General review` are in the document.

**9. Source.** Every page's CSP carries a fresh nonce (two renders differ), every `<style>` and `<script>` carries it, there is no `on*=` handler and nothing loads from `http://` or `https://`. The general-review body shows `<script>alert(1)</script>` as text.

Keyboard: native `<details>` (no static `aria-expanded`), `aria-pressed` on every chip, labelled badges. Checked on the generated markup and on the script's behaviour, not in a separate GUI session.

## Automated checks

`node scripts/harness.mjs --self-test`, `npm test` and `npm run check:w07`, which includes the legacy snapshot and five v2 snapshots (report, findings-by-model, reviewers, one reviewer page, the report without a general review).

Not in this land: the de-anonymize toggle, a top-level `report.md`, and the NEAR AI attestation panel.
