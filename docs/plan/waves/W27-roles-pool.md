# W27 — Roles, pool and presets

> **Track:** Engine (E) with Lead (schemas) and Intake (B, one test) · **Tag:** `wave-27`, then `wave-27.2` · **Check:** `npm run check:w27` (= `node tools/wave-check.mjs 27`: the pool, registry, provider, run-config and plan tests, `tests/e2e/engine/w27*.test.mjs` and `node --test apps/api/test/unit/hosted-effective-config.test.ts`, then the coverage gate over this wave's modules)
> **Depends on waves:** W21 (scorecards and the baseline that role cards are built from), W24 (budgets, the price table, the plan print).
> **Soft dependencies:** W25 and W26 (the pool serves verifiers, refuters and judge seats; presets switch the ladder on). Until both land, presets that name the ladder print it as reserved. W27-09 wires the pool into the debate plan once `wave-26` is in `main`, as `wave-27.2`.
> **Specs:** [`DEBATE_V2.md`](../DEBATE_V2.md) §3 D4, D5 and §5 · [`DEBATE_V2_EVIDENCE.md`](../DEBATE_V2_EVIDENCE.md) `M8`, `M11`, `M14`, `M18`, `E5`, `E8`–`E10`, `E20`, `E21`, `E23`, `E27`, `E32` · [`AGENTS.md`](../../../AGENTS.md) "Key policy" · `DECISIONS.md` OD-20, OD-21, OD-22
> **Owned paths:** `engine/scripts/reviewer-pool*.mjs`, `engine/scripts/reviewer-registry.mjs`, `engine/scripts/reviewer-families.mjs`, `engine/scripts/provider-cli.mjs`, `engine/scripts/provider-openai-compat.mjs`, `engine/scripts/provider-key.mjs`, `engine/scripts/run-config.mjs` (pool and preset validation), `engine/scripts/docker-agent-orchestrator.mjs` (the judge list at the lines that build `planned.judges` and `reviewerById` only), `engine/scripts/reviewer-plan-feature-presets.mjs`, `engine/scripts/reviewer-plan-feature-pool.mjs`, `engine/scripts/debate-plan.mjs` (the `plan.pool` field only, W27-09), `engine/scripts/debate-phases.test.mjs` (W27-09 cases), `engine/omniswarm.config.example.json`, `engine/eval/rolecards*.mjs`, `engine/eval/rolecards.json`, `apps/api/test/unit/hosted-effective-config.test.ts`, `packages/schemas/**` (W27-01, lead), `docs/how-it-works.md` (append-only), `tools/wave-checks.json` (the W27 key), `tests/e2e/engine/w27*.test.mjs`, `docs/plan/checks/w27-check.md`
> **Not owned:** `bin/audit` and `orchestrate.sh` (flags reserved by W20), `debate-*.mjs` other than the one field, `orchestrator-*.mjs`, `apps/api/src/**` (the hosted preset and its argv allow-list are not edited, only tested).

## Goal

Choose the model for the job from measurements, and give the verification stages a model that is always available:

- **Role cards:** per vendor and role, measured commit rate, latency, tokens, canary catch rate, refusal rate. No more picking a judge by habit. A vendor that cannot commit reliably cannot rank first for a role (`E8`, `E21`; one model that is 6 times slower, `M8`, should not hold a role that needs speed).
- **A pool outside the reviewer set:** extra models that may act only as verifier, refuter, judge or summary writer, never as discovery reviewers. A three-vendor panel then always has an independent seat (`M18`: 28 of 63 clusters have no non-author vendor). Keys follow the key policy; a pool member must be priced so its ceiling can bind.
- **An effort dial per role:** low or medium for routing, high for verification, the highest for a critical judge, held constant inside a session (`E23`, `E27`). Today only Codex and the OpenAI-compatible API path set an effort (`high`); Claude, Grok and Agy set none.
- **Presets** `quick`, `standard`, `deep`, which set the budget, passes, verifier count, lane width and straggler grace in one word, with `--plan` showing what they cost.

Defaults leave today's behaviour unchanged.

## Demo story (the check in words)

1. `node engine/eval/rolecards.mjs engine/eval/replays/fixtures/baseline-3` → a table per role with `n`, mean and sd, the ranking, and `insufficient_data` for any vendor with fewer than 3 runs.
2. `./bin/audit run --repo engine/eval/twins/fullstack-dapp-fixed --preset standard --plan` → the plan lists the verify mode, verifier count, lane width, straggler grace, budget envelope and split, the pool and the chain for each role. A feature whose wave has not landed shows as `reserved`.
3. `./bin/audit run … --pool key:zai:glm-5.3 --pool-cost-usd 5 --plan` → the pool member appears under judges, never under reviewers, with its cost ceiling and key policy line (one environment variable named, no value). `--pool` without `--pool-cost-usd`, or a pool member with no price, is refused.
4. `./bin/audit run … --plan` with no new flag → the plan and launch specs are unchanged.
5. `node --test apps/api/test/unit/hosted-effective-config.test.ts` → the `hosted` preset's resolved config equals the pinned one.

## Slice

All rows are blank in the `H` column.

## Wave DoR

- [ ] `wave-21` and `wave-24` are in `main`; the lead has landed W27-01.
- [ ] OD-20 (the pool and its spend ceiling) and OD-22 are recorded before any live use of a pool member. The code lands without them, because `--pool` needs an explicit ceiling and is off by default. OD-21 is recorded for presets that set a lane width above 1.
- [ ] W27-00 answered below.
- [ ] The baseline repeats exist (`DEBATE_V2_BASELINE.md`), so role cards have data.
- [ ] No other open wave owns a listed path.

## Spike answers

Open until W27-00 is done. Record: the roles for which at least 3 runs per vendor exist; the effort control each CLI exposes (flag, environment variable or config key, from its own `--help`, quoted); which models the pool may name.

## Features covered

- [ ] Contracts: W27-01
- [ ] Role cards: W27-02
- [ ] Pool: W27-03
- [ ] Effort dial: W27-04
- [ ] Presets and plan print: W27-05
- [ ] Hosted effective-config guard: W27-06
- [ ] Docs: W27-07
- [ ] Wave check and tag: W27-08
- [ ] Pool wired into the debate plan (second landing): W27-09
- [ ] Spike: W27-00

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W27-00 | Spike (offline plus `--help`): from the baseline scorecards list the roles with at least 3 runs per vendor; read each CLI's `--help` for its effort control; decide which models the pool may name | test | S | | W21 | `docs/plan/waves/W27-roles-pool.md` (Spike answers) | Run each CLI's `--help` and compute the cards offline → "Spike answers" lists the rankable roles, the effort control for each CLI with the `--help` line quoted, and the allowed pool models | `E27` |
| W27-01 | Lead contract:<br>• schema `role-card`<br>• `run-config`: `verify.pool` becomes a list of `{spec, roles?}` with `verify.poolCostUsd`; an `effort` map by role; presets `quick`, `standard`, `deep`<br>• run-event kinds `pool_pick`, `effort_set` | contract | M | | W27-00 | `packages/schemas/**` | `npm run test:schemas` → valid fixtures pass; a pool member with the role `reviewer`, an effort outside the supported list, a preset with a negative budget, and a role card with `n: 0` and a rank fail (negative ×4) | `E8` |
| W27-02 | Role cards `engine/eval/rolecards.mjs`: from at least 3 runs per vendor and role compute `n`, mean, sd of commit rate, latency, canonical tokens, canary catch, refusal rate; deterministic ranking per role with guards; commit `rolecards.json` from the baseline | engine | M | | W27-01, W21 | `engine/eval/rolecards.mjs`, `engine/eval/rolecards.json`, `tests/e2e/engine/w27-rolecards.test.mjs` | `node --test tests/e2e/engine/w27-rolecards.test.mjs` → fixture scorecards give the exact ranking; ties break by cost then name; a vendor with commit rate below 0.9 cannot rank first for judge or verifier (negative); a vendor with 2 runs is `insufficient_data` and the default order is used (negative) | `E8`, `E21` |
| W27-03 | Pool `reviewer-pool.mjs`:<br>• `--pool` members become judges, verifiers, refuters and summary writers only, never discovery reviewers<br>• `--pool` needs `--pool-cost-usd`, and a pool member with no price is refused at plan time so the ceiling can bind<br>• per role pick by card then health, vendor not an author's, chain of at most 3, served entry recorded<br>• key policy: one allow-listed variable, `keyFingerprint` only in reports, OpenRouter `data_collection: "deny"`<br>• the judge list in `docker-agent-orchestrator.mjs` includes pool members | engine | M | | W27-01 | `engine/scripts/reviewer-pool.mjs`, `engine/scripts/reviewer-plan-feature-pool.mjs`, `engine/scripts/run-config.mjs` (pool validation), `engine/scripts/docker-agent-orchestrator.mjs` (judge list lines), their tests | `node --test engine/scripts/reviewer-pool.test.mjs engine/scripts/run-config.test.mjs` → a pool member is never given a discovery job (negative); the pick skips the authors' vendor; with the first chain entry unavailable the second serves and is recorded; the pool process environment holds exactly one allow-listed variable and no other key (negative); the report holds `keyFingerprint` and never the key (negative); `--pool` with no `--pool-cost-usd` is refused and an unpriced member is refused (negative ×2) | AGENTS.md key policy |
| W27-04 | Effort dial:<br>• `provider-cli.mjs`, `provider-openai-compat.mjs` and `reviewer-families.mjs` set effort from the role map<br>• defaults equal today's: `high` for Codex and the OpenAI-compatible path, unset for Claude, Grok and Agy<br>• fixed for the whole session, including a resumed one<br>• an unsupported value is refused at plan time | engine | M | | W27-01, W27-00 | `engine/scripts/provider-cli.mjs`, `engine/scripts/provider-openai-compat.mjs`, `engine/scripts/reviewer-families.mjs`, their tests | `node --test engine/scripts/provider-cli.test.mjs engine/scripts/provider-openai-compat.test.mjs engine/scripts/reviewer-families.test.mjs` → per family the launch spec carries the effort for each role (table); with the defaults the launch spec is byte-identical to today's (golden), including the families that set none; an unsupported effort is refused at plan time listing the supported ones (negative); a resumed session reuses its recorded effort (negative: it never changes) | `E23`, `E27` |
| W27-05 | Presets and `--plan`:<br>• `engine/omniswarm.config.example.json` gains `quick`, `standard`, `deep` as in `DEBATE_V2.md` §5, shipped with `verify.mode: debate` and the ladder values inactive<br>• `reviewer-plan-feature-presets.mjs` prints verify mode, verifier count, lane width, straggler grace, budget and split, pool and chains, and an estimated range from ledger medians<br>• a feature whose wave has not landed prints as `reserved` | engine | M | | W27-02, W27-03, W27-04 | `engine/omniswarm.config.example.json`, `engine/scripts/reviewer-plan-feature-presets.mjs`, `engine/scripts/run-config.mjs` (preset validation), their tests | `node --test engine/scripts/reviewer-plan.test.mjs engine/scripts/run-config.test.mjs` → `--preset standard --plan` prints every field above; an unknown preset lists the available ones (negative); a preset naming the ladder before W25 lands prints it as `reserved` and does not fail; `--plan` with no preset is unchanged (neutral) | OD-22 |
| W27-06 | Hosted effective-config guard: a test resolves `run-config.mjs resolve --preset hosted` and compares it with a pinned JSON, so a default flipped in `run-config.mjs` (for example `--verify`) cannot reach hosted runs unseen; it also asserts the intake worker's argv has no new flag and never `--rpc` | test | S | | W27-05 | `apps/api/test/unit/hosted-effective-config.test.ts` | `node --test apps/api/test/unit/hosted-effective-config.test.ts` → the hosted resolved config equals the pinned one (positive); a fixture where a series default differs makes the test fail (negative); `--rpc` or an unknown flag in the argv fails (negative) | AGENTS.md |
| W27-07 | Docs: `docs/how-it-works.md` documents presets, `--pool` with its ceiling, the effort map and the pool's key policy | docs | S | | W27-05 | `docs/how-it-works.md` | Run `grep -c "quick\|standard\|deep" docs/how-it-works.md` → at least 3, and the doc names `--pool-cost-usd`, the effort map and the pool's one-variable key rule | — |
| W27-08 | Wave check:<br>• `tests/e2e/engine/w27.test.mjs`: plan prints, neutrality, pool key policy, role-card fixture<br>• fill `tools/wave-checks.json` for W27<br>• `checks/w27-check.md`, tag `wave-27` | test | S | | W27-02..07 | `tests/e2e/engine/w27.test.mjs`, `tools/wave-checks.json` (the W27 key), `docs/plan/checks/w27-check.md` | `npm run check:w27` → green; `npm run check:all` → green | — |
| W27-09 | Pool wired into the debate plan (second landing, after `wave-26`): `debate-plan.mjs` sets `plan.pool` from the resolved pool, which the W26 panel and the W25 verifier tiers already read as empty by default | engine | S | | W27-03, W26 | `engine/scripts/debate-plan.mjs` (the `plan.pool` field only), `engine/scripts/debate-phases.test.mjs` | `node --test engine/scripts/debate-phases.test.mjs` → with a pool configured a scripted panel seat and a verifier tier come from the pool member; with no pool nothing changes (neutral); a pool member is never an author or a discovery reviewer (negative) | `M18` |

**Parallel groups:**
1. W27-00 (spike).
2. W27-01 (lead).
3. W27-02, W27-03, W27-04.
4. W27-05.
5. W27-06, W27-07.
6. W27-08.
7. Second landing, after `wave-26`: W27-09.

## Test plan

- **Per issue:** positive and negative cases as written in the acceptance cells.
- **Files:** `reviewer-pool.test.mjs`, `run-config.test.mjs` (extended), `reviewer-plan.test.mjs` (extended), `provider-cli.test.mjs` (extended), `provider-openai-compat.test.mjs` (extended), `reviewer-families.test.mjs` (extended), `debate-phases.test.mjs` (extended), `tests/e2e/engine/w27*.test.mjs`, `apps/api/test/unit/hosted-effective-config.test.ts`. A test file the plan names that does not exist yet is created by its issue.
- **Coverage:** the gate → new modules at least 95% lines, 85% branches, 90% functions; changed modules not below `M17` (`provider-cli` 93.4 / 80.0, `reviewer-plan` 100 / 84.1, `run-config` 98.5 / 91.9, `docker-agent-orchestrator` 92.1 / 82.9).
- **Secrets:** the secret sweep runs over every fixture this wave adds.

## Analytics

- **Events:** `pool_pick{role,clusterId,served,chain}`, `effort_set{role,effort}`.
- **Metrics (module files in `scorecard-metrics/`, added by W25 or later):** `role_card_n{vendor,role}`, `pool_served_rank` (which chain entry served), `pool_spend_usd`, `effort_by_role`, `cost_per_role{vendor}`.
- **Artifacts:** `engine/eval/rolecards.json` (dated), `harness/reviewers.json` `pool`, the scorecard (W21).
- **Watch:** `pool_served_rank` above 1 for most clusters means the first-choice judge is unreliable; `pool_spend_usd` at the ceiling stops pool use for the rest of the run and is listed as a gap.

## Proof

| Tier | Proof | Pass |
|---|---|---|
| P1 unit | Tests above | green; coverage gate green |
| P2 replay | Role cards over the baseline fixtures | ranking equals the pinned expected order; `insufficient_data` where n is under 3 |
| P4 neutrality | No new flag | launch specs and `--plan` byte-identical to before (effort as today per family) |
| P4 key policy | Pool tests | one environment variable, `keyFingerprint` only, `data_collection: "deny"`, no pool member in a discovery job, a ceiling that binds |
| P4 hosted | `hosted-effective-config` | hosted resolved config unchanged |
| P5 live (owner lane, after OD-20 and OD-22) | One run on the fixed twin with one pool judge | the pool member judges at least one cluster; spend at most `--pool-cost-usd`; the report holds only the key fingerprint; the chain entry served is recorded |

## Risks and rollback

- **Cards from a small sample mislead.** `insufficient_data` below 3 runs, sd printed beside every mean, the snapshot dated.
- **Pool spend.** A hard ceiling per run (`--pool-cost-usd`), required, and every pool member must be priced.
- **Effort values differ per vendor.** The spike records each CLI's control; unsupported values are refused at plan time, not silently ignored.
- **A pool key leaking.** The key policy tests and the secret sweep; the pool process gets one variable.
- **A preset default reaching hosted runs.** The hosted effective-config test.
- Rollback: revert the wave merge; `--pool` and the presets are additive.

## Wave DoD

- Acceptance passes for every issue, with output in the merge commit body.
- `check:w27`, `check:all`, `check:v2` green; coverage gate green; neutrality, key policy and hosted proofs green.
- Presets, `--pool` and the effort map documented.
- No file outside owned paths changed; no key, host path or `reports/` content committed; secret sweep clean.
- `checks/w27-check.md` written from the running result. Tag `wave-27` after the owner check; `wave-27.2` after `wave-26` lands.
