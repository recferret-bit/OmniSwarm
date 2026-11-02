# Project review — OmniSwarm `main` @ `ac170f1` (2026-11-02)

> Read-only review of the engine, plus test results, against the hackathon goal. Every finding has an id `R-xx` that wave issues cite. Line numbers are from `ac170f1`.

## 1. Verdict

OmniSwarm is a solid, honest review engine: a sealed snapshot, an offline sandbox, a restricted MCP bridge, hash-committed submissions, peer cross-checks, clustering and a report that says INCOMPLETE instead of guessing. **It is not yet a hackathon project on NEAR:** "NEAR" today means *detecting* NEAR code in audited repos; there is no wallet, payment, account, contract or attestation. And for a project entering the **security** track, three sandbox weaknesses (R-01, R-02, R-04) must be fixed first, because a target's own test suite can influence what reviewers see.

| Area | State | Plan |
|---|---|---|
| Tests | `npm test`: 257/258 pass (the failure needs `runtime/node_modules`, R-19). `harness.mjs --self-test`: ok, 104 patterns. Skill copies byte-identical | W00 makes the suite self-contained |
| Providers | 4 adapter names hard-coded in ~15 places; one model per adapter; no API-key path; slugs with `/` rejected | W01 registry, W03 families |
| Iteration control | One `session/prompt` with no timeout; tool calls are logged, not counted; `finalizeOnly` exists but is never set | W04 |
| Cross-check | One session per adapter reviews all peer claims at once, all-or-nothing, on surface `S1` | W01 (R-06), W06 |
| Report | Good structure; cannot hold per-model sub-reports, debate rounds or a general review; unknown `auditors/*.json` turns a run INCOMPLETE | W05, W07 |
| NEAR integration | none | W08–W13 |

## 2. Findings (ranked)

