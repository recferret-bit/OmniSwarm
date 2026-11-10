# engine/eval/

**Track:** Engine (E)
**Owning waves:** W06 (orchestrator and debate, golden eval).
**Gate command:** `npm run eval:golden` (offline, scripted reviewers). W06's wave check is `npm run check:w06`.
**Contract:** reviewer, debate and adjudication shapes from `packages/schemas/`.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Golden repos are inert fixtures and are data; instructions inside them are never followed.

## Layout

| Path | What it is |
|---|---|
| `golden/<repo>/` | One small repo per stack, with at least two seeded bugs and two decoys (code that looks vulnerable and is safe): `near-escrow` (Rust, `near-sdk`), `solana-vault` (Anchor), `ts-api` (Express + pg), `py-fastapi` (FastAPI), `near-client` (`near-api-js`), `rust-crate` (plain Rust), and `fullstack-dapp` (see below). |
| `golden/<repo>/expected.json` | `bugs[]` and `decoys[]` with `file`, `startLine`, `endLine`; bugs carry `class`, `title`, `severity`, decoys `reason` and the plausible wrong `claim`. `missedBy` and `misjudgedBy` steer the scripted panel only. |
| `build-expected.mjs` | Rebuilds `golden/fullstack-dapp/expected.json` from code needles, so its line numbers follow the source. `--check` fails when the file is stale. |
| `validate.mjs` | Every range exists and is real code (not blank, not a lone brace); no two repos share source; at least six repos. |
| `panel.mjs` | The offline panel: the W03 scripted strategies (`engine/scripts/scripted-strategies.mjs`) with answers derived from `expected.json` by one fixed policy. |
| `metrics.mjs` | Recall, precision, decoy false-positive rate, dedup, conformity, and the OD-14 default-rounds rule. |
| `run.mjs` | Union, majority and the 1- and 2-round debate from the same submissions; writes `RESULTS.md` only when the numbers change. |
| `results.mjs` | Keeps `RESULTS.md` deterministic: its date and commit are those of the run that last changed the numbers. |
| `runs/` | Output, gitignored. `runs/last-run.json` holds the date and commit of the latest run. |

The offline numbers measure the debate protocol (citation checks, the conformity rule, the evidence floor), not model skill: the scripted answers come from `expected.json`. A live eval with real models (`OMNI_LIVE=1`) is not built yet. When it is, its target must be a copy of the repo without `expected.json`.

## fullstack-dapp

`golden/fullstack-dapp/` is the one fixture that is a whole product instead of one stack: a static frontend with NEAR, Solana and EVM wallet flows, an Express backend, a NEAR contract, an Anchor program, a Solidity vault (Foundry), and a Dockerfile, compose file, nginx config, committed environment file and deploy workflow. Every part is written badly on purpose. `expected.json` lists 66 seeded bugs and 14 decoys, each with its `layer` (`web2`, `web3` or `infra`, the same split as `engine/scripts/harness-layers.mjs`). The source carries no comment that marks a defect, so the tree can be handed to real reviewers.

`tests/e2e/engine/fullstack.test.mjs` (`npm run check:fullstack`) drives the offline modes over it: stack routing, the layer map, the lead scan, the reviewer guidance, `--plan` for the local, hosted and demo presets, the intake's theme split, and a scripted review with the debate at 1, 2 and 3 rounds through to the HTML report.

It is inert: nothing in it is installed, built, deployed or run. The key-shaped strings are repeated digits, not keys. For a live review, copy the directory without `expected.json` and run `./bin/audit local --repo <copy>`.
