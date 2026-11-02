# W00 — Foundation

> **Track:** Spine (lead only) · **Tag:** `wave-00` · **Check:** `npm run check:w00` · **Owner check:** [`../checks/w00-check.md`](../checks/w00-check.md)
> **Depends on waves:** none.
> **Owned paths:** `AGENTS.md`, `CLAUDE.md`, root `package.json` / `package-lock.json`, `shared/schemas/**`, `backend/README.md`, `frontend/README.md`, `contracts/README.md`, `infra/README.md`, `packages/README.md`, `eval/README.md`, `e2e/README.md`, `.github/workflows/ci.yml`, `tools/worktree-env.mjs`, `tools/wave.mjs` (H+), `scripts/agent-session-launch.mjs` (only the `runtimeAdapter` injection seam, R-19), `scripts/docker-mcp-bridge.test.mjs` (only the test at `:299`), `docs/plan/checks/w00-check.md`, `README.md` (only the new "Hackathon baseline" stub section).
> **Specs:** [`PRODUCT_WAVES.md`](../PRODUCT_WAVES.md) §1, §2, §4, §7 · [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §1, §1.1, §3, §6 · [`INTAKE.md`](../../spec/INTAKE.md) §1, §4, §6 · [`DECISIONS.md`](../../spec/DECISIONS.md) OD-09, OD-11, OD-12 · [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-19

## Goal

Every other wave can open in its own worktree on D3 without touching a shared file. The repo has its final layout, the rules for the new tracks are written into `AGENTS.md`/`CLAUDE.md` (so a lane agent does not refuse to create `backend/`), the cross-track contract is landed as JSON Schemas in `shared/schemas/`, CI runs every track's gate, the engine test suite is green without `runtime/node_modules`, and the hackathon baseline is ready to tag.

## Demo story (the check in words)

1. `git checkout wave/w00-foundation && npm ci` → installs workspace dev dependencies; `runtime/` is untouched.
2. `npm test` on a clone **without** `runtime/node_modules` → all engine tests pass (today 257/258, R-19).
3. `node scripts/harness.mjs --self-test` → `harness self-test ok (104 patterns)`; `cmp skills/security-audit/SKILL.md .claude/skills/security-audit/SKILL.md` → no output.
4. `npm run test:schemas` → every schema in `shared/schemas/` compiles and its valid/invalid example fixtures pass/fail as expected.
5. `ls backend frontend contracts infra packages eval e2e` → each folder exists with a `README.md` naming its track, owner wave and gate command.
6. Open `AGENTS.md` → a "Tracks and boundaries" section says NEAR RPC, wallets, GitHub API and the queue live only in `backend/`, `contracts/`, `frontend/`, `infra/`; `contracts/` may run `cargo test` on the developer host; the key policy of ORCHESTRATION §1.1 is stated.
7. `node tools/worktree-env.mjs --branch wave/w03-api-reviewers` → writes `.env.worktree` with `OMNI_PORT_BASE`, `DATABASE_URL=…/omniswarm_wave_w03_api_reviewers`, `OMNI_REPORTS_DIR=reports/wt-wave-w03-api-reviewers`.
8. Push the branch → GitHub Actions `ci.yml` runs engine, schemas, and the (empty-but-wired) intake/landing/contract/infra jobs, all green.
9. `git tag --list` shows nothing new yet; `docs/plan/checks/w00-check.md` prints the exact owner commands to create `pre-hackathon` at `94551b9` and push it.

## Hackathon slice

- Everything except the wave tool (`tools/wave.mjs`, H+) is `H`.
- **Deferred:** `tools/wave.mjs` automation (the commands in PRODUCT_WAVES §7 are the source of truth).
- **Owner-only:** creating and pushing tags (W00-14 prepares the commands; the owner runs them).

## Features covered

- [x] Repo layout + per-folder READMEs — W00-02
- [x] AGENTS.md / CLAUDE.md amendment: tracks, boundary, contracts host tests, key policy — W00-03, W00-04
- [x] Schemas: reviewer-spec, run-config, reviewer-report, debate-round, adjudication, general-review, job, intake-api, attestation — W00-01, W00-05..W00-09
- [x] Schema validator module + example fixtures + tests — W00-01, W00-10
- [x] Root scripts and npm workspaces without changing `npm test` — W00-11
- [x] Engine tests self-contained (R-19) — W00-12
- [x] CI workflow with one job per track — W00-13
- [x] Baseline tag preparation + README stub (OD-11) — W00-14
- [x] Worktree isolation script — W00-15
- [x] Minimal wave tool — W00-16 (H+)
- [x] Owner check guide + tag — W00-17

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W00-01 | Contract: `shared/schemas/` skeleton — `package.json` (`@omniswarm/schemas`, ESM, no build), `index.mjs` exporting `validate(name, value) → {ok, errors[]}` on a hand-rolled draft-2020-12 subset (type, required, properties, enum, pattern, items, oneOf, const, additionalProperties) with no runtime dependency, `examples/<name>/{valid,invalid}-*.json` convention | contract | M | H | — | `node -e "import('@omniswarm/schemas').then(m=>console.log(m.validate('reviewer-spec','cli:claude:opus').ok))"` → `true` | PRODUCT_WAVES §2 |
| W00-02 | Create `backend/`, `frontend/`, `contracts/`, `infra/`, `packages/`, `eval/`, `e2e/` with a `README.md` each: track letter, owning waves, owned subpaths, gate command, and the boundary sentence (§1 rule 6) | docs | S | H | — | `grep -l "Owning waves" */README.md` → 7 files; each names its gate command from PRODUCT_WAVES §7 | PRODUCT_WAVES §2 |
| W00-03 | AGENTS.md amendment: new "Tracks and boundaries" section (track table E/B/C/F/I/S, owned roots), the boundary rule (NEAR RPC, wallets, GitHub API, payments, queue only outside `scripts/`; intake spawns `./bin/audit` with argv, never `--rpc`, never widens reviewer permissions), "contracts/ `cargo test` and near-workspaces run on the developer host; the near-sdk no-`cargo test` rule applies to audited targets in the sandbox", and the Layout table extended | docs | S | H | W00-02 | Read AGENTS.md → a lane agent asked to "add `backend/intake/src/api`" finds the path listed as Intake-owned and the RPC rule scoped to non-engine roots | INTAKE §1, PRODUCT_WAVES §1.6 |
| W00-04 | AGENTS.md key policy + CLAUDE.md update: replace "no key enters the runtime" with ORCHESTRATION §1.1 (operator env only, one allow-listed var per reviewer process, never the bridge or sandbox, `keyFingerprint` only in reports, OpenRouter `data_collection: deny`); CLAUDE.md "How to change the suite" adds the per-track gates and says new engine modules stay flat in `scripts/` with prefixes | docs | S | H | W00-03 | `grep -n "keyFingerprint\|allow-listed" AGENTS.md CLAUDE.md` → the policy lines; `grep -n "no API key" README.md docs/*.md` → each hit is listed in the W00 merge note as a doc W03 must update when keys actually enter a reviewer runtime | ORCHESTRATION §1.1, R-20 |
| W00-05 | Schemas `reviewer-spec.schema.json` (string pattern `^(cli|key|openrouter|scripted):[a-z0-9-]+:[A-Za-z0-9._:/-]{1,128}(#[a-z0-9-]{1,40})?$` + parsed object form `{id,family,provider,vendor,model,label?}`) and `run-config.schema.json` (`reviewers[]`, `orchestrator` = spec or `"recommended"`, `alternateJudge?`, `assign: matrix|round-robin`, `passes` 1..5, `toolBudget` 5..200, `debate{rounds 1..3, toolBudget, maxClusters}`, `maxCostUsd?`, `presets{}`), with examples for the owner's default local preset and the `hosted` and `demo` presets | contract | M | H | W00-01 | `npm run test:schemas -- reviewer-spec run-config` → `openrouter:qwen/qwen3.8-max-0902` and `key:zai:glm-5.3#glm` valid; `bogus:x:y` and a run-config with `passes: 9` invalid | ORCHESTRATION §1, §3, OD-03, OD-04 |
| W00-06 | Schema `reviewer-report.schema.json` (per-reviewer `report.json`: `reviewer{…}`, `surfaces[]`, `findings[]` reusing today's auditor finding fields from `report-contract.mjs:120-139`, `verified_safe[]` with `provenance` separate from `evidence` (R-05)) and `usage.schema.json` (`passes[{k, calls, tokensIn, tokensOut, cost, stop: submitted|budget|cost|error, startedAt, endedAt}]`) | contract | S | H | W00-01 | Validate a finding copied from a current `auditors/*.json` wrapped in the new shape → valid; a finding without `location` → invalid | ORCHESTRATION §3, §6 |
| W00-07 | Schemas `debate-round.schema.json` (`{round, clusterId, role: challenge|devil|defend|rebut, anonId, verdict: upheld|partial|refuted|insufficient_evidence, citations[{file,startLine,endLine,quote}], argument, conformitySuspect?}`), `adjudication.schema.json` (`{clusterId, finalStatus: CONFIRMED|LIKELY|DISPUTED|REFUTED|INSUFFICIENT_EVIDENCE, severity, severityReason?, judge{reviewerId, vendor, alternate:bool}, rationale, validArguments[], discardedArguments[]}`), `general-review.schema.json` (fields of ORCHESTRATION §4.4, `riskPosture` enum without "secure", required fixed disclaimer `const`) | contract | M | H | W00-01 | A general review with `riskPosture: "secure"` → invalid; one missing the disclaimer → invalid | ORCHESTRATION §4.2–4.4 |
| W00-08 | Schemas `job.schema.json` (intake ↔ engine: input `{requestId, repo, commitSha, preset, network, outDir}`; output `{status, reportDir, healthState, reportSha256, maxSeverityConfirmed, generalReviewPath, costUsd}`) and `attestation.schema.json` (`{requestHash, reportSha256, reportUri, deployed?, codeHash?, maxSeverity}`) | contract | S | H | W00-01 | `job` example with `commitSha` of 39 chars → invalid; 40 hex → valid | INTAKE §3 (8–9), §6 |
| W00-09 | Schema `intake-api.schema.json`: every request/response DTO of INTAKE §4, status enum, error shape `{error:{code,message,retryable}}` and the error-code enum; one example per endpoint | contract | M | H | W00-01 | `npm run test:schemas -- intake-api` → 13 endpoint examples valid; `POST /api/requests` body without `signature` invalid | INTAKE §4 |
| W00-18 | `shared/schemas/canonical-message.mjs`: `canonicalRequestMessage({account,commit,deployed,network,nonce,preset,repo})` (sorted keys, no whitespace, `v:1`) and `requestHash(message)` (sha256 hex), browser- and Node-safe (Web Crypto), with fixed test vectors shared by W08 and W11 (INTAKE §3 step 4) | contract | S | H | W00-09 | `node --test shared/schemas/canonical-message.test.mjs` → the same input in any key order yields the same message and the vector hash | INTAKE §3 |
| W00-19 | `RULES.md` v0 at the repo root, written **before** any debate code (track 05 asks for rules first): the review round as swarm rules — roles, passes and tool budgets, anonymization, challenge/defend/rebut, citation rule, conformity flag, judge assignment, final statuses, no-silent-drop, stop conditions — plus a text sequence diagram of one cluster's debate; W14 finalizes it | docs | S | H | — | Open `RULES.md` → every rule in ORCHESTRATION §3–§4 appears once in plain words, and the sequence diagram shows one cluster from challenge to judge | ORCH §3, §4 |
| W00-10 | `shared/schemas/schemas.test.mjs` iterating every `examples/*/valid-*.json` / `invalid-*.json`; `npm run test:schemas` | test | S | H | W00-05..09 | Delete a `required` key from one schema → the matching invalid example now passes and the test fails naming the file | — |
| W00-11 | Root `package.json`: `workspaces: ["shared/schemas","backend/*","frontend/*","packages/*"]`; scripts `test:schemas`, `test:intake`, `test:landing`, `test:contract`, `test:e2e`, `check:infra`, `check:all`, `check:w00`; **`test` and `test:docker` unchanged**; lockfile regenerated; `runtime/` stays a separate lockfile | ops | S | H | W00-01, W00-02 | `npm test` runs exactly `scripts/*.test.mjs` (same count as before); `npm run check:all` runs schemas + engine and prints "skipped (no package yet)" for empty tracks | PRODUCT_WAVES §2, §7 |
| W00-12 | R-19: give `buildSessionLaunch` an injectable `runtimeAdapter` (default unchanged) and stub it in `docker-mcp-bridge.test.mjs:299`, so the suite passes without `runtime/node_modules` | test | S | H | — | On a fresh clone without `runtime/node_modules`: `npm test` → 0 failures (was 1, `runtime_missing`) | R-19 |
| W00-13 | `.github/workflows/ci.yml`: jobs `engine` (Node 24, `npm ci`, `harness --self-test`, `npm test`, skill-copy `cmp`), `schemas`, `intake` (Postgres 16 service), `landing`, `contract` (Rust stable + `wasm32-unknown-unknown`, `cargo test`), `infra` (`docker compose config`, shellcheck); each non-engine job no-ops with a notice until its folder has a `package.json`/`Cargo.toml`; no secrets, no Docker-marked tests | ops | M | H | W00-11, W00-12 | Push the wave branch → 6 jobs green on GitHub; break a schema example → `schemas` red | PRODUCT_WAVES §7 gates |
| W00-14 | Baseline (OD-11): add README section "Hackathon baseline" (stub: baseline = commits up to `94551b9` dated 2026-10-17; work since 2026-10-19 linked as `compare/pre-hackathon...hackathon-submission`, filled in W14); put the owner commands `git tag pre-hackathon 94551b9 && git push origin pre-hackathon` in `checks/w00-check.md`; do **not** tag | docs | S | H | — | `git log --format=%ad --date=short -1 94551b9` → `2026-10-17`; README shows the section; `git tag` unchanged | OD-11, HACKATHON.md Q-001/Q-003 |
| W00-15 | `tools/worktree-env.mjs --branch <name>`: derive `OMNI_PORT_BASE` (stable hash → 4100..4900 step 100), `DATABASE_URL` (`omniswarm_<branch_slug>` on the dev Postgres), `OMNI_REPORTS_DIR=reports/wt-<slug>`; write `.env.worktree`; add `.env.worktree` to `.gitignore`; unit test | ops | S | H | W00-11 | Run it for two branches → two different port bases and DB names; rerun → identical file | PRODUCT_WAVES §7 isolation |
| W00-16 | `tools/wave.mjs status|open NN|land NN --dry-run`: reads `docs/plan/waves/*.md` headers, refuses to open a wave whose **Depends on** waves are not tagged `wave-NN` in `main`, prints the PRODUCT_WAVES §7 commands | ops | M | H+ | W00-15 | `node tools/wave.mjs open 06 --dry-run` before `wave-03` exists → "W06 waits for W02, W03, W05 in main" | PRODUCT_WAVES §7 |
| W00-17 | Wave check: `npm run check:w00` (schemas + engine + `cmp` + layout presence), write `docs/plan/checks/w00-check.md` from the running branch (steps 1–9), tag `wave-00` on the owner's go | test | S | H | W00-01..15, W00-18 | `npm run check:w00` exits 0 and prints "W00 ok"; the guide's commands all run as written | PRODUCT_WAVES §7 step 5 |

## Wave DoD

- `npm test` green with and without `runtime/node_modules`; `harness --self-test` ok; skill copies identical.
- `npm run test:schemas` green; every schema in PRODUCT_WAVES §2 present with valid and invalid examples.
- AGENTS.md and CLAUDE.md state the track roots, the boundary and the key policy; no engine behaviour changed.
- CI green on the wave branch; `.env.worktree` generation works.
- `checks/w00-check.md` written; tag `wave-00` on the merge commit; `pre-hackathon` tag commands handed to the owner.
