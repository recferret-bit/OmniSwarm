# Debate and orchestrator v2: evidence

> **Status:** 2026-11-11. Input to [`DEBATE_V2.md`](./DEBATE_V2.md) and waves W20–W30. Nothing here is a requirement; the plan cites it by id (`M1`, `E6`).
> **What this file is:** (1) what two live runs measured, (2) what the literature says, with how well each source was checked, (3) what is contested. Numbers are copied as found. Where a source was not read in full, the tag says so.
> **What this file is not:** a basis for pass/fail thresholds. Two runs on one fixture cannot set a threshold. W21 measures the baseline and fixes the thresholds before any wave is judged against them ([`DEBATE_V2.md`](./DEBATE_V2.md) §6).

## 1. Source tags

| Tag | Meaning |
|---|---|
| **V** | The lead read the primary page (abstract or blog text) in this session. Numbers on that page are quoted. |
| **R** | A research sub-agent reported reading the paper's text. Its numbers were not re-checked. Spot-check before quoting outside this repo. |
| **A** | Abstract only. |
| **S** | Search summary or secondary coverage only. |
| **U** | Unverified vendor claim. Never used for a design decision or a threshold. |

## 2. Measured: two live runs (`M1`–`M19`)

Both runs: `fullstack-dapp` fixture (78 seeded bugs, 16 decoys), surface S3 only, three CLI reviewers (Claude Opus, Codex gpt-6.1-sol, Grok 4.7), two passes, 40-call budget, debate rounds 2, cap 25, turn 180 s, phase 15 min.
Run 1: `engine/eval/runs/live/20261110-124221`, Claude orchestrator, **old clustering** (157 clusters). Run 2: `20261110-192244`, Codex orchestrator with Grok as alternate judge, **new same-site clustering** (63 clusters).

| ID | Measure | Run 1 | Run 2 |
|---|---|---|---|
| **M1** | Cross-check verdicts, `refuted` of total | 0 of 206 (Claude's cross-check failed) | 0 of 292 |
| **M1b** | Cross-check `partial` | 23 of 206 | 29 of 292 |
| **M2** | Challenge turns reused from cross-check: `upheld` / `partial` / `refuted` | 8 / 0 / 0 | 11 / 2 / 0 |
| **M3** | Devil's-advocate turns kept: `insufficient_evidence` / `partial` / `refuted` | 5 / 0 / 0 | 10 / 2 / 0 |
| **M4** | Judge sessions and verdicts accepted | 8 Codex sessions, 6 verdicts (2 refused at submit) | 3 sessions, 0 verdicts (2 Codex refused, 1 Grok timed out) |
| **M4b** | General review | failed (`provider_error`) | refused at submit (`executive_summary` for `executiveSummary`) |
| **M5** | Clusters debated of queued | 8 of 25 | 13 of 24 |
| **M6** | Final statuses | 147 LIKELY (130 `debate_cap`, 17 `debate_time`), 10 CONFIRMED (2 AGREED, 6 judged, 2 by rules after the judge failed) | 39 AGREED→CONFIRMED, 13 CONFIRMED by rules, 11 LIKELY. No REFUTED or DISPUTED in either run |
| **M7** | Wall time by phase (s): review / cross-check / debate / adjudicate / general review | n/a | 1817 / 773 / 927 / 313 / 153 (67 min total) |
| **M8** | Review time per reviewer (s), summed over passes from the usage rows: Claude / Codex / Grok | 347 / 960 / 6022 | 316 / 676 / 1817 |
| **M9** | Provider capacity used in review + cross-check (busy / available provider-seconds) | n/a | about 4,100 of 7,770 (about 53%) |
| **M10** | Tokens by stage, cumulative incl. cached reads, from the host session logs: review / cross-check / debate / judge + general review | n/a | 2.26 M / 2.14 M / 0.96 M / 0.74 M. **The review figure is a lower bound:** a review log is opened without append, so it holds only the last process's result frame and pass-1 tokens are missing. The 63% post-review share is therefore an upper estimate; the 54% share of wall time is not affected. Vendors also count tokens differently (Claude adds cache writes, Codex adds cached reads, Grok's `_meta.totalTokens` is the last call and `_meta.usage` the cumulative), so stage totals are not comparable across vendors |
| **M11** | Per session, average tokens: Claude devil / Grok devil / Codex judge / Codex general review | n/a | 27.5k / 102k / 153k / 341k |
| **M12** | Decoys reported / still open at the end | 8 of 16 / 8 | 7 of 16 / 7. Reported by two or more vendors: 4 in each run (any-location matching) |
| **M13** | Pure-decoy clusters (first-location matching) and their triage | n/a | 2, both AGREED, both carrying a `partial` cross-check verdict. Sample too small to generalise |
| **M14** | Seeded bugs (any-location matching): best single reviewer / union of three / union of pass 1 only | 51 / 57 / 52 | 47 / 53 / 50. A pair reaches 49–55. The self-verify pass added 0 to 7 seeded bugs per reviewer (run 1: +7, +3, +2; run 2: +3, +1, +0), 3 to 5 to the union, and removed none; decoys reported rose from 6 to 8 and from 6 to 7 |
| **M15** | Reviewer self-reported confidence `confirmed` | 81–98% of findings | 81–98% |
| **M16** | Submit refusals by Codex in orchestrator roles, both runs | 5 of 11 sessions (judge ×4, general review ×1): wrong field name (`verdict`, `executive_summary`) or a missing `rationale`. In run 1 Codex resubmitted by itself in 7 of 8 judge sessions and 6 committed on the second call. **The submit-now nudge never fired for the refused sessions:** `onSessionUpdate` sets `turn.submitted` on the in-progress tool call, and the failed update frame carries only a `toolCallId` (no title or input), so the failure is not matched to the submit and `turn.submitted` stays true (`state.json` shows `stop: submitted`, no `submit_now` event). The "call once" wording of the brief is real but is not the whole cause | |
| **M17** | Engine unit-test coverage at `3d21789`, 580 tests, measured with `--test-coverage-include='engine/scripts/*.mjs' --test-coverage-exclude='engine/scripts/*.test.mjs'`: lines / branches / functions | 92.82% / 84.37% / 91.07% overall (a raw run without include and exclude gives 90.18 / 84.35 / 90.44). The figures are for the **full suite**: a `debate-*` test subset alone gives lower numbers (for example `debate-plan` 87.0 / 57.9 against 90.1 / 71.0) | |
| **M18** | Run 2 clusters by number of author vendors (1 / 2 / 3 of 3) | n/a | 24 / 11 / 28. A verifier from a vendor that did not author the cluster exists for 35 of 63 (and only 24 can have two) | 
| **M19** | Run 2 clusters debated (13) by whether a counted turn is `refuted` or `partial`, or severities disagree | n/a | 9 had neither and 4 had a `partial` turn (clusters 47, 51, 53, 57). The judge answered 3 of them; 10 were closed by `judge_threshold` | 

