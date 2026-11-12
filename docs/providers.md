# LLM providers

OmniSwarm reviews a repository with models from four separate providers. Each provider has its own key, base URL and request body. A reviewer process only ever receives its own provider's variables.

| Provider | Catalog id | Reviewer spec | Key variable | Key comes from | What leaves the machine |
|---|---|---|---|---|---|
| Local CLI subscriptions (claude, codex, grok, agy) | `local` | `cli:<cli>:<model>` | none (each CLI's own login) | your CLI login | source goes to that CLI's vendor under your account |
| Z.AI | `zai` | `key:zai:<model>` | `ZAI_API_KEY` (optional `ZAI_BASE_URL`) | operator env, or the admin page | source goes to Z.AI |
| OpenRouter | `openrouter` | `openrouter:<org>/<model>` | `OPENROUTER_API_KEY` | operator env, or the admin page | source goes to OpenRouter and its model host, with `data_collection: "deny"` |
| NEAR AI Cloud | `nearai` | `nearai:<model>` | `NEARAI_API_KEY` | operator env, or **a signed-in account's own key** | source goes to NEAR AI Cloud; TEE attestation is **not** verified yet |

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
- where a key may come from (`operator-env`, `admin-page`, `account`);
- the data-policy line the UI shows.

Everything else reads it.

| Reader | What it takes from the catalog |
|---|---|
| `engine/scripts/provider-openai-compat.mjs` | `PRESETS`: base URL, key variable, body and headers of every API provider |
| `engine/scripts/provider-openrouter.mjs`, `provider-nearai.mjs` | one line each, via `singleProviderFamily(id)` in `provider-api-launch.mjs` |
| `engine/scripts/provider-key.mjs` | which `key:<provider>` entries are installed (today `zai`) |
| `engine/scripts/check-agents.mjs` | key presence for any API provider |
| `engine/scripts/local-cli.mjs` | `audit local --provider <id> --models …`, the key check and the data-policy line |
| `apps/api/src/worker/preset.ts` | which variables a hosted preset needs (`envForSpec`); `cli:` and `scripted` are refused |
| `apps/api/src/engine/cli/cli-runner.ts` | the only provider variables that may reach the engine (`providerEnvNames`), scoped per job |
| `apps/api/src/modules/providers/secrets.ts`, `apps/web/src/app/admin/page.tsx` (public half) | operator keys for the `admin-page` providers |
| `apps/api/src/modules/providers/account-keys.ts`, `account.routes.ts`, the web account panels | own keys for the `account` providers |

The provider-independent parts are the harness, the MCP bridge, the Docker sandbox, the debate, the reports and the reviewer skill. They see a reviewer id, a vendor and a family, never a key or a base URL. `engine/scripts/provider-presets.test.mjs` pins what each provider sends. `packages/schemas/providers.test.mjs` checks three invariants:

- No two providers share a key variable, base URL or spec prefix.
- A provider that takes account keys has a fixed base URL.
- Every family is one the reviewer-spec schema accepts.

## Switching providers

You never edit code to switch providers: you name different reviewer specs.

```sh
# local CLIs (default)
./bin/audit local

# one API provider: the first model orchestrates, every model reviews.
# Model ids below are placeholders: list what your key serves first, and pick tool-calling models.
export NEARAI_API_KEY=...        # or ZAI_API_KEY / OPENROUTER_API_KEY
curl -s -H "Authorization: Bearer $NEARAI_API_KEY" https://cloud-api.near.ai/v1/models
export OMNI_LIVE=1               # explicit opt-in to real, billed provider calls (otherwise: live_required)
./bin/audit local --provider nearai --models deepseek-ai/DeepSeek-V4,zai-org/GLM-5.3
./bin/audit local --nearai deepseek-ai/DeepSeek-V4      # shorthand
./bin/audit local --provider zai --models glm-5.3
./bin/audit local --provider openrouter --models qwen/qwen3.8-max-0902 --with-clis   # plus your CLIs

# any mix, explicitly
./bin/audit run --repo . --reviewers nearai:deepseek-ai/DeepSeek-V4,openrouter:x-ai/grok-4.7,cli:claude:opus \
  --orchestrator nearai:deepseek-ai/DeepSeek-V4 --plan
./bin/audit check-agents --reviewers nearai:deepseek-ai/DeepSeek-V4     # key present? never prints it
```

On the web, each provider that takes account keys gets one panel.

- **Dashboard and `/me`:** save the key once, then choose models (listed from the provider's `/models` endpoint, or typed in).
- **Dashboard "Review with":** pick the hosted panel or your own key.
- **Wallet signing step:** offers your own key when you are signed in as the same account, your key and at least one model are saved, and the operator allows it.

## Adding a provider

1. Add the public entry to `PUBLIC_PROVIDERS` in `providers-public.mjs`: id, label, transport, spec prefix, models path, key sources and data policy. Then add its wiring to `WIRING` in `providers.mjs`: base URL, key variable and allow-list, body and headers.
2. If its spec family is new, add the family to `reviewer-spec.schema.json`, `reviewer-registry.mjs` `FAMILIES` and `reviewer-families.mjs` `FAMILY_WAVES`. Then add `engine/scripts/provider-<family>.mjs` as `export const family = singleProviderFamily('<id>')`. A `key:<id>:` provider needs no new file.
3. Extend `provider-presets.test.mjs` with what it must send. `npm run test:schemas`, `npm test` and `npm run test:intake` then cover the rest. The engine allow-list, the hosted preset check, the admin or account key panels and the reports pick it up from the catalog.
4. Add its key variable to `infra/env/providers.env.example` if the operator supplies it, or allow `account-<id>` in `ALLOWED_PRESETS` if accounts bring their own.

## Accounts' own keys

A provider whose catalog entry lists `account` (today only NEAR AI Cloud) can run on a signed-in account's own key.

- **Storage:** Postgres `account_provider_key` (migration 010). AES-256-GCM under `ACCOUNT_KEYS_SECRET`, with `account:<provider>:<account>` as additional authenticated data, so a row copied to another account or provider does not open. Outside production `SESSION_SECRET` is used when `ACCOUNT_KEYS_SECRET` is unset. In production `ACCOUNT_KEYS_SECRET` is required and must differ from `SESSION_SECRET`, because the workers receive it.
- **API:**
  - `GET /api/account/providers`
  - `GET` and `PUT /api/account/providers/:provider` (`{key?, models?}`; an empty key clears it)
  - `GET /api/account/providers/:provider/models`
  - Session auth (password dashboard or the `sid` cookie from a signed request). Responses carry a fingerprint, never the key.
- **Preset:** `account-<provider>` (`account-nearai`). The first model orchestrates, every model reviews, a second model is the alternate judge. The models are snapshotted on the request row (`request.models`, migration 009), so a later change does not alter a queued or retried job.
- **Dashboard:** `POST /api/dashboard/jobs` with `source: "nearai"` needs no operator key.
- **Signed (wallet) requests:** a request may sign `preset: "account-nearai"` only when the operator lists it in `ALLOWED_PRESETS`. The account must have saved a key and models while signed in.
- **Worker:** passes only that account's key variable to the engine. `providerScope` removes every other provider variable from the spawn, so an operator key never rides along. A missing key or models fails the run as infrastructure and refunds it.

## Live calls

Every API-provider request goes through `engine/scripts/http-replay.mjs`, which refuses a real request without `OMNI_LIVE=1`; the reviewer then stops with `live_required`. Tests use recorded replies (`OMNI_HTTP_REPLAY`). The opt-in is explicit everywhere:

- `audit local --provider …` exits with an instruction when `OMNI_LIVE` is not `1`.
- The hosted worker passes `OMNI_LIVE` to the engine only when its own environment has it (`infra/env/worker.env.example` sets `OMNI_LIVE=1`).
- On the local stack, start with `OMNI_LIVE=1 LOCAL_ENGINE_RUNNER=cli npm run stack:local` (sandbox chain) or `OMNI_LIVE=1 NEAR_LOCAL=0 npm run stack:local` (mock chain).

## Cost

A provider that omits `usage.cost` is priced from `prices.<provider>.<model>` in `omniswarm.config.json`. Without that price, `--max-cost-usd` does not bound the spend. No NEAR AI price is configured, and whether NEAR AI Cloud returns `usage.cost` is unverified, so add `prices.nearai.<model>` before relying on the ceiling.

## Not built

- **NEAR AI Cloud TEE attestation (W03-22):** the nonce-bound attestation report and the "Verified" panel. Until then, treat `nearai:` like any other API provider. Do not call it private or confidential.
- **More `key:` providers:** `key:anthropic|openai|xai|google` parse but are not installed.
