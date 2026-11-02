# W14 — Submission Pack: owner check

Wave file: [`../waves/W14-submission-pack.md`](../waves/W14-submission-pack.md). The form, the X post, and making the repo public are not done.

`bash tools/screener-check.sh` clones this repo, unsets provider keys, and runs the README blocks.

- `node scripts/harness.mjs --self-test` prints `harness self-test ok`.
- `./bin/audit demo --no-docker` prints `DEMO — not a review`.

`tools/secret-sweep.sh` reports `secret sweep ok`: no tracked `reports/`, `pocs/`, or `.env`, and no high-confidence secret pattern in git history.

`npm run check:w14` runs that screener and then `npm run check:all`.