M17 per module (lines / branches), modules the plan touches: `debate-plan` 90.1 / 71.0, `debate-scripted` 98.4 / 65.1, `debate-fixtures` 100 / 66.7, `debate-anonymize` 100 / 69.2, `debate-clock` 100 / 73.3, `debate-claims` 100 / 71.4, `debate-bridge` 100 / 78.8, `debate-run` 98.8 / 85.2, `debate-judge` 95.7 / 94.6, `debate-rounds` 100 / 94.6, `debate-rules` 100 / 95.2, `debate-cluster` 100 / 88.9, `orchestrator-session` 100 / 84.4, `orchestrator-review` 98.3 / 92.9, `docker-agent-orchestrator` 92.1 / 82.9, `agent-session` 100 / 80.2, `orchestrator-resume` 96.3 / 84.0, `orchestrator-progress` 100 / 93.4, `audit-process` 100 / 100, `provider-cli` 93.4 / 80.0, `reviewer-pass-loop` 99.1 / 83.3, `run-config` 98.5 / 91.9. The machine-readable snapshot is a W20-07 output.

### 2.1 What these numbers do and do not show

- **They show** that the stages after the review never lowered a finding's status in either run (they raised some: 13 CONFIRMED by rules and 39 AGREED in run 2), and that the judge produced a verdict in 6 of 11 attempts. In no run did a status change to REFUTED or DISPUTED.
- **They do not show** that those stages cannot work. Cross-check and challenge were rubber stamps, and a rubber stamp is what the current design (one session over about 100 claims, `partial` counted as support) predicts.
- **Run 1 and run 2 are not a before and after.** They differ in code (clustering), orchestrator and alternate judge, and in run 1 Claude's usage limit took out its cross-check, its devil turns and the general review (every phase still ran). Treat each as one observation.
- **n is small.** Two runs, one fixture, one surface. The decoy sample is 16 per run and 2 pure-decoy clusters.
- **The fixture cannot reward filtering.** Precision against the key was 94–97% with no filtering at all, so a stage that removes nothing scores almost the same as one that removes decoys. W21 adds a fixed twin to fix that.
- **Matching rules differ.** `M12` and `M14` use any cited location; `M13` uses the first. Scorer output (`live-score.md`) uses any location.

