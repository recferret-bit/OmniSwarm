# LLM providers

OmniSwarm reviews a repository with models from two kinds of provider: the vendor CLIs installed on your machine, and NEAR AI Cloud. Each provider has its own key, base URL and request body. A reviewer process only ever receives its own provider's variables.

| Provider | Catalog id | Reviewer spec | Key variable | Key comes from | What leaves the machine |
|---|---|---|---|---|---|
| Local CLI subscriptions (claude, codex, grok, agy) | `local` | `cli:<cli>:<model>` | none (each CLI's own login) | your CLI login | source goes to that CLI's vendor under your account |
| NEAR AI Cloud | `nearai` | `nearai:<model>` | `NEARAI_API_KEY` | your own shell (`audit local`), or **a signed-in account's own key** (hosted) | source goes to NEAR AI Cloud, billed to the key's owner; TEE attestation is **not** verified yet |

OmniSwarm charges users nothing and pays for no user's review. A hosted review runs only on the signed-in account's own NEAR AI Cloud key. The operator puts no provider key on the host (`infra/env/providers.env.example` is empty). Z.AI and OpenRouter were removed on 2026-11-12 ([DECISIONS.md](spec/DECISIONS.md) OD-26).

## One catalog

The catalog is the only place that describes a provider. It has two halves in `packages/schemas`:

- [`providers-public.mjs`](../packages/schemas/providers-public.mjs) holds what the browser may see.
- [`providers.mjs`](../packages/schemas/providers.mjs) imports it and adds the server-only wiring.

The web bundle guard (`npm run guard -w apps/web`) fails if a key variable name reaches the browser. Between them, the two halves record:

- the transport;
- the spec prefix;
- the fixed base URL;
- the key variable and its allow-list;
- the request body and headers;
- the models endpoint;
- where a key may come from (`operator-env`, `account`);
- the data-policy line the UI shows.

Everything else reads it.

| Reader | What it takes from the catalog |
|---|---|
| `engine/scripts/provider-openai-compat.mjs` | `PRESETS`: base URL, key variable, body and headers of every API provider |
| `engine/scripts/provider-nearai.mjs` | one line, via `singleProviderFamily(id)` in `provider-api-launch.mjs` |
| `engine/scripts/provider-key.mjs` | which `key:<provider>` entries are installed (today none) |
| `engine/scripts/check-agents.mjs` | key presence for any API provider |
| `engine/scripts/local-cli.mjs` | `audit local --provider nearai --models …`, the key check and the data-policy line |
| `apps/api/src/worker/preset.ts` | which variables a hosted preset needs (`envForSpec`); `cli:` and `scripted` are refused |
| `apps/api/src/engine/cli/cli-runner.ts` | the only provider variables that may reach the engine (`providerEnvNames`), scoped per job |
| `apps/api/src/modules/providers/account-keys.ts`, `account.routes.ts`, the dashboard key panel | own keys for the `account` providers |

The provider-independent parts are the harness, the MCP bridge, the Docker sandbox, the debate, the reports and the reviewer skill. They see a reviewer id, a vendor and a family, never a key or a base URL. `engine/scripts/provider-presets.test.mjs` pins what each provider sends. `packages/schemas/providers.test.mjs` checks three invariants:

- No two providers share a key variable, base URL or spec prefix.
- A provider that takes account keys has a fixed base URL.
- Every family is one the reviewer-spec schema accepts.

## Switching providers

You never edit code to switch providers: you name different reviewer specs.

```sh
# local CLIs (default)
./bin/audit local

# NEAR AI Cloud on your own key: the first model orchestrates, every model reviews.
# Model ids below are placeholders: list what your key serves first, and pick tool-calling models.
export NEARAI_API_KEY=...        # your own key, in your own shell
curl -s -H "Authorization: Bearer $NEARAI_API_KEY" https://cloud-api.near.ai/v1/models
export OMNI_LIVE=1               # explicit opt-in to real, billed provider calls (otherwise: live_required)
./bin/audit local --provider nearai --models deepseek-ai/DeepSeek-V4,Qwen/Qwen3.8-Max
./bin/audit local --nearai deepseek-ai/DeepSeek-V4      # shorthand
./bin/audit local --nearai deepseek-ai/DeepSeek-V4 --with-clis   # plus your installed CLIs

# any mix, explicitly
./bin/audit run --repo . --reviewers nearai:deepseek-ai/DeepSeek-V4,nearai:Qwen/Qwen3.8-Max,cli:claude:opus \
  --orchestrator nearai:deepseek-ai/DeepSeek-V4 --plan
./bin/audit check-agents --reviewers nearai:deepseek-ai/DeepSeek-V4     # key present? never prints it

# the iterative pipeline is provider-independent: the run's orchestrator (here the first NEAR AI model) gives the
# Step 2 advice and judges each debate round. Keep OMNI_LIVE=1 and the key in your shell for every step.
./bin/audit local --nearai deepseek-ai/DeepSeek-V4,Qwen/Qwen3.8-Max --step-by-step     # Stage 1 + advice, no debate
./bin/audit debate reports/<run> --rounds 1  # one more debate round, judged by the orchestrator
./bin/audit step reports/<run>               # the next stage: advice if there is none yet (after --no-debate), else a round
./bin/audit advise reports/<run>             # refresh the advice
```

If the orchestrator's provider refuses (no `OMNI_LIVE`, no key, a rejected key), Step 2 falls back to the rules advisor. `audit advise` and `audit step` then print the reason and what to set; the advice page shows it as the advisor's fallback reason. A Stage 1 reviewer session stopped the same way gets that next step in its incompletion note.

`--provider zai`, `--provider openrouter`, the `openrouter:` family and `cli:claude-zai` are gone. A spec that names them is refused.

On the web, NEAR AI Cloud gets one panel on `/dashboard`.

- **Sign in** with Google, X or a NEAR wallet.
- **Paste your NEAR AI Cloud key** once, then choose models (listed from NEAR AI's `/models` endpoint, or typed in). The page shows a fingerprint, never the key.
- **Submit a repository.** Every dashboard review runs on that key (`account-nearai`). There is no hosted panel and no operator key.

The landing page has no quote, sign or pay form. It links to `/dashboard`. The paid wallet flow (`POST /api/quote`, `request_review`) stays in the code but is dormant.

## Adding a provider

1. Add the public entry to `PUBLIC_PROVIDERS` in `providers-public.mjs`: id, label, transport, spec prefix, models path, key sources and data policy. Then add its wiring to `WIRING` in `providers.mjs`: base URL, key variable and allow-list, body and headers.
2. If its spec family is new, add the family to `reviewer-spec.schema.json`, `reviewer-registry.mjs` `FAMILIES` and `reviewer-families.mjs` `FAMILY_WAVES`. Then add `engine/scripts/provider-<family>.mjs` as `export const family = singleProviderFamily('<id>')`. A `key:<id>:` provider needs no new file.
3. Extend `provider-presets.test.mjs` with what it must send. `npm run test:schemas`, `npm test` and `npm run test:intake` then cover the rest. The engine allow-list, the hosted preset check, the account key panel and the reports pick it up from the catalog.
4. For hosted use, give it the `account` key source and allow `account-<id>` in `ALLOWED_PRESETS`. Users then bring their own key. Do not add an operator key to `infra/env/providers.env.example`: OmniSwarm does not pay for users' reviews.

## Accounts' own keys

A provider whose catalog entry lists `account` (today only NEAR AI Cloud) can run on a signed-in account's own key. It is the only way to use a cloud model on the hosted service.

- **Storage:** Postgres `account_provider_key` (migration 010). AES-256-GCM under `ACCOUNT_KEYS_SECRET`, with `account:<provider>:<account>` as additional authenticated data, so a row copied to another account or provider does not open. Outside production `SESSION_SECRET` is used when `ACCOUNT_KEYS_SECRET` is unset. In production `ACCOUNT_KEYS_SECRET` is required and must differ from `SESSION_SECRET`, because the workers receive it.
- **API:**
  - `GET /api/account/providers`
  - `GET` and `PUT /api/account/providers/:provider` (`{key?, models?}`; an empty key clears it)
  - `GET /api/account/providers/:provider/models`
  - Session auth (the `sid` cookie). Responses carry a fingerprint, never the key.
- **Preset:** `account-<provider>` (`account-nearai`). The first model orchestrates, every model reviews, a second model is the alternate judge. The models are snapshotted on the request row (`request.models`, migration 009), so a later change does not alter a queued or retried job.
- **Dashboard:** `POST /api/dashboard/jobs` always runs `account-nearai` on the signed-in account's key. It is refused until the account has saved a key and at least one model. Today it is also refused outside the mock chain and the local sandbox (`assertDashboardChain`), so a testnet deploy cannot run a dashboard review yet.
- **Signed (wallet) requests:** dormant. A request may sign `preset: "account-nearai"` only when the operator lists it in `ALLOWED_PRESETS`.
- **Pipeline steps:** a dashboard or signed request may ask for `pipelineMode: "step-by-step"` or `"stage-1"`. The follow-up `POST /api/dashboard/jobs/:id/advise|debate` (or `/api/requests/:id/advise|debate`) creates a child request with the parent's preset and model snapshot, so it runs on the same account key. These follow-up routes are refused outside the mock chain and the local sandbox (`assertDashboardChain`); on the sandbox the seeded payer pays for them.
- **Worker:** passes only that account's key variable to the engine. `providerScope` removes every other provider variable from the spawn, so no other key rides along. A missing key or models fails the run as infrastructure and refunds it.

## Live calls

Every API-provider request goes through `engine/scripts/http-replay.mjs`, which refuses a real request without `OMNI_LIVE=1`; the reviewer then stops with `live_required`. Tests use recorded replies (`OMNI_HTTP_REPLAY`). The opt-in is explicit everywhere:

- `audit local --provider nearai` exits with an instruction when `OMNI_LIVE` is not `1`.
- The hosted worker passes `OMNI_LIVE` to the engine only when its own environment has it (`infra/env/worker.env.example` sets `OMNI_LIVE=1`).
- On the local stack, start with `OMNI_LIVE=1 LOCAL_ENGINE_RUNNER=cli npm run stack:local` (sandbox chain) or `OMNI_LIVE=1 NEAR_LOCAL=0 npm run stack:local` (mock chain).

## Cost

The owner of the NEAR AI key pays NEAR AI Cloud for the tokens. OmniSwarm takes no fee. A provider that omits `usage.cost` is priced from `prices.<provider>.<model>` in `omniswarm.config.json`. Without that price, `--max-cost-usd` does not bound the spend. No NEAR AI price is configured, and whether NEAR AI Cloud returns `usage.cost` is unverified, so add `prices.nearai.<model>` before relying on the ceiling.

## Not built

- **NEAR AI Cloud TEE attestation (W03-22):** the nonce-bound attestation report and the "Verified" panel. Until then, treat `nearai:` like any other API provider. Do not call it private or confidential.
- **`key:` providers:** the `key:<provider>:<model>` family still parses, but no provider is installed for it.
