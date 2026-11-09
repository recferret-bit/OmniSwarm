# W19: Submission pack v2 (README for the AI screener, live links, submit)

> **Track:** Ops (lead and owner) · **Tag:** `wave-19`, then the owner's `hackathon-submission` · **Check:** `npm run check:w19` = `bash tools/screener-check.sh && npm run check:all && node tools/readme-claims.mjs`
> **Depends on waves:** W16 (green gates). Soft: W15 (local NEAR section), W17 (provenance and verified link), W18 (receipt and MCP, only if landed). README sections for unlanded waves are written as "not built" and filled in when the wave lands (`wave-19.2`).
> **Specs:** [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) §1 and Q-002/005/012/014/017, [`../../hackathon/TRACKS.md`](../../hackathon/TRACKS.md), [`../../hackathon/SUBMISSION.md`](../../hackathon/SUBMISSION.md)
> **Owned paths:** `README.md`, `docs/how-it-works.md`, `docs/hackathon/**`, `AGENTS.md` (lead), `tools/readme-claims.mjs`, `docs/plan/checks/w19-check.md`

## Goal

The README reads well to an AI screener: "check that it runs and does what the README says", in do-X-see-Y form with no marketing. That means:
- every claim either has a command that proves it, or is marked mock / not built
- **local audit** and **cloud audit** are presented as two modes of one engine
- the pitch (a guard backed by an attested multi-model review of the code the counterparty runs) leads the page
- the hackathon docs match the code
- the owner's live steps are listed with exact commands

## Demo story

1. Read the README top to bottom. First comes what it is and the problem (3 sentences). Then "Try it in 2 minutes" (no keys, no Docker): 4 numbered steps, each with what you will see.
2. "Run the whole NEAR flow locally" (needs network once to fetch near-sandbox): `npm run stack:local` → the browser flow ends in **match**.
3. "Real vs mocked" table: each row has a status and the command that proves it.
4. The NEAR section shows the testnet contract id, explorer links, the verified-build link, the methods, events and key limits, and the guard signals with their data sources.
5. Track fit: each 06/07 brief bullet maps to a file and a test.
6. `node tools/readme-claims.mjs` → every path in the README exists, every `npm run` script exists, every CLI flag is in `--help`, and the contract version and method list match `Cargo.toml` and `src/`.
7. `bash tools/screener-check.sh` on the pushed HEAD → green.

## Hackathon slice

All `H`. W19-09 and W19-10 are owner-gated.

## Wave DoR

- [ ] `wave-16` is in `main` (green gates).
- [ ] The README skeleton (W19-01) is approved by the owner. It is one reply on the section list.
- [ ] For W19-09: the owner has finished lane O steps O1a, O2, O3 and O4 (contract id, round-trip tx, verified link, dogfood hash).

## Features covered

