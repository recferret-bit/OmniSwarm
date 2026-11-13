# packages/

Shared libraries. Each one is a root npm workspace (`packages/*`).

**Owning waves:** W00 and the lead (`packages/schemas`).

**Boundary:** NEAR wallet sign-in, donations, the GitHub API and the queue live only in `apps/` and `infra/`. `engine/scripts/`, `engine/docker/`, `engine/native/` and `engine/skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries").

## packages/schemas (`@omniswarm/schemas`)

**Owner:** the lead. It is the cross-track contract (AGENTS.md, "Tracks and boundaries"); a needed change is a change request to the lead.
**Gate command:** `npm run test:schemas`.

JSON Schemas for the engine, the intake API, and jobs, plus the shared helpers both apps import by package name: `canonical-json` (report hash input), `nep413` (NEP-413 payload and base58) and `providers` (the LLM provider catalog: local CLIs and NEAR AI Cloud; see [`docs/providers.md`](../docs/providers.md)).
