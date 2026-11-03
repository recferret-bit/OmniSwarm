# W04 — Iteration Budget & Passes: owner check

Wave file: [`../waves/W04-iteration-budget.md`](../waves/W04-iteration-budget.md). About 5 minutes offline. No provider key is required.

## Before you start

- This landed from branch `wave/w04-iteration-budget`.
- `<fixture>` is `scripts/demo-fixture`. `<out>` is an empty directory you choose.
- Host checks set `OMNI_DEMO_HOST=1` so they do not start Docker.

## Steps

**1. Plan.**

```sh
./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline,scripted:lazy,key:zai:glm-5.3 --passes 2 --tool-budget 5 --surface s1 --plan
```

See `scripted-lazy  2 × 5 (+3)  discover, self-verify  max 16 calls  gate: bridge+loop` and `Pass roles: discover, self-verify`. `--passes 0` exits 2 with `passes must be 1–5`.

**2. Two passes.**

```sh
OMNI_DEMO_HOST=1 ./bin/audit run --repo scripts/demo-fixture --reviewers scripted:baseline,scripted:lazy --surface s1 --passes 2 --tool-budget 5 --out <out>
```

`scripted-lazy` pass 1 has `calls: 5` and `stop: budget`. Both reviewers have a pass 2 file. `harness/budget-scripted-lazy.json` records `finalizeOnlyAt` and `src/lib.rs`. `workers.json` has `passesCompleted: 2`. `harness/budget-health.json` is `COMPLETE`.

**3. Cost ceiling.**

```sh
OMNI_DEMO_HOST=1 OMNI_HTTP_REPLAY=scripts/provider-fixtures/w04 ZAI_API_KEY=zk-test ./bin/audit run --repo scripts/demo-fixture --reviewers key:zai:glm-5.3 --surface s1 --passes 2 --tool-budget 5 --max-cost-usd 0.0001 --out <out>
```

Pass 1 is `stop: cost`. Pass 2 is `skipped: cost_ceiling`.

**4. Grok turn cap.**

```sh
./bin/audit run --repo scripts/demo-fixture --reviewers cli:grok:grok-4.7 --tool-budget 10 --passes 1 --plan
```

See `--max-turns 13`.

## Automated checks

`npm test` and `npm run check:w04`. Since the 2026-11-03 fixes, check:w04 also drives the Docker path with a fake session: budgets and prices reach every session, each pass writes `harness/usage/<reviewer>/<surface>-pass-<k>.json`, a failed pass keeps the last committed pass, and `harness/budget-health.json` feeds `report-health.json`. `scripts/budget-matrix.test.mjs` runs the 24 family x passes x budget cases through the real pass loop and bridge.

## When you're done

All good: the merge commit is tagged `wave-04`. Something wrong: name the step and what you saw.
