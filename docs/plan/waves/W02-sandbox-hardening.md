# W02 — Sandbox Hardening

> **Track:** Engine (E) · **Tag:** `wave-02` · **Check:** `npm run check:w02` (= `npm test` + `harness --self-test` + `npm run test:docker -- --test-name-pattern hardening`) · **Owner check:** [`../checks/w02-check.md`](../checks/w02-check.md)
> **Depends on waves:** W01 (reviewer ids and `harness/reviewers.json`; orchestrator phase registry, so lifecycle/log paths are edited in one place).
> **Owned paths:** `scripts/docker-mcp-bridge.mjs`, `scripts/bridge-tools-*.mjs` (new), `scripts/sandbox.sh`, `scripts/sandbox-inside.mjs`, `scripts/sandbox-lib.mjs`, `scripts/sandbox-lifecycle.mjs`, `scripts/review-workflow.mjs`, `scripts/audit-process.mjs`, `scripts/agent-launch.mjs`, `scripts/audit-tool-policy.mjs`, `scripts/model-cli-*.mjs` (temp prefix only), `native/codex-review/src/main.rs` (temp prefix only), `docker/**`, `scripts/harness-fixtures/hostile/**` (new), `scripts/docker-agent-orchestrator.mjs` (only the lifecycle/log path lines `:96-112`, `:218-223`, `:346-350`, after W01 lands), their `*.test.mjs` / `*.docker.mjs`.
> **Specs:** [`PROJECT_REVIEW.md`](../PROJECT_REVIEW.md) R-01, R-02, R-04, R-07, R-08, R-09, R-12, R-16 · [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §1.1 (no key reaches the bridge), §4.2 (citation checker reads `/src`) · AGENTS.md "Boundaries that the code enforces"

## Goal

Code under review can no longer influence what reviewers see. A hostile fixture whose own test suite tries every known trick — replace the bridge's `node`, rewrite the source tree, leave a daemon behind, forge `lifecycle.json`, plant "usage limit reached" text — runs through a full review and the reviewers still read the sealed source through an untampered bridge. The bridge's tools are split per role so W04 (budget counter) and W06 (debate tools) add files instead of editing the dispatcher, and the bridge accepts reviewer ids from the registry.

## Demo story (the check in words)

1. `npm run test:docker -- --test-name-pattern hardening` → the hostile fixture `scripts/harness-fixtures/hostile/` runs its `npm test` (which writes `/work/bin/node`, edits `src/lib.js`, starts a `setsid` sleeper, writes `/out/lifecycle.json` with `lost`, and prints "usage limit reached") and every assertion below passes.
2. After the hostile suite, a bridge `read_file src/lib.js` returns the **original** content and `harness/source-read-digest.json` equals `source-manifest.json`'s digest (R-02).
3. The bridge process's `/proc/<pid>/exe` is `/usr/local/bin/node`; `/work/bin` is `root:root 0755`; the planted `/work/bin/node` never ran (marker file absent) (R-01).
4. `ps -u 10001` inside the container after the suite → only the bridge's own children; the sleeper is gone (R-02).
5. The orchestrator keeps the review running: the forged `lifecycle.json` lives in the container's `/out` but the host reads lifecycle and agent logs from `harness/host/` (R-04).
6. `./bin/audit run --restart-failed` on that run is **not** blocked by the planted text; `classifyAuditFailure` only reads structured RPC error frames (R-07).
7. `./bin/audit check-agents` with AGY → a preflight proves a denied tool (`Bash`) is refused under the PreToolUse hook; with the hook removed the preflight fails closed and AGY is marked unavailable (R-08).
8. `node --test scripts/docker-mcp-bridge.test.mjs` → `submit_audit_report` without `submissionIdentity` is rejected (R-09); a 5 000-char minified line read via `read_file` ends with `… [truncated 4 600 chars]` (R-12); `tools/list` for roles `auditor`, `crosscheck`, `verification` is assembled from `bridge-tools-<role>.mjs` and is byte-identical to `main`'s tool list.

## Hackathon slice

- `H`: R-01, R-02, R-04, R-07, R-09, the per-role tool split, the registry ids at bridge `:66`, the hostile fixture and its Docker test.
- `H+`: R-08 AGY preflight (AGY can be dropped from the hosted preset; OD-04 uses no `cli` reviewers), R-12 truncation marker, R-16 `fc-` → `omni-` prefixes.
- **The `@hack` demo steps:** 1–6, 8.
- **Deferred:** none of the Critical/High items.

## Features covered

- [x] Hostile fixture + Docker regression test harness — W02-01, W02-13
- [x] Reviewer ids from `harness/reviewers.json` at bridge `:66` — W02-02
- [x] Per-role bridge tool registry — W02-03
- [x] R-01 absolute node, PATH, `/work/bin` ownership — W02-04
- [x] R-02 reads from `/src:ro`, tests on a per-run copy, kill uid-10001 leftovers, read digest — W02-05..W02-07
- [x] R-04 host-only lifecycle and logs — W02-08
- [x] R-07 structured failure classification — W02-09
- [x] R-09 remove the non-identity submit path — W02-10
- [x] R-08 AGY hook preflight — W02-11
- [x] R-12 truncation marker — W02-12
- [x] R-16 temp prefixes — W02-14
- [x] Bridge never receives keys (env test) — W02-15
- [x] Wave check — W02-16

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W02-01 | Contract: hostile fixture `scripts/harness-fixtures/hostile/` (small Node package; `npm test` script performs the five attacks of demo step 1, each writing a marker under `/tmp/hostile-*` only if it *executes later*) + `expected.json` listing the invariants; `harness --self-test` unaffected (fixture excluded from lead patterns) | contract | S | H | — | `node scripts/harness.mjs --self-test` → ok; `cat scripts/harness-fixtures/hostile/expected.json` lists 6 invariants | R-01, R-02, R-04, R-07 |
| W02-02 | Bridge reviewer ids: replace the hard-coded adapter list (`docker-mcp-bridge.mjs:66`) with ids from `harness/reviewers.json` (written by W01-06), passed as `--reviewers-file`; unknown identity → `IDENTITY_UNKNOWN` | engine | S | H | W01-06 | Bridge started with a reviewers file containing `openrouter-qwen-qwen3-8-max` accepts that identity; `rogue` → rejected | R-17, ORCH §1 |
| W02-03 | Per-role tool registry: move `toolDefinitions(role)` (`docker-mcp-bridge.mjs:218-332`) and each role's handlers into `scripts/bridge-tools-auditor.mjs`, `bridge-tools-crosscheck.mjs`, `bridge-tools-verification.mjs`, auto-loaded by role; the dispatcher (`:617-627`) keeps one `beforeCall(ctx, name)` hook point for W04's counter | engine | M | H | W02-02 | Snapshot test: `tools/list` JSON for each role is byte-identical to `main`; a dummy `bridge-tools-test.mjs` adds a role without editing the dispatcher | PRODUCT_WAVES §4 |
| W02-04 | R-01: bridge spawns `/usr/local/bin/node` by absolute path at `:422, :440, :480, :508`; bridge env `PATH=/usr/local/bin:/usr/bin:/bin` (drop `/work/bin`, `:201`); `sandbox.sh:298` init container makes `/work/bin` `root:root 0755`; unit test asserts the spawn argv and env | security | M | H | W02-03 | `node --test scripts/docker-mcp-bridge.test.mjs` → spawn argv[0] is `/usr/local/bin/node`, `PATH` has no `/work`; Docker test step 3 passes | R-01 |
| W02-05 | R-02 (reads): add `/src` (read-only mount, `sandbox.sh:321`) to `CONTAINER_ROOTS` (bridge `:26`) and serve `read_file`, `list_files`, `search_code` from `/src`; `/work/src` stays only for test execution | security | M | H | W02-03 | After the hostile suite edits `/work/src/src/lib.js`, `read_file src/lib.js` returns the sealed content | R-02, ORCH §4.2 |
| W02-06 | R-02 (tests): each `run_existing_tests` runs on a fresh per-run copy (`/work/runs/<n>/src` from `/src`) and, after the suite, `pkill -KILL -u 10001` except the bridge's own process tree; the runner records killed pids in `existing-test-results-<key>.json` | security | M | H | W02-05 | Docker test step 4: no uid-10001 process outlives the suite; results file lists the killed sleeper pid | R-02 |
| W02-07 | R-02 (digest): bridge writes `harness/source-read-digest.json` (sha256 tree digest of `/src` at first read) and `report-contract` compares it with `source-manifest.json`; mismatch → INCOMPLETE with reason `SOURCE_DIGEST_MISMATCH` | security | S | H | W02-05 | Tamper the digest file in a fixture report → report INCOMPLETE naming the mismatch | R-02 |
| W02-08 | R-04: move `lifecycle.json` and `agent-*.log` / `crosscheck-*.log` to host-only `harness/host/` written by the host process (`sandbox-lifecycle.mjs`, orchestrator `:96-112, :218-223, :346-350`, `report-contract.mjs:181-187` reads); `/out` is mounted read-only into `docker exec` test runs | security | M | H | W02-06 | Docker test step 5: a forged `/out/lifecycle.json` with `lost` does not stop the review; `harness/host/lifecycle.json` stays `running` | R-04 |
| W02-09 | R-07: `classifyAuditFailure` (`audit-process.mjs:34-44`) classifies only structured ACP/JSON-RPC error frames (`error.code`, `error.data.reason`) recorded by the session, never raw log text; tests with a log containing "usage limit reached" quoted from target source | security | S | H | W02-08 | Demo step 6: `--restart-failed` proceeds; unit test: quoted text → `unknown`, a real RPC quota frame → `quota` | R-07 |
| W02-10 | R-09: delete the non-identity submit path (bridge `:528-538, :547-559, :578-588`); every submit requires `submissionIdentity` and the evidence checks of `:525-538` | security | S | H | W02-03 | `submit_audit_report` without identity → `IDENTITY_REQUIRED`; existing identity tests green | R-09 |
| W02-11 | R-08: AGY preflight in `agent-launch.mjs:54-65` / `check-agents`: start AGY with the hook, ask it to call a denied tool, require a recorded refusal before any review session; on failure mark AGY `unavailable: hook_not_enforced` | security | M | H+ | W02-03 | Demo step 7 both ways (with hook → passes; hook removed → AGY unavailable) using a recorded fixture, no live call in `npm test` | R-08 |
| W02-12 | R-12: `read_file` with `keepTail=false` (bridge `:152-168`) appends `… [truncated N chars]` to any cut line | engine | S | H+ | W02-03 | 5 000-char line → ends with the marker and the exact count | R-12 |
| W02-13 | Docker regression test `scripts/sandbox-hardening.docker.mjs`: full `--review-only` sandbox on the hostile fixture with `scripted` placeholder reviewer calls via `callBridgeTool` (no LLM), asserting the six invariants of `expected.json` | test | M | H | W02-04..W02-10 | `npm run test:docker -- --test-name-pattern hardening` → 6/6 invariants pass on the local image | R-01, R-02, R-04, R-07 |
| W02-14 | R-16 (native prefix): rename `fc-` temp-dir prefixes to `omni-` in `model-cli-status.mjs:21`, `model-cli-claude.mjs:142`, `model-cli-codex-native.mjs:21`, `model-cli-grok-native.mjs:46`, `model-cli-grok-docker.mjs:133`, `native/codex-review/src/main.rs:88` and tests; README note that old `freightchain-*` Docker volumes can be removed (grok-docker needs a fresh login) | engine | S | H+ | — | `grep -rn "\"fc-\|'fc-" scripts native/*/src` → none; native tests green | R-16 |
| W02-15 | Key isolation test: spawn the bridge and the sandbox exec with a parent env containing `ZAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`; assert none reaches the bridge env or `docker exec` env | security | S | H | W02-04 | `node --test scripts/docker-mcp-bridge.test.mjs` → "bridge env carries no provider key" passes | ORCH §1.1 |
| W02-16 | Wave check: `npm run check:w02`; `checks/w02-check.md` (steps 1–8, with the exact `docker exec` commands for steps 3–4); update AGENTS.md boundary list via a lead change request (reads from `/src`, tests on per-run copies, host-only lifecycle); tag `wave-02` | test | S | H | W02-01..10, W02-13, W02-15 | `npm run check:w02` exits 0 on a machine with the local image; guide commands run as written | PRODUCT_WAVES §7 |

## Wave DoD

- The hostile fixture's six invariants pass in Docker; `npm test` and `harness --self-test` green; skill copies untouched.
- `tools/list` per role identical to `main`; per-role tool files load without dispatcher edits; `beforeCall` hook present for W04.
- R-01, R-02, R-04, R-07, R-09 fixed, each with a regression test; no provider key reaches the bridge or sandbox.
- AGENTS.md boundary change request filed for the lead; tag `wave-02` on the merge commit.