## 3. Literature (`E1`–`E38`)

"Used by" names the wave or issue whose design rests on the row.

| ID | Source | What it found | Tag | Used by |
|---|---|---|---|---|
| E1 | Choi, Zhu, Li, *Debate or Vote*, arXiv 2508.17536 (NeurIPS 2025) | Majority voting alone accounts for most of the gains credited to debate across 7 benchmarks. Debate is a martingale over beliefs: no expected accuracy gain unless updates are biased toward correction. 5-agent numbers: Qwen2.5-7B 0.7205 single, 0.7377 debate at 2 rounds, 0.7050 at 5, 0.7691 vote | V (claim); R (numbers) | W25, W26 |
| E2 | Zhang et al., *Stop Overvaluing Multi-Agent Debate*, arXiv 2502.08788 | 5 MAD methods, 9 benchmarks, 4 models: MAD often fails to beat chain-of-thought or self-consistency despite more compute. Model heterogeneity is the lever that helps | V (claim); S (per-benchmark numbers) | W25, W27 |
| E3 | Smit et al., *Should we be going MAD?*, arXiv 2311.17371 | Debate does not reliably beat self-consistency or ensembling and is sensitive to hyperparameters. How hard agents are pushed to agree moved one protocol by about 15% | V (claim); R (numbers) | W25 |
| E4 | Huang et al., *LLMs cannot self-correct reasoning yet*, arXiv 2310.01798 | A "reconsider" pass without external feedback lowers accuracy (GPT-4 GSM8K 95.5 → 89.0). At equal response count self-consistency beats debate | R | W26, W28 |
| E5 | Wynn, Satija, Hadfield, *Talk isn't always cheap*, arXiv 2509.05396 | Agents move from correct to incorrect answers under peer reasoning. A weak member lowers a group's vote (MMLU 65.8 → 58.8 with two weak models) | R | W26, W27 |
| E6 | Khan et al., *Debating with more persuasive LLMs*, arXiv 2402.06782 | Two-sided debate lifts a non-expert judge to 76% (naive 48%); humans 88% (60%). The judge could not see the source text. Verified quotes helped the correct side | V | W25, W26 |
| E7 | Kenton et al., *Scalable oversight with weak LLMs judging strong LLMs*, arXiv 2407.04622 | Debate beats consultancy on every task. Against direct answering it helps only with information asymmetry. Cutting 3 rounds to 1 made no significant difference | V | W26 |
| E8 | Verga et al., *Replacing Judges with Juries* (PoLL), arXiv 2404.18796 | A panel of smaller judges from disjoint families beats one large judge, with less intra-model bias, at over 7 times lower cost. GPT-4 judge kappa swung 0.518 to 0.725 with prompt wording | V (claim); R (kappa) | W26, W27 |
| E9 | Chen, Saha, Bansal, *ReConcile*, arXiv 2309.13007 (ACL 2024) | Mixing model families with confidence-weighted voting beat same-model debate by up to 11.4%; diversity was critical. Team accuracy by round 74.3, 77.0, 79.0, 78.7: two rounds were enough | V (claim); R (rounds) | W26, W27 |
| E10 | Li et al., *Rethinking Mixture-of-Agents* (Self-MoA), arXiv 2502.00674; XBOW *Alloy agents* | Self-MoA: resampling the best single model beat mixed-model aggregation by 6.6% on AlpacaEval 2.0, because mixing lowers average quality. XBOW: alternating two least-correlated models reached 68.8% against 46.4% and 57.5% for same-model pairs; same-provider pairs gave no gain; a much weaker model drags an alloy down | V | W27, W28 |
| E11 | Kim et al., *Correlated errors in LLMs*, arXiv 2506.07962 (ICML 2025) | When two models are both wrong they choose the same wrong answer about 60% of the time on HELM (chance about 33%). Judges favour their own provider | R | W25 |
| E12 | Weng et al., *BenchForm*, arXiv 2501.13381; Choi et al., *When identity skews debate*, arXiv 2510.07517 | Conformity depends more on majority size than on rounds. Removing source labels cut the conformity-obstinacy gap (Qwen-32B MMLU 0.608 → 0.024) | R | W25 |
| E13 | Yao et al., *Peacemaker or Troublemaker*, arXiv 2509.23055; Smit et al. | Agreeable debaters collapse. The angel/devil protocol was the only one in which debate lowered accuracy below the first answer. No paper isolates a devil's-advocate turn inside a verification pipeline | R | W26 |
| E14 | Dhuliawala et al., *Chain-of-Verification*, arXiv 2309.11495 | Verification questions answered independently of the draft: factored 63.7 vs joint 60.8 FactScore | V (claim); R (numbers) | W25 |
| E15 | Lifshitz, McIlraith, Du, *Multi-Agent Verification*, arXiv 2502.20379 | Several independent verifiers with binary votes scale better than self-consistency; diverse verifiers beat one repeated verifier. No debate baseline | R | W25 |
| E16 | Eo et al., *Debate Only When Necessary*, arXiv 2504.05047; iMAD, arXiv 2511.11306 | Gating debate on confidence gave up to 6 times the efficiency. iMAD: a learned trigger matched full debate at about a third of the tokens. Self-reported confidence is weak, so the gate should use mechanical features | V (DOWN claim); A/S (iMAD) | W25 |
| E17 | Hu et al., *GPTLens*, arXiv 2310.01152; Widyasari et al., *VulTrial*, arXiv 2505.10961 | Generate broadly, then a critic filters (GPTLens, 13 CVE contracts). VulTrial (prosecutor, defence, judge, jury) almost doubled baselines with GPT-4o; one round was best (pair-correct 96, 87, 81 for rounds 1–3); removing the defence role hurt | V (claims); R (numbers) | W25, W26 |
| E18 | Xiong, Zhang, *Sifting the Noise*, arXiv 2601.22952 (ISSTA 2026) | Agent frameworks identified 95.5% of false positives at 95.5% precision on post-cutoff C/C++ with a strong backbone, against 36.4% for vanilla prompting. Gains are small on weak backbones. Aggressive filtering suppresses true vulnerabilities (another config dismissed 22.25% of true ones) | V | W25, W26 |
| E19 | Semgrep, *Building an AppSec AI that security researchers agree with 96% of the time* | Triage agrees with researchers on 96% of true positives and 41% of false positives, by design: it prefers keeping a finding. Tuned on over 2,000 labelled findings | V | W25, W26 |
| E20 | Theori, *AIxCC and RoboDuck* | Every LLM bug report gets a likely/unlikely score from token logprobs over several samples (about $0.001); the top 20% go to an agent (about $0.50 each). LLM static analysis "still has a high false positive rate" | V | W27 |
| E21 | Team Atlanta, *Ensemble of coding agents for patching* (2026); AIxCC CRS write-up | N=3 was the practical sweet spot; model choice outweighed framework; each agent had up to three attempts with validation errors fed back. Conservative independent re-validation was judged more reliable than prompt guardrails; majority voting unsuitable for patches | V (ensemble post); R (CRS) | W23, W25, W27 |
| E22 | Zhang et al., *SoK: DARPA AIxCC*, arXiv 2602.07666 | Executable-evidence gating separated accurate teams from penalised ones. LLM-judge triage teams scored 10 of 13 and 9 of 13. Signature-based dedup merged distinct bugs. Our tool is audit-only: this evidence motivates mechanical, not executable, gates | R | W25 |
| E23 | Anthropic, *How we built our multi-agent research system* | Agents use about 4 times chat tokens, multi-agent about 15 times. Token usage explains 80% of BrowseComp variance. Parallel calls cut time by up to 90%. Effort rules: 1 agent with 3–10 calls for simple tasks, 2–4 subagents for comparisons. Coding has fewer parallelisable tasks than research | V | W23, W24, W27 |
| E24 | Liu et al., *Budget-Aware Tool Use Enables Effective Agent Scaling*, arXiv 2511.17006 | Raising the tool budget alone does not help; agents that see their remaining budget scale better. Budget tracker at budget 10 matched ReAct at 100 (12.8% vs 12.6%) at 31.3% lower cost | V (claim); R (numbers) | W24 |
| E25 | Google SRE book, *Handling overload*, *Addressing cascading failures*; AWS Builders' Library | At most 3 attempts per request, retries only while under 10% of requests, an explicit "overloaded; don't retry" answer, retry at one layer, one absolute deadline passed down, jittered backoff | V (overload); R (rest) | W23, W24 |
| E26 | Dean, Barroso, *The Tail at Scale*, CACM 2013 | Send the backup request after the first has been outstanding past the 95th-percentile latency; about 5% extra load. BigTable benchmark: 1,800 ms → 74 ms for 2% more requests | S (primary returned 403) | W23 |
| E27 | LiteLLM, Portkey, OpenRouter, Vercel AI Gateway docs | Per-provider cooldown (LiteLLM default 5 s; Portkey minimum 30 s), fallback chains across models, retry on 429 and 5xx, "decision fallback" to a stronger model on low confidence. Defaults disagree and are not documented for multi-minute agent sessions | R | W23, W27 |
| E28 | Anthropic API errors and rate limits; Claude plan help pages | A 429 with `retry-after` means wait; a spend-cap 429 has none and keeps failing until access resumes; 529 is overload. Subscriptions have a rolling five-hour window and a weekly limit shared with chat | R | W23, W24 |
| E29 | Netflix concurrency-limits | Treat a concurrency limit like a congestion window (Vegas, Gradient2, AIMD); partitions reserve a share for critical traffic. No source applies this to LLM agent sessions | R | W23 |
| E30 | Dean, Ghemawat (MapReduce); Spark speculation; Zaharia et al. (LATE) | Backup tasks cost a few percent and avoided a 44% longer sort; LATE caps speculation near 10% and speculates the slowest-to-finish task on fast nodes | R | W23 |
| E31 | Temporal, LangGraph, Anthropic *Effective harnesses for long-running agents* | Persist each completed step and read it back on resume; a status list plus append-only log bridges sessions with no memory. Persist synchronously when a step costs minutes | R | W24 |
| E32 | FrugalGPT, AutoMix, RouteLLM | Cascades cut cost on question answering with 2023–24 models. No evidence for security review; agent CLIs' own confidence is uncalibrated | R | W27 |
| E33 | Tan et al., *JudgeBench*, arXiv 2410.12784 (ICLR 2025) | Strong judges score only a little better than chance on hard, objectively labelled pairs | V | W26 |
| E34 | Panickssery et al., arXiv 2404.13076; Zhao et al., *Language Model Council*, arXiv 2406.08598 | Self-preference grows with self-recognition. In a 20-model council first-position bias averaged 30% and fell to 0 when only order-consistent votes were kept; gains flattened at about 9 judges | R | W26 |
| E35 | Brown et al., *Large Language Monkeys*, arXiv 2407.21787; Project Zero Naptime; Heelan (2025); Semgrep (2025) | Resampling raises recall, but without an automatic verifier selection plateaus. Run-to-run variance in security review is large (same prompt gave 3, 6, 11 findings; a known bug found in 8 of 100 runs) | R/S | W21, W28 |
| E36 | Sun et al., *GPTScan*, arXiv 2308.03314 (ICSE 2024) | The model names the key variables and statements and static analysis confirms them, removing about two thirds of false positives | R | W25 |
| E37 | He et al., *Minority Sentinel* (2026, workshop) | In three-model debates the lone dissenter is right in about one of four divergent cases; a feature classifier over debate logs overturned the majority more safely than an LLM judge | A | W26 |
| E38 | Vendor reports: Aardvark, Codex Security, Anthropic Code Review, Harness LLMScanBench | False-positive and recall figures with different denominators, mostly self-reported | U | none |

