# Hackathon Cut — OmniSwarm at the NEAR Hackathon (2026-11-02 → 11-14)

> **Today:** D2 = 2026-11-02. **Code freeze / submit:** D14 = 2026-11-14, internal submit by **20:00 UTC** (hard deadline 23:59 UTC). **Judging:** 11-16 → 11-18; hosted demo stays up until **11-25**.
> **Counts** (from the wave files, 2026-11-02; one **unit** = one `M` issue, `S` = ½):
>
> | Set | Issues | Units |
> |---|---|---|
> | **H** must | 274 | **191.5** |
> | H+ stretch | 29 | 17.0 |
> | Total planned | 303 | 208.5 |
>
> Per wave (H units): W00 11.5 · W01 14.5 · W02 9.5 · W03 11.5 · W04 10.5 · W05 8.0 · W06 19.0 · W07 13.5 · W08 16.5 · W09 13.0 · W10 10.5 · W11 16.0 · W12 13.0 · W13 11.5 · W14 13.0.

## 1. Pace check (read this first)

- **Critical path in units** (longest chain of dependent issues, which parallel agents cannot shorten): W00 (3.0) → W01 (5.5) → W03 (5.5) → W06 (6.5) → W14 (3.0) = **23.5 units**. The hosted path W00 (3.0) → W08 (9.0) → W09 (6.0) → D10 gate = **18 units**.
- **Days available:** D2 → D14 = 12 build days.
- **Required pace:** the critical path fits only if one agent closes **≥ 2 units a day** on chained issues (23.5 / 12 ≈ 2.0, with no slack). TerraAgent's plan assumed ≥ 2.3; at **1.5 units/day the H set does not fit** and the drop order (§5) applies from D7.
- **Total throughput:** 191.5 units in ~11 days needs ~17.5 units/day: e.g. **8–9 agents at 2 units/day**, spread as in §4.
- **Calibration rule:** at the end of D4, divide landed H units by agent-days spent. Below 1.8 → apply drop steps 1–3 immediately; below 1.3 → apply all of §5 through step 6.

## 2. What ships (the demo judges see)