- [ ] Skeleton and claim checker: W19-01, W19-02
- [ ] README content (try it, local NEAR, real vs mocked, NEAR, track fit, failure cases): W19-03..06
- [ ] Reference tables moved out: W19-07
- [ ] Hackathon docs synced: W19-08
- [ ] Live links: W19-09
- [ ] Wave check and submission: W19-10

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W19-01 | README skeleton. Sections:<br>• what / problem<br>• try it (keyless)<br>• local NEAR flow<br>• local audit<br>• cloud audit<br>• real vs mocked<br>• NEAR integration<br>• track fit<br>• how a review runs<br>• failure cases and known weaknesses<br>• golden eval (with caveat)<br>• disclosures<br>• baseline and tags<br>• license<br>Keep every `<!-- screener -->` block intact | docs | S | H | — | `README.md` | `bash tools/screener-check.sh` → still green. The owner approves the section list | Q-017 |
| W19-02 | `tools/readme-claims.mjs`:<br>• the README's backticked repo paths exist<br>• `npm run X` scripts exist<br>• `./bin/audit` flags appear in `--help`<br>• the contract version equals `Cargo.toml`<br>• every listed contract method exists in `src/*.rs` and every public method is listed | test | S | H | — | `tools/readme-claims.mjs`, `tools/readme-claims.test.mjs` | On today's README → it reports the 11 known stale items. After W19-03..06 → 0 | — |
| W19-03 | "What it is", "Try it in 2 minutes", "Local audit", "Cloud audit":<br>• the keyless blocks come first (fixes "Both need Docker" appearing first)<br>• then the local NEAR flow (if `wave-15`, else marked "not built")<br>• then the Docker demo<br>• fix `:36` (the split rule: >80 MB or >4000 files with more than one theme, or any web2/web3 review, per `themes.ts:95-102`) | docs | M | H | W19-01 | `README.md` §1–§5 | `readme-claims` → no stale item in §1–§5. A fresh reader runs §2 in under 2 minutes | HACKATHON §1 |
| W19-04 | "Real vs mocked" table and "NEAR integration":<br>• v0.3.0 methods, including `report_address`, `retract_report`, `is_reported`, `get_report(s)`, `get_report_count`<br>• the operator key's methods, including `report_address`, and the gas lock-out<br>• NEP-297 events, NEP-413, NEP-330 (if `wave-17`)<br>• guard signals and sources (NearBlocks age, `is_reported`)<br>• fix the paths at `:212` (`modules/auth/nep413.ts`) and `:214` (`modules/payments/`)<br>• drop the fixed `reports/:id` gap | docs | M | H | W19-01 | `README.md` §6–§7 | `readme-claims` → the method list and version match. Every "real" row names a command | TRACKS 06 |
| W19-05 | "Track fit": the track 06 bullets (signals, wrapper, function-call key, attack demo, shared blocklist) and track 07 (split, buy, check, pay, receipt, budget, key custody), each → file and test; 13 open; 03 dropped, with the reason | docs | S | H | W19-04 | `README.md` §8 | Every bullet has a path that exists and a test command | TRACKS |
| W19-06 | "Failure cases and known weaknesses":<br>• INCOMPLETE health, refund, cost ceiling, tool budget, allowance lock-out, stale attestation, code-hash drift<br>• the `operator`/`operator` account is local-only<br>• admin keys are encrypted under `SESSION_SECRET`<br>• the state of R-08 (the AGY hook fails open)<br>• native Codex/Grok admission was never run<br>• the golden eval is scripted<br>• update the commit count (216 of 265 after `94551b9`; recount at the freeze) and add `wave-00`, `wave-14`, `wave-15..19` to the wave list | docs | S | H | W19-01 | `README.md` §10–§13 | Each weakness names the file, or the finding id | track 13 |
| W19-07 | Move the presets, flags and "what a run writes" tables into `docs/how-it-works.md`; the README links to them | docs | S | H | W19-01 | `docs/how-it-works.md`, `README.md` | `readme-claims` covers `how-it-works.md` too → 0 stale items | — |
| W19-08 | Sync the hackathon docs:<br>• `SUBMISSION.md`: Request changes, the `size` values (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`), the `nearAddress` regex, drop "push `pre-hackathon`", tick the passing boxes, an X post draft with a question and @NearBuilders/@NearLegion<br>• `dogfood.md`: `HOSTED_PRESET=hosted`, the reports gap is fixed, real CLI workers<br>• `TRACKS.md`: OutLayer, Agent API policies, the gas lock-out note, the 11-09 track counts, 03 dropped<br>• `AGENTS.md`: point at `near/agent-skills` and `docs.near.org/llms.txt` | docs | S | H | — | `docs/hackathon/**`, `AGENTS.md` (lead) | A diff review against the 11-09 findings shows every item addressed | HACKATHON |
| W19-09 | Live links (after the owner's lane O):<br>• the testnet contract id and explorer links<br>• the verified-build link<br>• the round-trip tx hashes<br>• the dogfood report hash and its attestation<br>• the hosted URL<br>• the video link<br>• `dogfood.md` results table | docs | S | H | W19-03..06, owner O1–O7 | `README.md`, `docs/hackathon/{dogfood,SUBMISSION}.md` | Every link opens. `/r/<dogfood id>` on the hosted site shows **match** | Q-012 |
| W19-10 | Wave check:<br>• `check:w19` on the pushed HEAD<br>• `checks/w19-check.md` = the owner's submission checklist (public repo, X post, payout account, form fields, tags)<br>• tag `wave-19`<br>• the owner tags `hackathon-submission` and submits by 20:00 UTC on 11-14 | test | S | H | W19-01..09 | `docs/plan/checks/w19-check.md` | `npm run check:w19` → green. The compare link `pre-hackathon...hackathon-submission` resolves | SUBMISSION |

**Parallel groups:**
1. W19-01, W19-02 and W19-08 together on D10.
2. W19-03, W19-04, W19-06 and W19-07 together. They edit different README sections; one agent merges them in order 03 → 04 → 06 → 07.
3. W19-05.
4. W19-09 (D13, after the owner steps).
5. W19-10.

## Wave DoD

- `readme-claims` reports 0 stale items. `screener-check.sh` and `check:all` are green on the pushed HEAD.
- Every feature in the README is marked live, tested offline, mock, or not built, with a proving command.
- The pitch, local versus cloud audit, and the keyless path are in the first screen of the README.
- The hackathon docs reflect the 11-09 site and FAQ.
- Tags `wave-19` and `hackathon-submission` are pushed. The submission is sent by 20:00 UTC on 11-14.
