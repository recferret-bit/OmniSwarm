# W06 — Orchestrator & Debate: owner check

Wave file: [`../waves/W06-orchestrator-debate.md`](../waves/W06-orchestrator-debate.md). About 5 minutes. No provider key and no Docker.

## Steps

**1. Plan.**

```sh
./bin/audit run --repo eval/golden/near-escrow --reviewers scripted:baseline,scripted:paranoid,scripted:wrong,scripted:lazy --orchestrator recommended --surface s1 --plan
```

See `debate rounds 2 (max 3)` and `debate cluster cap 25`, and the resolved orchestrator.

**2. Scripted debate.** The check runs this in-process. From a temp directory the same pipeline writes:

- `debate/clusters.json`
- `debate/round-1/Reviewer A-….json` (no model or vendor names)
- `debate/citations.json` with `valid: false` for `scripted:wrong`
- `debate/round-2/` with `conformitySuspect: true` for the lazy concession
- `debate/adjudication.json` with a `LIKELY` cluster
- `general-review.md` containing `Model agreement and passing checks do not certify security.`
- `debate/trace.jsonl` with a `judge` line and a `general_review` line

**3. Fault.** `OMNI_FAULT=general-review` writes `report-health.json` with `state: INCOMPLETE`.

**4. Golden eval.**

```sh
npm run eval:golden
```

Prints 6 repos and a table for debate, union, and majority vote. Writes `eval/RESULTS.md`.

## Automated checks

Before the merge: `npm test` (357 passed, then the bridge role list was updated for `debater` and `orchestrator` and that test was re-run) and `npm run check:w06`.

Not in this land: merge suggestions, four more golden repos, the rubric judge, and a live eval with provider keys.