1. `git clone && ./bin/audit demo` — no keys, no Docker needed for the bundled fixture (OD-10): 4 scripted reviewers, per-model reports, two debate rounds, a judge, the general review, report v2 in the browser.
2. A local mixed run by the owner on a real repo: `--preset local-subscriptions` (claude, codex, grok, agy CLIs) **+** `key:zai:glm-5.3` **+** `openrouter:qwen/qwen3.8-max`, each with exactly 2 passes × 40 tool calls, per-model reports under `reviewers/`, cross-check, debate, general review.
3. The hosted testnet flow at `https://<domain>`: connect NEAR wallet → paste a GitHub URL → sign (NEP-413) → pay 1 testnet NEAR to `review-registry` → watch reviewers/passes/rounds live → open the report → attestation on the explorer.
4. Track 06: `GET /api/guard/verdict` + `@omniswarm/guard` + the prompt-injection attack log + the function-call key explanation.
5. Evidence: the golden-eval table (debate vs union vs majority vote), the dogfood report of `review-registry` (its in-sandbox `cargo test` shows as a coverage gap by design; W10's host-side `npm run test:contract` result is cited next to it), the baseline diff link.

## 3. Calendar

| Day | Date | Open / landing | Exit check |
|---|---|---|---|
| D2 | 11-02 | Plan written. **W00** opens (lead only); W00-19 `RULES.md` v0 | — |
| D3 | 11-03 | W00 lands (owner check). Open **W01** (spine), **W08**, **W10**, **W11**, **W12** | `npm run check:w00` green; `wave-00` |
| D4 | 11-04 | W01 continues; W08 ports + NEP-413; W10 contract + tests; W11 landing on MSW mocks; W12 host provisioned (owner: host, DNS) | Calibration (§1) |
| D5 | 11-05 | **W01 lands** → open **W02**, **W03**, **W05** | `wave-01`: `--reviewers` matrix plan |
| D6 | 11-06 | W08 lands → open **W09**; W10 testnet deploy (owner signs) | `wave-08`: signed request accepted on the mock chain |
| D7 | 11-07 | W02, W05 land; W03 lands late D7 → open **W04**, **W06**, **W07**; W10 lands → open **W13** | GLM + Qwen + scripted run end-to-end |
| D8 | 11-08 | W06 debate core; W07 sections on fixtures; W09 worker + publish; W12 stack up with TLS | — |
| D9 | 11-09 | W04 lands; W09 lands; W11 switches to the real API; owner picks OD-04's third model | Hosted cost per run measured (W12) |
| **D10** | **11-10** | **GATE** (§3a) | gate passes or drop order |
| D11 | 11-11 | W06 adjudication + general review + golden eval (live eval needs owner keys); W13 attack demo | — |
| D12 | 11-12 | W06, W07, W13 land; **W14** opens; dogfood run | `wave-06`, `wave-07`, `wave-13` |
| D13 | 11-13 | W14: README screener test in a clean clone, video recorded (owner), X post + form drafts | screener script passes |
| D14 | 11-14 | Owner: repo public, tag `hackathon-submission`, X post, form by 20:00 UTC | submitted |
| D15–D25 | 11-15 → 11-25 | Demo uptime check (W12); no feature work on `main` during judging | — |

### 3a. D10 gate (all must be true)

- [ ] Hosted testnet: login → sign → pay → queue → a review with the **scripted** preset → report published → `attest` tx visible on the explorer, in < 10 min.
- [ ] Same flow with the **hosted** preset on a small public repo completes, cost recorded in `usage.json`.
- [ ] Local: `--reviewers cli:claude:opus,key:zai:glm-5.3,openrouter:qwen/qwen3.8-max --passes 2 --tool-budget 40` produces three `reviewers/<id>/` reports with `usage.json` showing exactly 2 passes each.
- [ ] Debate round 1 + 2 run on scripted reviewers in CI; citation checker discards a planted fake citation.
- [ ] R-01, R-02, R-04 regression tests green.

**Gate fails →** freeze new scope: W06 ships challenge-only (round 1 + judge, `--debate-rounds 1`), W07 ships sections 05/06 without the per-finding timeline, W13 ships verdict + wrapper + attack demo without the public report endpoint.

## 4. Agent allocation (peak D5–D11)

| Track | Waves | Agents |
|---|---|---|
| Spine/Engine (lead + issue agents) | W01 → W02/W03/W05 → W04/W06/W07 | 4 (lead + 3) |
| Intake | W08 → W09 | 2 |
| Chain + Security | W10 → W13 | 1–2 |
| Front | W11 | 1 |
| Infra | W12 | 1 |
| **Total** | | **9–10** |

Runners: Claude Code sub-agents in worktrees for engine and intake; codex / grok / agy sessions are fine for W11, W12 and test-heavy issues. Real provider calls only in W03/W04/W06 issues marked live and only with `OMNI_LIVE=1`.

## 5. Drop order (first dropped first)

> **OD-17** (recommended): pre-demote steps 1–3 to `H+` on D3, before the D4 calibration, for about one day of buffer.

1. All `H+` rows (17 units).
2. W02 medium/low rows except R-01, R-02, R-04, R-09 (keep the security-track story honest).
3. W07: PDF pages and the accessibility pass; keep sections 05/06 and per-reviewer pages.
4. W06: live golden eval → offline scripted eval only, README says "live eval pending"; OD-14 defaults to `--debate-rounds 1`.
5. W11: "my requests" page and mobile polish; keep connect → sign → pay → status → report.
6. W12: backups and CI deploy → manual deploy script only.
7. W13: `POST /api/guard/reports` → blocklist entries added by the operator only.
8. W04: `--max-cost-usd` → per-preset fixed caps only.
9. W08: background payment reconciler → client-confirmed payments only.

Never dropped: W00, the W01 registry, the W03 families (cli/key/openrouter/scripted), the fixed passes × budget (W04 core), per-model reports (W05), debate round 1 + judge + general review (W06 core), sections 05/06 (W07 core), the paid testnet flow (W08–W11 core), the guard + attack demo (W13 core), W14.

## 6. Owner tasks (only the owner can do these)

| By | Task |
|---|---|
| D3 | Accept or change OD-01..OD-16 (`docs/spec/DECISIONS.md`); run the baseline tag command from W00-14 (`git tag pre-hackathon 94551b9 && git push origin pre-hackathon`) |
| D4 | Provide the remote host (OD-13), a domain + DNS for `<domain>`, `api.<domain>`, `reports.<domain>` |
| D4 | Keys in the host's `/etc/omniswarm/providers.env`: `ZAI_API_KEY` (pay-as-you-go, not the Coding Plan), `OPENROUTER_API_KEY`, optional `ANTHROPIC_API_KEY`; a GitHub token (public read) |
| D6 | Create and fund `review-registry.<you>.testnet` and the operator key; run W10's deploy script |
| D9 | Pick OD-04's third hosted model |
| D11 | Run the live golden eval with your local subscriptions (`OMNI_LIVE=1 npm run eval:golden`) |
| D13 | Record the video from W14's storyboard; create the **mainnet** payout account |
| D14 | Make the repo public, tag `hackathon-submission`, post on X (@NEARProtocol, #NEARHackathon, video), submit the form (tracks per OD-01) by 20:00 UTC |

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Pace below 2 units/agent/day | Critical path slips past D14 | Calibration on D4; drop order; W06 challenge-only fallback |
| Provider ToS for a paid service on personal subscriptions | Account suspension | OD-04: hosted preset uses API keys only |
| Hosted review cost exceeds the testnet price | Demo burns money | `--max-cost-usd`, round-robin assignment, measured on D9; allow-list mode for judges' repos |
| Screener has no Docker | README fails reproducibility | OD-10 no-Docker demo on bundled fixtures |
| Debate does not beat majority vote | Weak claim | OD-14: ship what the eval supports and say so |
| Target code tampering (R-01/R-02/R-04) found by a judge | Security-track credibility | W02 lands before any hosted run (D7) |
| RPC rate limits | Payment checks fail | FastNEAR + Lava fallback, backoff, reconciler |
