# packages/

Shared libraries. Each one is a root npm workspace (`packages/*`).

**Owning waves:** W00 and the lead (`packages/schemas`), W13 (`packages/guard`).

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries").

## packages/guard (`@omniswarm/guard`)

**Track:** Security (S) · **Owning wave:** W13 (agent guard).
**Gate command:** `npm run check:w13`: the workspace tests (`npm test -w @omniswarm/guard`), then `node packages/guard/demo/attack/run.mjs` with and without `--no-guard`.

An allow / warn / block wrapper around an agent's signer. The guard reads chain evidence through an injected `ChainReader` (registry attestations, the live code hash, the blocklist, account and attestation age); it does not need the API. `httpSource` is an optional verdict source for agents that would rather ask the API's `GET /api/guard/verdict`. See [`guard/README.md`](guard/README.md) and the prompt-injection demo in [`guard/demo/attack/`](guard/demo/attack/README.md).

## packages/schemas (`@omniswarm/schemas`)

**Owner:** the lead. It is the cross-track contract (AGENTS.md, "Tracks and boundaries"); a needed change is a change request to the lead.
**Gate command:** `npm run test:schemas`.

JSON Schemas for the engine, the intake API, jobs and attestations, plus the shared helpers both apps import by package name: `canonical-message` (request message and hash), `canonical-json` (report hash input), `nep413` (NEP-413 payload and base58) and `providers` (the LLM provider catalog: local, Z.AI, OpenRouter, NEAR AI Cloud; see [`docs/providers.md`](../docs/providers.md)).
