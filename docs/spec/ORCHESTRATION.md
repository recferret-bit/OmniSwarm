# ORCHESTRATION — reviewer families, iteration budget, debate, report v2

> **Status:** v1, 2026-11-02. Source of truth for waves W01, W03–W07. Decisions it depends on are in [`DECISIONS.md`](./DECISIONS.md).
> **Primary sources** (fetched 2026-11-02): Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (BEA); [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (MARS); [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (CTX); [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (TOOLS); [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations) (HALL). Debate literature: Du et al. arXiv:2305.14325; Liang et al. arXiv:2305.19118; Smit et al. arXiv:2311.17371; Khan et al. arXiv:2402.06782; Wynn et al. arXiv:2509.05396; Panickssery et al. arXiv:2404.13076; Zheng et al. arXiv:2306.05685.

## 0. Principles (what we take from the guides)

| # | Principle | Source | What it means here |
|---|---|---|---|
| P1 | "finding the simplest solution possible, and only increasing complexity when needed" | BEA | The pipeline is a **workflow in code** (fixed phases). Model freedom exists only inside one reviewer's bounded loop |
| P2 | "include stopping conditions (such as a maximum number of iterations)" | BEA | Every loop has a hard cap: tool calls per pass, passes per reviewer, debate rounds, judge calls |
| P3 | "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries" | MARS | Every brief (review, challenge, defend, judge, general review) is a template with those four parts (§5) |
| P4 | Subagents "store their work in external systems, then pass lightweight references back" | MARS, CTX | Phases exchange **files** (`reviewers/*/report.json`, `debate/round-*`), never transcripts |
| P5 | "verify each claim by finding a supporting quote… If it can't find a quote, it must retract the claim" | HALL | Every finding and every debate argument cites `file:line` + quoted code, checked **mechanically**; "insufficient evidence" is a legal verdict |
| P6 | Evaluator-optimizer only "when we have clear evaluation criteria" | BEA | Our criterion is mechanical: does the cited code exist and support the claim |
| P7 | Debate helps the **judge**, not the vote (76–88 % vs 48–60 % judge accuracy) | Khan et al. | Agreement counts are metadata; a judge reads evidence and arguments |
| P8 | Peers switch correct answers to agree; models favour their own outputs | Wynn et al., Panickssery et al. | Anonymize and shuffle peers, hide vote tallies and model names from judges, never let an author judge its own finding |
| P9 | MAD does "not reliably outperform" ensembling | Smit et al. | The golden eval (W06) must show debate beats **union** and **majority vote**; otherwise ship majority vote + citations |
| P10 | "Adding full production tracing let us diagnose why agents failed"; resume from checkpoints | MARS | Every call, citation check, verdict change and stop reason is a file; a failed provider degrades the run to INCOMPLETE, it does not restart it |
| P11 | "Poka-yoke your tools"; actionable errors | BEA, TOOLS | Bridge tools take repo-relative paths validated server-side; budget exhaustion returns "budget exhausted: call submit_audit_report now" instead of an opaque error |

## 1. Reviewer specs and families

A **reviewer** is one model in one family. Its spec string:

```
<family>:<provider>:<model>[#<label>]
```

| Family | Approach (owner's words) | Providers | Transport | Auth | Example |
|---|---|---|---|---|---|
| `cli` | 1 — local vendor subscriptions | `claude`, `codex`, `grok`, `agy`, `claude-zai` | existing ACP / native sessions (`agent-session.mjs`) | the CLI's own login; `claude-zai` maps `ZAI_API_KEY` (Coding Plan) to `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` | `cli:claude:opus`, `cli:claude-zai:glm-5.3` |
| `key` | 2 — direct API keys | `zai`, `anthropic`, `openai`, `xai`, `google` | OmniSwarm tool loop (`provider-openai-compat.mjs`, `provider-anthropic.mjs`) wrapped as an ACP agent (`api-acp-agent.mjs`) | `ZAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` | `key:zai:glm-5.3` |
| `openrouter` | 3 — OpenRouter | any OpenRouter slug | same tool loop, base `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `openrouter:qwen/qwen3.8-max-0902` |
| `nearai` (`H+`, OD-15) | NEAR AI Cloud TEE models | `nearai` | same tool loop, base `https://cloud-api.near.ai/v1`, plus attestation check with a fresh nonce | `NEARAI_API_KEY` | `nearai:<tee-model>` |
| `scripted` | demo / simulation, no LLM | `baseline`, `paranoid`, `lazy`, `wrong` (fixture strategies) | in-process scripted agent | none | `scripted:baseline` |

- **Reviewer id** = slug of the spec (`key-zai-glm-5-3`, `openrouter-qwen-qwen3-8-max`), unique per run; `#label` overrides it. Slashes are allowed in the model part and never reach a path (fixes R-17a).
- **Vendor** is derived (`anthropic`, `openai`, `xai`, `google`, `zai`, `alibaba`, `scripted`). Peer filtering and judge-conflict rules use the **vendor**, so `cli:claude:opus` and `openrouter:anthropic/claude-opus-5.5` count as the same vendor (fixes R-17c).
- **Combining approaches:** any mix in one run, e.g. the owner's default local preset:
  `--reviewers cli:claude:opus,cli:codex:gpt-6.1-sol,cli:grok:grok-4.7,cli:agy:gemini-4-argon-high,openrouter:qwen/qwen3.8-max-0902,key:zai:glm-5.3`
- **Hosted preset (OD-04, owner-confirmed):** `key:zai:glm-5.3`, `openrouter:qwen/qwen3.8-max-0902`, `openrouter:anthropic/claude-opus-5.5`, `openrouter:openai/gpt-6.1-sol`, `openrouter:x-ai/grok-4.7`, `openrouter:google/gemini-4-argon`; orchestrator `openrouter:anthropic/claude-opus-5.5`, alternate judge `openrouter:openai/gpt-6.1-sol`; `--assign round-robin --passes 2 --tool-budget 30 --max-cost-usd 25`.
- **Config file:** `omniswarm.config.json` (or `--config path`) holds `reviewers`, `orchestrator`, `passes`, `toolBudget`, `debate`, `presets`; flags override it. Schema: `shared/schemas/run-config.schema.json`. Presets: `local-subscriptions`, `api-only`, `mixed`, `hosted` (OD-04), `demo` (all `scripted`).
- **Defaults** (verified 2026-11-02, keep in config, not code): Claude `opus`, Codex `gpt-6.1-sol`, Grok `grok-4.7`, AGY `gemini-4-argon-high`, Z.ai `glm-5.3` (thinking always on; `reasoning_effort: high`), OpenRouter Qwen `qwen/qwen3.8-max-0902` (alt `qwen/qwen3-coder-next`).
- **Assignment:** `--assign matrix` (default when reviewers ≤ 8): every reviewer reviews every selected surface, so each per-model report covers the whole repo. `--assign round-robin` keeps today's behaviour for cost control (fixes R-17d).

### 1.1 Key policy (changes a documented rule)

Today no key or endpoint enters any reviewer runtime (`agent-session-launch.mjs:12-20`, test `agent-session.test.mjs:190`). New rule, written into AGENTS.md in W00:
- Keys are read from the operator's environment only, never from the target, a config file in the repo, or a report.
- Each reviewer process gets **exactly one** allow-listed variable for its own provider (`zai` → `ZAI_API_KEY` [+ `ZAI_BASE_URL`]); `cli` reviewers still get none (except `claude-zai`, which gets its two mapped vars).
- The MCP bridge and the Docker sandbox **never** receive a key. A unit test greps every spawned env.
- Reports record `keyFingerprint` (first 4 + last 4 chars of sha256 of the key), never the key.
- OpenRouter requests send `provider: {require_parameters: true, data_collection: "deny"}` because target source code leaves the machine; Z.ai and other key providers carry a README warning to the same effect.

## 2. Phases (workflow in code)

```
prepare → tests → review(pass 1..P) → crosscheck(= debate round 1) → debate(rounds 2..R) → adjudicate → general-review → report
```

| Phase | Pattern (BEA) | Input → Output | Who |
|---|---|---|---|
| prepare, tests | — (unchanged) | snapshot, sandbox, existing-test catalog | engine |
| **review** | parallelization (voting) + bounded agent loop | surface assignment → `submissions/<reviewer>-<surface>.json` per pass | every reviewer, isolated, no peer output |
| **cluster** | deterministic code first, LLM only for merge suggestions | all submissions → `debate/clusters.json` | engine (`cluster-findings.mjs`) + orchestrator merge suggestions |
| **crosscheck** (round 1: challenge) | evaluator | clusters → `debate/round-1/<anon>.json` | every reviewer except each cluster's authors; existing `submit_crosscheck_report` reused |
| **debate** (rounds 2..R: defend, rebut) | evaluator-optimizer, bounded | disputed clusters → `debate/round-N/<anon>.json` | authors defend, challengers rebut |
| **adjudicate** | LLM-as-judge on evidence | clusters + valid arguments → `debate/adjudication.json` | orchestrator, or the alternate judge on vendor conflict |
| **general-review** | orchestrator synthesis | adjudication + coverage + health → `general-review.{json,md}` | orchestrator |
| report | — | all of the above → JSON/MD/HTML/PDF | engine |

## 3. Iteration budget (owner: "each agent iterates a fixed amount of times")

Two fixed numbers, the same for every family:

| Knob | Flag | Default | Meaning |
|---|---|---|---|
| Passes | `--passes P` | **2** (OD-03) | Each reviewer runs **exactly P passes** per assignment. Pass 1 = discovery. Pass 2 = self-verification: re-read every own citation, drop or fix what does not hold, then spend the rest of the pass on files the coverage map shows unread. Pass 3+ = deepening on the reviewer's own highest-severity leads. A pass that submits early still counts; the next pass always runs |
| Tool budget | `--tool-budget N` | **40** per pass | Max bridge `tools/call` per pass (submit calls excluded) |
| Grace | — | 3 | After N calls the bridge flips that identity to **finalize-only** (`ctx.finalizeOnly`, today never set, R-15): inspection tools answer "budget exhausted: call submit_audit_report now"; 3 more calls are allowed, then the session is cancelled and the pass is recorded `stop: budget` |
| Debate turn budget | `--debate-tool-budget` | 12 | Tool calls per debate turn (for citation lookups) |
| Debate rounds | `--debate-rounds R` | **2**, max 3 | Round 1 challenge (+ devil's advocate), round 2 defend; round 3 rebut only if any verdict changed in round 2 |
| Judge calls | — | 1 per disputed cluster + 1 general review | No retries except one on transport failure |
| Cost ceiling | `--max-cost-usd` | unset | Sum of reported `usage.cost` (OpenRouter) or estimated cost; crossing it ends the current pass with `stop: cost` |

**Where the cap is enforced** (one gate per family, all three tested):
1. **Bridge counter** (plugged into W02's `beforeCall(ctx, name)` hook in the `docker-mcp-bridge.mjs` dispatcher, per identity + pass, stored in `harness/budget-<reviewer>.json`, not in the 200-entry log). This is the only gate every family passes through.
2. **ACP session** (`agent-session.mjs`): counts `tool_call` notifications; after `end_turn` without a submit sends one "submit now" correction (reuses the 3-correction loop); past N + grace it sends `session/cancel`. Grok also gets `--max-turns`.
3. **API loop**: the loop bound is N model turns; on the last turn it sends `tool_choice` forcing `submit_audit_report`.

Every pass writes raw usage to `harness/usage/<reviewer>/<surface>-pass-<k>.json` (W04); W05 derives `reviewers/<id>/usage.json` and `reviewers/<id>/passes/pass-<k>.json` from it, with `{calls, tokensIn, tokensOut, cost, stop: submitted|budget|cost|error, startedAt, endedAt}`.

## 4. Debate protocol

### 4.1 Triage
- Clusters from `cluster-findings.mjs` (exact title+citation or ≥ 2 shared files within ±3 lines). The orchestrator may propose extra merges; each proposal needs a one-line reason and is applied only if both members cite the same file.
- **Skip debate** (status `AGREED`) when ≥ 2 vendors reported it **and** every citation passed the checker.
- **Debate queue:** everything else, ordered by `severityWeight × (1 + disagreement)`, capped at `--debate-max-clusters` (default 25; overflow keeps today's peer-review status and is listed as a coverage gap).

### 4.2 Rounds
- **Anonymization:** each cluster's participants are relabelled `Reviewer A/B/C…` per cluster with a fixed seed (recorded), order shuffled, model names and vote counts removed, text normalized to the schema (no prose style leakage).
- **Round 1 — challenge** (extends today's crosscheck): every non-author reviewer returns `upheld | partial | refuted | insufficient_evidence` with citations. One non-author is assigned **devil's advocate** per cluster and must argue the strongest false-positive case.
- **Round 2 — defend:** authors see the challenges (anonymized) and either defend with **new** citations or concede.
- **Round 3 — rebut** (only if a verdict changed in round 2).
- **Early stop:** a round with zero verdict changes ends the debate for that cluster.
- **Citation checker** (code, no LLM): each argument's `{file, startLine, endLine, quote}` is checked against the read-only source (`/src`, W02); whitespace-normalized substring match. Arguments with no valid citation are **discarded** and logged.
- **Conformity flag:** a verdict change without a new valid citation is kept but marked `conformity_suspect: true` and down-weighted to zero for the judge.

### 4.3 Adjudication
- The judge sees per cluster: the claim, the verified quotes, the valid arguments (anonymized), never vendors, model names or vote tallies.
- **Cross-family rule:** the judge's vendor must differ from every author's vendor of that cluster; if the orchestrator conflicts, the cluster goes to `--alternate-judge` (default: the strongest available reviewer of another vendor). Recorded per cluster.
- Final statuses (extend today's `MODEL_ASSERTION | MODEL_AGREEMENT | UPHELD_REVIEW | PARTIAL_REVIEW | REFUTED_REVIEW`, which stay for back-compat):
  `CONFIRMED` (evidence holds, ≥ 1 independent upheld) · `LIKELY` (evidence holds, single source, not refuted) · `DISPUTED` (valid evidence on both sides) · `REFUTED` (valid refutation evidence) · `INSUFFICIENT_EVIDENCE`.
- **No silent drops:** a single-source finding is never removed without a valid refuting citation (BEA pitfall: unique findings are often the valuable ones).
- The judge may re-calibrate severity, with a reason.

### 4.4 General review
`general-review.json` (schema `general-review.schema.json`) and `.md`: executive summary, risk posture (one of `critical-exposure | high-risk | moderate | low-observed` — never "secure"), top findings with statuses, per-surface coverage and gaps, disagreements that stayed open, per-reviewer contribution table (unique confirmed findings, refuted findings, budget used, cost), methodology (models, budgets, rounds, judge assignment), and the fixed sentence "Model agreement and passing checks do not certify security."

### 4.5 Orchestrator model
- `--orchestrator <reviewer-spec>` or `--orchestrator recommended`.
- **Recommended** = first available of: `cli:claude:opus` → `key:anthropic:claude-opus-5-5` → `openrouter:anthropic/claude-opus-5.5` → `key:zai:glm-5.3` → `scripted:judge` (demo only). Printed in `--plan` with the reason.
- The orchestrator runs through the same family registry with bridge role `orchestrator` (read-only tools + `submit_merge_suggestions`, `submit_adjudication`, `submit_general_review`). It never gets `run_existing_tests`.

## 5. Brief templates (P3)

Every brief = **Objective · Output schema · Tools and sources · Boundaries**. Review-pass templates live in `scripts/review-briefs.mjs` (W04); challenge/defend/rebut, judge and general-review templates live in `scripts/orchestrator-briefs.mjs` (W06). Both are snapshot-tested.
- **Review pass k:** objective (surface, pass role), schema `reviewer-report`, tools (bridge read tools, fixed tests), boundaries (no exploits, budget N, "submit no finding if none").
- **Challenge / defend / rebut:** one cluster only, its quoted evidence, schema `debate-round`, budget 12 calls, "cite file:line + quote or your argument is discarded", devil's-advocate variant.
- **Judge:** one cluster, evidence + valid arguments only, schema `adjudication`, "insufficient_evidence is allowed".
- **General review:** paths to adjudication, coverage, health; schema `general-review`; "no new findings in this step".

## 6. Report v2 layout

```
reports/<run>/
  meta.json                 + reviewers[{id,family,provider,vendor,model,keyFingerprint?}], orchestrator, budgets
  submissions/, auditors/   unchanged (canonical, hash-committed)
  reviewers/
    index.json              reviewer list with family/vendor grouping and totals
    <reviewer-id>/
      report.json           findings + verified_safe for this model only (all surfaces, last pass wins per surface)
      report.md, report.html   (W05 writes a minimal page; W07 re-renders it in the shared report shell)
      usage.json            passes, calls, tokens, cost, stop reasons
      passes/pass-<k>.json
  debate/
    clusters.json, anonymization.json (seed + map, hidden from judges)
    round-<n>/<anon-id>.json
    citations.json          every checked citation and its result
    adjudication.json
  general-review.json, general-review.md
  findings-and-scores.json  + finalStatus, judge, debateRounds per cluster
  report.html               existing look; rail adds 05 Cross-check, 06 General review
  findings-by-model.html    per reviewer id with family badge
  reviewers.html            index of per-model reports
```

`report-contract.mjs` must accept `reviewers/`, `debate/` and `general-review.*` (today any unknown `auditors/*.json` makes the run INCOMPLETE, R-18a). A failed debate or general review sets `meta.stageFailures` and shows INCOMPLETE; it never hides per-model findings.

## 7. Evaluation (W06)

- `eval/golden/` — 6–10 small repos (Rust/NEAR, Solana, TS, Python), each with seeded bugs (`expected.json`: file, line range, class) and **decoys** (code that looks vulnerable and is safe).
- `npm run eval:golden -- --reviewers scripted:*` runs offline in CI; with `OMNI_LIVE=1` it runs real models.
- Metrics: recall, precision, decoy false-positive rate, dedup correctness, **true findings lost in debate** (conformity rate), cost per confirmed finding.
- Baselines: union of all findings; majority vote without debate. Debate ships as default only if it beats both on precision without losing recall by more than one seeded bug; otherwise default `--debate-rounds 1` (challenge only) and the README says why (P9).
- One LLM-judge rubric pass (0.0–1.0 + pass/fail) on general reviews: evidence accuracy, severity calibration, remediation quality, coverage honesty.
