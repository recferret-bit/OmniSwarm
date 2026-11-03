# W14 — Submission Pack: owner check

Wave file: [`../waves/W14-submission-pack.md`](../waves/W14-submission-pack.md). Paths here are current (after the 2026-11-03 move).

## What an agent session can check (offline)

1. `bash tools/screener-check.sh` → `screener ok:` for each of the four README blocks (harness self-test, `./bin/audit demo --no-docker`, the guard attack demo, `npm run eval:golden`), then `secret sweep ok` and `screener check ok`.
2. `node tools/readme-eval-table.mjs --check` → `README eval table matches engine/eval/RESULTS.md`. After `npm run eval:golden` changes a number, run `node tools/readme-eval-table.mjs` and commit the README.
3. `npm run test:tools` → includes `tools/readme-eval-table.test.mjs`, which fails when the README table is stale.
4. Open `README.md` → layout, try-it, real review with presets and the key policy, report files, hosted flow with its status and known gaps, NEAR table, guard, golden eval, disclosures, baseline.
5. Open `docs/RULES.md` → one status line; every rule says what the engine does today.
6. Open `docs/hackathon/SUBMISSION.md` → every form field with its rule and a draft or an `<OWNER: …>` slot, the X post, the owner-only list, real versus mock.

## What only the owner can do

The list is in [`SUBMISSION.md`](../../hackathon/SUBMISSION.md#owner-only-actions): testnet deploy, the dogfood review with real models and its attestation ([`dogfood.md`](../../hackathon/dogfood.md)), the video ([`VIDEO.md`](../../hackathon/VIDEO.md)), the screener dry run with `claude -p` and `codex exec` ([`SCREENER.md`](../../hackathon/SCREENER.md)), the X post, the payout account, making the repo public, submitting the form, pushing the tags.

`npm run check:w14` runs the screener and then `npm run check:all`.
