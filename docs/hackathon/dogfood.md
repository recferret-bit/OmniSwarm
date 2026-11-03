# Dogfood: OmniSwarm reviews its own registry contract

**Status: not run.** Part A needs real models (CLI subscriptions, and provider keys for the `mixed` preset). Part B needs a testnet deployment and testnet NEAR. Neither may run from an agent session, so this file is the owner's procedure plus a placeholder for the results.

What exists today: the contract's own host tests.

```sh
npm run test:contract     # cargo test on near-sdk's mock VM
npm run check:w10         # adds cargo clippy -D warnings and deploy-testnet.sh --dry-run
```

## Part A: review `contracts/review-registry` with real models

1. Install and check the reviewers. Log in to the CLIs you use (`claude`, `codex`, `grok`, `agy`). For `mixed`, also set `OPENROUTER_API_KEY` and `ZAI_API_KEY` in your own shell; never paste a key into a file in this repo.

   ```sh
   ./bin/audit setup-agents
   ./bin/audit check-agents
   ./bin/audit check-agents --reviewers openrouter:qwen/qwen3.8-max-0902,key:zai:glm-5.3   # checks presence, prints no key
   cp engine/omniswarm.config.example.json omniswarm.config.json
   ```

2. Print the plan. No model is called.

   ```sh
   ./bin/audit run --repo contracts/review-registry --preset mixed --plan
   ```

   Expected: 6 reviewers, `Assignment: matrix (36 jobs)`, `Budgets: passes 2; tool budget 40 per pass; debate rounds 2 (max 3); debate cluster cap 25; debate tool budget 12 per turn`, `Orchestrator: recommended -> cli:claude:opus`, `Alternate judge: cli:codex:gpt-6.1-sol`. To avoid API cost, use `--preset local-subscriptions` instead (4 CLI reviewers, 24 jobs).

3. Run it. `mixed` sends the contract source to OpenRouter (and its upstream provider) and to Z.ai, and is billed per token.

   ```sh
   ./bin/audit run --repo contracts/review-registry --preset mixed --out reports/dogfood-$(date +%Y%m%d)
   ```

   Expected: the stack profile detects a NEAR contract (`near-sdk`), so no `cargo test` runs in the sandbox and the report records a local-sandbox coverage gap. The report states INCOMPLETE if any reviewer, cross-check or debate turn failed.

4. Check and render.

   ```sh
   ./bin/audit verify reports/dogfood-<date>
   ./bin/audit html reports/dogfood-<date>
   ./bin/audit pdf reports/dogfood-<date>
   ```

5. Triage every CONFIRMED and LIKELY finding: fix it in `contracts/review-registry` (note the commit) or write why it stands. Fill the tables below. Do not commit `reports/`; publish the report directory on the reports host instead.

## Part B: attest a dogfood review on testnet

The hosted worker runs `./bin/audit run --github <owner/repo> --ref <sha> --preset <preset>` with no surface or subdirectory flag, so a hosted request reviews the whole repository at that commit, not only the contract.

1. Deploy the contract (see [contracts/review-registry/README.md](../../contracts/review-registry/README.md)):

   ```sh
   bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
   OWNER=<your-account>.testnet bash contracts/review-registry/scripts/deploy-testnet.sh --execute
   ```

2. Define the hosted preset. The API's default `HOSTED_PRESET` is `scripted`, which the example config does not define, so set `HOSTED_PRESET=hosted` (or `api-only`) or add a preset of that name to `omniswarm.config.json`. The worker refuses `cli:*` reviewers; only `scripted`, `key:zai` and `openrouter` run hosted.
3. Configure the API and worker for testnet (`NODE_ENV=production` selects the real chain, GitHub and engine adapters): `DATABASE_URL`, `NETWORK=testnet`, `CONTRACT_ID`, `INTAKE_RECIPIENT`, `RPC_URLS`, `OPERATOR_KEY_FILE` (the operator function-call key the deploy script saved), `REPORTS_ROOT`, `REPORTS_BASE_URL`, `ENGINE_ROOT`, `ENGINE_CONFIG`, `HOSTED_PRESET`, `GITHUB_TOKEN`, and the provider keys the preset needs, in the worker's env file only (`infra/env/worker.env.example`, `infra/env/stack.env.example`). Configure the web app with `NEXT_PUBLIC_NETWORK=testnet`, `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_INTAKE_RECIPIENT`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_EXPLORER_URL`, `NEXT_PUBLIC_API_MOCK=0`, `NEXT_PUBLIC_WALLET=real`.
4. The quote checks that the repository is public on GitHub, so make it public first (or use a public fork).
5. In the web app: connect a testnet wallet, quote `recferret-bit/OmniSwarm` at the commit, sign the NEP-413 message, pay 1 testnet NEAR, wait for `done`.
6. Verify by hand. Download the published report directory, then:

   ```sh
   node apps/api/scripts/report-hash.ts <report-dir>
   near contract call-function as-read-only <contract-id> get_attestation json-args '{"request_hash":"<request-hash>"}' network-config testnet now
   ```

   The first command's output must equal `report_sha256` in the second.

Known gaps that affect Part B (README, "Hosted flow on NEAR testnet"): the API does not serve `GET /api/reports/:id`, which the web report page calls, and `npm run stack:local` mixes real adapters in the API container with a mock worker.

## Results (owner fills)

<!-- OWNER: replace every <…> below after running Parts A and B. -->

| Item | Value |
|---|---|
| Date, commit | `<date>`, `<commit>` |
| Preset and reviewers | `<preset>`: `<reviewer ids>` |
| Orchestrator, alternate judge | `<…>` |
| Report | `<https://reports.<domain>/dogfood/report.html>` |
| Review state | `<COMPLETE / INCOMPLETE and why>` |
| Cost | `<sum of reviewers/*/usage.json>` |
| Testnet contract | `<review-registry.<owner>.testnet>` with `<nearblocks link>` |
| `request_review` tx, `attest` tx | `<explorer links>` |
| `report_sha256` on chain = `report-hash.ts` output | `<yes / no>` |

| Finding (cluster, final status, severity) | Fixed in commit, or why it stands |
|---|---|
| `<…>` | `<…>` |
