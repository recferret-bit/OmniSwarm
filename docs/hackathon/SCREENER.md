# Screener

`bash tools/screener-check.sh` clones the committed `HEAD` into a temp directory, unsets provider keys, and runs every `<!-- screener -->` block in the README in order. A block passes only when its command exits 0 and its output contains the `you should see` line. A block that prints `Demo report saved to: <dir>` must also have written `report.html` stamped DEMO, `reviewers/index.json`, `debate/clusters.json`, `debate/adjudication.json` and `general-review.json`. `tools/secret-sweep.sh` then checks history and the index.

The README has four blocks: the harness self-test, `./bin/audit demo --no-docker`, the guard attack demo and `npm run eval:golden`. None needs `npm ci`, Docker or a key.

Not done yet (owner): a dry run with the judges' own tools (`claude -p` and `codex exec` on a clean clone, prompt "Clone, follow the README, check it runs and does what it says; report gaps"). Record the date, tool versions and the gap list here.