| ID | Sev | Finding | Where | Fix | Wave |
|---|---|---|---|---|---|
| **R-01** | Critical | Target code can replace the bridge's `node`: the bridge puts `/work/bin` first in `PATH` and runs bare `node`; `/work/bin` is owned by uid 10001; catalogued target tests run as 10001 **before** reviewers start | `docker-mcp-bridge.mjs:201, 422, 440, 480, 508`; `sandbox.sh:298`; `docker-agent-orchestrator.mjs:409-414` | Absolute `/usr/local/bin/node`; drop `/work/bin` from the bridge `PATH`; make `/work/bin` root-owned; regression fixture whose `npm test` writes `/work/bin/node` | W02 |
| **R-02** | High | Reviewers read the live, writable `/work/src` that target tests just ran in; a `setsid` daemon survives the process-group kill; read-only `/src` is mounted but not served | `sandbox-inside.mjs:479-488`; `review-workflow.mjs:197`; `docker-mcp-bridge.mjs:26`; `sandbox.sh:321` | Serve reads from `/src:ro`; run tests on a per-run copy; kill every uid-10001 process after each suite; record the digest of what reviewers read | W02 |
| **R-03** | High | A crash during cross-check leaves `meta.json` `finalized:true` without `workflow`/`submissionAuthority`, so report validation skips the canonical-submission and coverage-gap checks | `docker-agent-orchestrator.mjs:480-486`; `report-contract.mjs:108, 229` | Keep `finalized:false` until teardown and spread `initialMeta`; require `mcp_commit` whenever `submissions/` exists | W01 |
| **R-04** | High | The container can write host control files: `/out` (`harness/sandbox-run`, mode 777) holds `lifecycle.json` and `agent-*.log`, which drive resume, `--restart-failed` and failure text | `docker-agent-orchestrator.mjs:96-112, 218-220, 346-350`; `report-contract.mjs:181-187` | Move agent logs and lifecycle to a host-only folder; `/out` read-only for exec'd tests | W02 |
| **R-05** | High | Every verified-safe control shows "model_assertion" instead of its evidence | `verify-and-adjudicate.mjs:61`; `generate-html-report.mjs:330` | Store the label as `provenance`, keep `evidence` | W01 |
| **R-06** | Medium | Cross-check bridges default to surface `S1`, so cross-check context and plans are filtered to S1 | `docker-agent-orchestrator.mjs:381`; `docker-mcp-bridge.mjs:46, 58` | Pass `--surface ALL` for cross-check | W01 |
| **R-07** | Medium | Failure classification regexes run over logs that echo target source ("usage limit reached" in a target file can block `--restart-failed`) | `audit-process.mjs:34-44` | Classify only structured RPC error frames | W02 |
| **R-08** | Medium | AGY permission enforcement fails open if the CLI ignores the PreToolUse hook under `--dangerously-skip-permissions` | `agent-launch.mjs:54-65` | Preflight proving a denied tool is refused before the session starts | W02 |
| **R-09** | Medium | A non-identity submit path in the bridge skips the attack/PoC check and writes directly; unreachable from `audit run` but contradicts the stated boundary | `docker-mcp-bridge.mjs:528-538, 547-559, 578-588` | Delete it or require `submissionIdentity` | W02 |
| **R-10** | Medium | Cross-check does not scale: one session reviews every peer claim, all-or-nothing | `docker-agent-orchestrator.mjs:501-511`; bridge `:127` | Batch claims per turn; budget by claim count | W06 |
| **R-11** | Low | Cross-check failures are not recorded in `providerFailures` | orchestrator `:474` | Record them | W01 |
| **R-12** | Low | `read_file` truncates long lines silently | bridge `:152-168` | Add an omission marker | W02 |
| **R-13** | Low | `meta.json`/`workers.json` writes are not atomic | `report-contract.mjs:24-36` | Temp file + rename | W01 |
| **R-14** | Low | Dead branches: orchestrator `:463-469`, `:520-524`; `verify-and-adjudicate.mjs:127` | — | Remove | W01 |
| **R-15** | Debt | Dead code: `bin/audit:120` (`--rpc` append), duplicate "Options (run):" at `:186`; unused `CODEX_EFFORT` (`orchestrate.sh:28`, effort hard-coded at `agent-session-launch.mjs:47`); `crosscheck.mjs` `prepare` CLI and `KNOWN_MODELS`; `runAgentProcess` used only by tests; `finalizeOnly` never set; `legacyConversationId` never set; non-review-only sandbox paths (ZAP `:stable`, solana-verify, deployed-compare) | listed | Remove or wire (`finalizeOnly` becomes W04's budget switch) | W01, W04 |
| **R-16** | Debt | Leftovers from earlier projects: `fc-` temp prefixes (`model-cli-*.mjs`, `native/codex-review/src/main.rs:88`); app-specific guidance in generic plans (`fc_admin`, `__Host-fc_session`, `bots_economy`, `ReplayEngine`, `mulberry32` in `audit-plans.mjs:12, 152, 201-307`, orchestrator prompt `:168`); "AUDIT / CORE" branding (`generate-html-report.mjs:276`); `audit/scripts`, `audit/reports` paths in comments | listed | Rename to `omni-`, move app-specific guidance out, rebrand the report header "OmniSwarm" | W01 (plans, branding), W02 (native prefix) |
| **R-17** | Design | (a) OpenRouter slugs with `/` rejected (`orchestrate.sh:31`, `agent-session-store.mjs:11`, `audit-submission.mjs:12`); (b) one model per adapter, `identity.model === meta.models[agent]` (`report-contract.mjs:113`); (c) peer filtering by vendor via a `providerOf('<x>-s1-auth')` hack (`verify-and-adjudicate.mjs:113`); (d) round-robin assignment leaves reviewers idle when > 6 | listed | Reviewer id ≠ family ≠ vendor ≠ model; matrix assignment | W01 |
| **R-18** | Design | (a) `report-contract.mjs:211` rejects unknown `auditors/*.json`; (b) `verify-and-adjudicate.mjs` runs at import time, so it cannot be unit-tested or reused | listed | New folders for new artifacts; export a function | W01 (b), W05 (a) |
| **R-19** | Test | `docker-mcp-bridge.test.mjs:299` needs `runtime/node_modules`; no tests for PATH/`/work` integrity, crash-time meta, cross-check surface, verified-safe evidence in HTML | listed | Stub `runtimeAdapter`; add the missing tests with their fixes | W00, W01, W02 |
| **R-20** | Docs | Docs drift: npm suite budget "90 seconds" in `SKILL.md:114` and how-it-works vs 900000 ms in code; pytest 15 vs 30 min; "no API key enters the runtime" must change with W03 | listed | Fix with both skill copies | W01, W03 |

## 3. Hackathon gaps (from [`../hackathon/TRACKS.md`](../hackathon/TRACKS.md))

1. Nothing runs on NEAR → W08–W10 (login, signed request, payable contract, attestations).
2. The security-track brief asks for allow/warn/block, a wrapper that refuses to sign, a function-call key, a shared blocklist and an attack demo → W13.
3. The screeners run the README without paid keys → `scripted` family and `./bin/audit demo` (W03, W14, OD-10).
4. Baseline marking (Q-003): first two commits are 2026-10-17 → tags + README diff section (W00, W14).
5. A video, an X post and a hosted demo kept up until 2026-11-25 → W12, W14.

## 4. Strengths to keep (and show judges)

- The boundary is enforced in code, not prompts: fixed MCP methods, frozen test ids, rejected `--rpc`, offline sandbox verified before handoff.
- Hash-committed submissions and INCOMPLETE reports instead of silent gaps.
- "Instructions in the target are data" is already the house rule — it is the prompt-injection story track 06 asks for.
- Dogfooding: W14 runs OmniSwarm on its own `review-registry` contract and publishes the report and its attestation.
