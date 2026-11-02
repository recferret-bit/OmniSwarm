# NEAR Hackathon — track fit for OmniSwarm

> **Sources (fetched 2026-11-02):** [nearhackathon.com](https://nearhackathon.com/), [HACKATHON.md](https://nearhackathon.com/HACKATHON.md), the organisers' prompt repo [nearai/near-hackathon-prompt-examples](https://github.com/nearai/near-hackathon-prompt-examples) (`tracks/01..13`, `SUBMITTING.md`, `README.md`). Quotes are verbatim from those files.

## 1. Facts that shape the plan

| Item | Value |
|---|---|
| Window | 2026-11-01T00:00Z → **2026-11-14T23:59Z** (dev end = submission deadline = repo public) |
| Judging | 2026-11-16 → 11-18; keep any hosted demo up until 11-18, "ideally 2026-11-25" (Q-012) |
| Prizes | $250K in NEAR: one $55K grand prize; per track $10K / $3K / $2K; 13 tracks |
| Judges | Illia Polosukhin, Eddy Lazzarin (a16z crypto), Mert Mumtaz (Helius), Avichal Garg (Electric Capital), Kain Warwick (Synthetix & Infinex), Haseeb Qureshi (Dragonfly), Stepan Gershuni (cyber•Fund), plus Claude Code and Codex as screeners |
| AI screening | "Claude Code & Codex screen every project first: they check that it runs and does what the README says" — "reproducibility check, feature verification, structured report, preliminary score. Humans decide; low AI score alone cannot reject" (Q-017). README must be "do X → see Y" steps, "No marketing" |
| Past criteria | technical implementation, design, impact, originality, sustainability |
| Baseline | Code from 2026-10-19 counts; earlier commits are baseline (Q-001). Reused repo: tags `pre-hackathon` / `hackathon-submission` + README section linking the diff (Q-003). Only the NEAR integration built in the window is judged for a product that exists elsewhere (Q-002) |
| OmniSwarm baseline | `293208a`, `94551b9` dated 2026-10-17 → baseline. Everything from `d6c514e` (2026-10-27) is in the window. Tag `pre-hackathon` = `94551b9` (OD-11) |
| Submission | one per repo, not editable; `tracks[]` = ids; `nearAddress` = mainnet payout account the team creates; `demoUrl` = the X post (built at NEAR HACKATHON, @NEARProtocol, #NEARHackathon, video); `idea` 20–2000 chars; never fill the `website` spam-trap field |
| Owner-only | make the repo public, post on X, submit the form, sign anything on mainnet, create the payout account |

## 2. All tracks

| # | id | Title | Fit |
|---|---|---|---|
| 01 | defi | Unstoppable DeFi | no |
| 02 | thesis | Investment Thesis | no |
| 03 | privacy | Privacy & Private AI | **stretch (`H+`, OD-15 owner-confirmed):** one `nearai:` TEE reviewer with an attestation "Verified" panel (W03-22, W07-22, W14-25); enter only if the checks are green by D12 |
| 04 | business | Autonomous Business | optional add-on (paid service: caps, ledger, kill switch) |
| 05 | swarms | AI Swarms | partial (OD-02) |
| **06** | **security** | **AI Security & Defense** | **primary** |
| **07** | **agents** | **Agent Economy** | **secondary** |
| 08 | realworld | Real-World Money | no |
| 09–12 | games, nfts, memecoins, social | — | no |
| **13** | **open** | **Open Innovation** | **companion** ("You can enter this track alongside any other") |

## 3. Primary: 06 `security` — what the brief asks and where we answer it

Brief: spending limits, policy engines, sandboxed wallets, reputation, scam detection; hints AGENT SECURITY, FUNCTION CALL KEYS, TEE ATTESTATION. Starter: a counterparty check that "returns allow, warn or block, plus the reasons".

| The brief says (verbatim) | OmniSwarm answer | Wave |
|---|---|---|
| Signals: "account age and activity history"; "whether the receiver is a contract, and whether its code changed recently"; "prior interactions"; "a shared blocklist that other agents can report to, with evidence attached" | Guard verdict from account age, `code_hash` drift vs the **attested reviewed code**, attestation severity, and a registry blocklist with evidence hashes | W13, W10 |
| "An agent-side wrapper that refuses to sign when the answer is block and asks a human when it's warn." | `@omniswarm/guard` | W13 |
| "The agent signs with a function-call access key scoped to one contract, never a full-access key. Explain the limits of that key in the README." | Backend operator key and demo agent key are FC keys on `review-registry`; README section on limits (no transfer, no add-key, gas allowance lock-out) | W10, W13, W14 |
| "An attack demo: a script where a prompt-injected agent tries to pay a known-bad address and gets stopped. Show the log." | `demos/attack/` with committed log | W13 |
| Checkpoint: list data sources per signal, wait for OK | `docs/hackathon/GUARD_SIGNALS.md` written first in W13-01 | W13 |

**Our distinct angle (the pitch):** the counterparty check is backed by an actual multi-model source review of the code the counterparty runs, attested on NEAR; when the deployed code changes, the verdict drops to warn. And the reviewer itself is a sandboxed, prompt-injection-hardened agent system: target files are data, the bridge has no exec/network, every finding cites code.

## 4. Secondary: 07 `agents`

| The brief says | Answer | Wave |
|---|---|---|
| Agent "breaks the task into parts, decides which parts to do itself and which to buy, hires other agents…, checks the work, and pays out. Everything it spends stays inside my budget." | The orchestrator splits a review into surfaces × reviewers, buys model work across providers, checks it by debate + citation checks, and stays inside `--max-cost-usd` / OD-04 caps | W04, W06, W09 |
| "A receipt for every task: what was bought, from whom, at what price, and whether the work passed the agent's check." | `reviewers/<id>/usage.json` + adjudication status per finding → per-request receipt page and ledger | W05, W09 |
| "Payments in USDC or NEAR, directly or through NEAR Intents." | NEAR via `request_review` | W10 |
| Checkpoint: "how the agent will hold its keys and what it can't do without me" | README key-custody section (FC key, root-only env file, refunds by policy) | W14 |
| Look at market.near.ai | OD-16 (`H+`) | W14 |
| Negotiation "counters once" | Not planned; stated as a gap in the README | — |

## 5. Companion: 13 `open`, optional 04 `business`, partial 05 `swarms`

- **13 open:** enter alongside; README lists failure cases and the testnet demo.
- **04 business** (if `H+` rows land): `config.yaml` caps ("maximum inference spend per day", "minimum price per report", "revenue split", "kill switch"), a public ledger page, "one full loop on testnet, from sale to payout, in under two minutes" (the `scripted` preset makes this possible).
- **05 swarms** (OD-02): sub-account per reviewer, RULES.md before code (W14 writes RULES.md from ORCHESTRATION §4 — the plan already exists before the code), a scripted simulation with no LLM calls (`scripted` family), a live page of rounds (W11 status page shows debate rounds). Missing: settlement through NEAR Intents. Enter only if W10-12 lands; say what is partial.

## 6. What wins the screener and the judges

1. `git clone && ./bin/audit demo` works with no keys and shows per-model reports, the debate and the general review (OD-10).
2. A hosted testnet flow a judge can click: connect wallet → paste repo → sign → pay 1 testnet NEAR → watch reviewers argue → open the report → see the attestation on the explorer.
3. The guard attack log and the FC-key explanation (track 06's explicit asks).
4. The golden-eval table: precision/recall of debate vs union vs majority vote — evidence instead of claims (fits "Judged on the evidence" spirit).
5. Honesty: mock/real table, baseline diff link, "agreement is not a certificate".
