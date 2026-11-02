# Screener

`bash tools/screener-check.sh` clones the repo, unsets provider keys, and runs every `<!-- screener -->` block in the README. Each block's output must contain its `you should see` line. `tools/secret-sweep.sh` then checks history and the index.
