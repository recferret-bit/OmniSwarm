# W05 — Per-Reviewer Reports: owner check

Wave file: [`../waves/W05-per-reviewer-reports.md`](../waves/W05-per-reviewer-reports.md). About 2 minutes. No keys and no Docker.

## Steps

**1. Derive.**

```sh
node scripts/reviewer-reports.mjs scripts/report-fixtures/w05-run
```

See `reviewers/` with `cli-claude-opus`, `key-zai-glm-5-3`, `openrouter-qwen-qwen3-8-max`, and `scripted-baseline`. Each has `report.json`, `report.md`, `report.html`, `usage.json`, and `passes/`.

**2. One model.** Open `scripts/report-fixtures/w05-run/reviewers/key-zai-glm-5-3/report.html`. The header is `Approach 2 · API key · vendor zai · model glm-5.3 · 2 passes · 63 calls · $0.41`.

**3. Index.** Open `reviewers.html`. Headings: Local subscriptions, API keys, OpenRouter, Demo.

**4. Contract.**

```sh
node scripts/report-contract.mjs scripts/report-fixtures/w05-run
```

Prints `COMPLETE`. Adding `auditors/stray.json` prints `INCOMPLETE` and `unexpected auditor stray`.

**5. Missing surface.** Delete `submissions/key-zai-glm-5-3-s2-input.json` and derive again. That reviewer's `report.json` has `status: INCOMPLETE` and gap `S2`. The row stays on `reviewers.html`.

**6. Provider roll-up.** `reviewers/by-provider/openrouter-alibaba.json` lists `openrouter-qwen-qwen3-8-max`.

## Automated checks

Before the merge: `npm test` (351 passed) and `npm run check:w05` (4 passed). The first full run failed one Docker audit because derived reports rejected controls that omit provenance. Derivation now records those as `model_assertion`. The suite was run again and passed.
