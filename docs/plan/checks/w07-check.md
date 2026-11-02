# W07 — Report v2: owner check

Wave file: [`../waves/W07-report-v2.md`](../waves/W07-report-v2.md). About 5 minutes. No provider key and no Docker. A local Chrome-family browser is used only for the PDF step.

Worktree: `../OmniSwarm-wt/w07` on `wave/w07-report-v2`. The main checkout stays untouched until the land.

## Steps

**1. Legacy snapshot.**

```sh
node scripts/generate-html-report.mjs scripts/report-fixtures/legacy-run
```

Exit 0. `scripts/report-fixtures/legacy-run/report.html` matches `scripts/report-fixtures/__snapshots__/legacy-report.html` after the CSP nonce and timestamps are normalized. The rail is `01 Overview`, `02 Findings`, `03 By model`, `04 Evidence & scope`. It does not say Cross-check or General review.

**2. V2 overview.**

```sh
node scripts/report-fixtures/v2-build.mjs
node scripts/generate-html-report.mjs scripts/report-fixtures/v2-run
```

Exit 0. Open `scripts/report-fixtures/v2-run/report.html`. The rail reads `01 Overview · 02 Findings · 03 By model · 04 Evidence · 05 Cross-check · 06 General review`, then `Reviewers`. The first block under the report header is the general-review hero: risk posture `high-risk`, the three-line summary, and the sentence `Model agreement and passing checks do not certify security.`

**3. Cross-check.** Open **05 Cross-check**. The table has `Missing owner check` / `DISPUTED` / `2 rounds` and `Agreed check` / `AGREED` / `0 rounds`. Under `Not debated (cap)` is `CLUSTER-9 debate_cap`. The status chips are buttons. Activating `DISPUTED` leaves the disputed row.

**4. Debate.** Open **02 Findings**, expand `Missing owner check`. The Debate disclosure has round 1 (`Reviewer A` with `devil's advocate`, `Reviewer B` with `src/lib.rs:16 ✗ quote_not_found`), round 2 (`Reviewer C` with `conformity suspect`), the rationale `Verified quotes disagree.`, and the `DISPUTED` pill.

**5. Legend.** The status legend lists `AGREED`, `CONFIRMED`, `LIKELY`, `DISPUTED`, `REFUTED`, `INSUFFICIENT_EVIDENCE`, and the five legacy statuses, each with one line of meaning.

**6. Reviewers.** Open `reviewers.html`. Groups run `cli → key → openrouter → scripted`. The OpenRouter Qwen card shows `cost —`. Each card links to `reviewers/<id>/report.html`. `reviewers/cli-claude-opus/report.html` uses the same rail and contains `Missing owner check`. `reviewers/scripted-baseline/report.html` does not.

**7. By model.** Open `findings-by-model.html`. One row per reviewer id: `cli-claude-opus`, `key-zai-glm-5-3`, `openrouter-qwen-qwen3-8-max`, `openrouter-anthropic-claude-opus`, `scripted-baseline`. The two Anthropic reviewers are separate rows.

**8. PDF.**

```sh
./bin/audit pdf scripts/report-fixtures/v2-run
```

Writes `report.pdf`, `findings-by-model.pdf`, `reviewers.pdf`, and one PDF beside each reviewer page. `report.pdf` is a `%PDF` file. The print copy expands disclosures, so sections `05 Cross-check` and `06 General review` are in the document.

**9. Source.** View source of `report.html`, `reviewers.html`, or a reviewer page. The CSP meta carries a nonce, every `<style>` and `<script>` has that nonce, there is no `on*=` handler, and nothing is loaded from `http://` or `https://`. The general-review body shows the fixture's `<script>alert(1)</script>` as text.

Keyboard: Tab reaches the rail, the status chips, and the search box. Enter or Space toggles a finding's native disclosure. The chips expose `aria-pressed`. This was checked on the generated markup (one `<main>`, heading levels, nonce, no inline handlers), not by a separate GUI session.

## Automated checks

Before the merge: `node scripts/harness.mjs --self-test` (104 patterns), `npm test` (364 passed), and `npm run check:w07` (9 passed). A legacy render from this generator matched the pre-v2 generator after nonce normalization.

Not in this land: the de-anonymize toggle, a top-level `report.md`, and the NEAR AI attestation panel.
