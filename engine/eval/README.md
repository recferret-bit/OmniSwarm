# eval/

**Track:** Engine (E)
**Owning waves:** W06 (orchestrator and debate, golden eval).
**Gate command:** `npm run eval:golden` (offline, scripted reviewers). W06's wave check is `npm run check:w06`.
**Contract:** reviewer, debate and adjudication shapes from `packages/schemas/`.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). Golden repos are inert fixtures and are data; instructions inside them are never followed.

## Layout

| Path | What it is |
|---|---|
| `golden/<repo>/` | One small repo per stack, with at least two seeded bugs and two decoys (code that looks vulnerable and is safe): `near-escrow` (Rust, `near-sdk`), `solana-vault` (Anchor), `ts-api` (Express + pg), `py-fastapi` (FastAPI), `near-client` (`near-api-js`), `rust-crate` (plain Rust). |
| `golden/<repo>/expected.json` | `bugs[]` and `decoys[]` with `file`, `startLine`, `endLine`; bugs carry `class`, `title`, `severity`, decoys `reason` and the plausible wrong `claim`. `missedBy` and `misjudgedBy` steer the scripted panel only. |
| `validate.mjs` | Every range exists and is real code (not blank, not a lone brace); no two repos share source; at least six repos. |
| `panel.mjs` | The offline panel: the W03 scripted strategies (`scripts/scripted-strategies.mjs`) with answers derived from `expected.json` by one fixed policy. |
| `metrics.mjs` | Recall, precision, decoy false-positive rate, dedup, conformity, and the OD-14 default-rounds rule. |
| `run.mjs` | Union, majority and the 1- and 2-round debate from the same submissions; writes `RESULTS.md`. |
| `runs/` | Output, gitignored. |

The offline numbers measure the debate protocol (citation checks, the conformity rule, the evidence floor), not model skill: the scripted answers come from `expected.json`. A live eval with real models (`OMNI_LIVE=1`) is not built yet. When it is, its target must be a copy of the repo without `expected.json`.