## 4. Contested or weak

- **Does debate beat voting?** Positive: Du et al. 2023 (arXiv 2305.14325), Liang et al. 2023, ReConcile, Hu et al. 2025. Negative: E1–E5. The split follows budget matching, model strength, heterogeneity and whether claims are checkable. Most negative results use 7–8B or GPT-3.5-class models on multiple-choice or maths. **None tests frontier cross-vendor panels on code.** A debate where all parties can read the same code is the weak case for debate (E6, E7).
- **Mix vendors or resample one?** E10 contradicts itself across tasks. XBOW and Team Atlanta (finding and patching) favour mixing; Self-MoA (aggregation quality) does not. No study covers audit findings. W27 and W28 each carry a spike for this.
- **Rounds.** Du saw gains to four rounds; six other sources find one or two best (E7, E9, E17, E1).
- **Devil's advocate.** No clean isolation (E13). Our own runs show the turn changed nothing (M3), which is not evidence it cannot.
- **Confidence.** Helps in ReConcile and DOWN, null or misleading elsewhere. The plan gates on mechanical features, not on stated confidence.
- **Hedging LLM calls.** The evidence is millisecond RPCs (E26). A hedge on a multi-minute agent turn roughly doubles that turn's cost. W23-09 is a bet with a cost cap.
- **Vendor false-positive numbers (E38)** are not used.
- **No primary source found for:** a head-to-head of a blind independent verifier against debate; shared false-positive rates across vendors in vulnerability detection; handling of a judge that returns nothing; adaptive concurrency applied to LLM agents.
- **Not verified in this session:** E26's exact numbers, iMAD's numbers, E37, and every figure tagged R that this plan quotes outside this file.
