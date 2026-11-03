# W06 — Orchestrator & Debate: owner check

Wave file: [`../waves/W06-orchestrator-debate.md`](../waves/W06-orchestrator-debate.md). About 5 minutes. No provider key and no Docker.

## Steps

**1. Plan.**

```sh
./bin/audit run --repo eval/golden/near-escrow --reviewers scripted:baseline,scripted:paranoid,scripted:wrong,scripted:lazy --orchestrator recommended --surface s1 --plan
```

See `debate rounds 2 (max 3)` and `debate cluster cap 25`, and the resolved orchestrator.

**2. Orchestrated scripted run.** `npm run check:w06` runs `tests/e2e/engine/w06.test.mjs`: the scripted panel's real submissions on `eval/golden/near-escrow`, then the orchestrator's own phase registry (`debate → adjudicate → general-review → reviewer-reports → report`), then `generate-html-report.mjs`. It asserts:

- `debate/clusters.json` holds the run's own clusters, queued in priority order;
- round files name `Reviewer A…` only, never a reviewer id, vendor or model;
- with two rounds there is no `round-3`; with three, round 3 exists only for clusters whose verdict changed, and a copied flip is `conformitySuspect`;
- every adjudication names the scripted judge, and both seeded bugs end `LIKELY` in `findings-and-scores.json`;
- `report.html` has the Debate disclosure, a `REFUTED` decoy and the 05 Cross-check rail entry.

**3. No fabrication on a real target.** `scripts/debate-phases.test.mjs` runs the phases on a scratch target that contains `saturating_sub` and `assert_eq!`: no finding, no `scripted-*` id and no `high-risk` posture is written. A target without those strings debates its real claim and does not throw. `--orchestrator scripted:judge` on that target is a `scripted_judge_demo_only` stage failure.

**4. Fault.** `OMNI_FAULT=debate-round-2` (or `general-review`) throws a coded error. The phase runner records `phase_failed:debate:…`, `report-contract.mjs` reports `One or more review stages failed`, the regenerated `report-health.json` is `incomplete`, and every per-model finding is still in the report. Nothing writes `meta.json` or `report-health.json` by hand.

**5. Golden eval.**

```sh
npm run eval:golden
```

Six repos in their own languages (Rust/NEAR, Anchor, Express, FastAPI, `near-api-js`, a plain crate). The table compares union, majority vote and the 1- and 2-round debate, all from the same scripted submissions, with a micro-averaged total. `eval/RESULTS.md` records the date, the commit and the OD-14 default-rounds decision with its reason.

## Automated checks

`node scripts/harness.mjs --self-test`, `npm test` and `npm run check:w06` (see the fix-team report for counts).

Not in this land: merge suggestions, the batched round-1 crosscheck (`--debate-batch`), four more golden repos, the rubric judge, and a live eval with provider keys. Model debaters and judges need the bridge-side hooks listed in the fix-team report before a real run can open their sessions; until then such a run is INCOMPLETE with `debate_incomplete`, and the claims stay `LIKELY` from the citation rules.
