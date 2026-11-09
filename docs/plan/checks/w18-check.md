# W18 — Agent economy: owner check

Wave file: [`../waves/W18-agent-economy.md`](../waves/W18-agent-economy.md). Branch `wave/w18-agent-economy` in `../OmniSwarm-wt/w18`. The main checkout stays on `main`. No provider key. The MCP server holds no key and does not sign.

The owner opened W18 on 2026-11-09. `wave-15` and `wave-16` were already on main. The tag `wave-18` waits until the owner says to land it.

## Automated

```sh
npm run check:w18
```

That is `npm test -w packages/guard`, `node --test packages/guard/test/mcp.test.mjs`, `npm run test:intake -- receipt` and `npm run test:landing -- receipt`.

## Steps

**1. Guard over MCP.** With the local stack up (`npm run stack:local`):

```sh
claude mcp add omniswarm-guard -- node packages/guard/mcp.mjs --api http://omniswarm.localhost:18480
```

In that agent session ask: is it safe to pay drained-vault.test.near?

`guard_verdict` returns `block`, with reasons, and the attestation link. The server process has no key in its environment.

**2. Receipt.** Open `/r/<id>` for a finished local review. The Receipt panel shows the amount paid and its transaction, each reviewer's model, vendor, calls, tokens and USD, how many findings passed the check, the attested hash with **match**, and refund: none.

```sh
curl -sS "http://omniswarm.localhost:18480/api/reports/<id>" | jq .receipt
```

The JSON validates against `intake-api.schema.json#/$defs/receipt`. A refunded request has `refund` and no `attestation`.

**3. Config samples.** `packages/guard/examples/mcp/claude-code.json` and `packages/guard/examples/mcp/codex.toml` start the same server.
