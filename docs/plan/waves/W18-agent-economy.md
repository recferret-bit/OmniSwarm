# W18: Agent economy (receipts and the guard MCP server)

> **Track:** Security (S) with Intake (B) and Front (F) · **Tag:** `wave-18` · **Check:** `npm run check:w18` = `npm test -w packages/guard` + `node --test packages/guard/test/mcp.test.mjs` + `npm run test:intake -- receipt` + `npm run test:landing -- receipt`
> **Depends on waves:** W16 (it owns `components/report/**` until it lands). Soft: W15. With W15 landed, the MCP server and the receipt are shown on sandbox data; without it they use the mock chain.
> **Specs:** track 07 brief ("a receipt for every task: what was bought, from whom, at what price, and whether the work passed the agent's check"), track 06/07 "Start here" (NEAR MCP server `nearai/near-mcp`)
> **Owned paths:** `packages/guard/mcp.mjs`, `packages/guard/test/mcp.test.mjs`, `packages/guard/examples/mcp/**`, `apps/api/src/modules/report-index/**`, `apps/web/src/components/report/Receipt*.tsx`, `apps/web/src/app/r/**` (the receipt section only), `docs/plan/checks/w18-check.md`

## Goal

Make the agent-economy story concrete in two places:
- **Before paying:** any agent asks OmniSwarm's guard over MCP (`guard_verdict`, `get_attestation`, `is_reported`). It is read-only and keyless.
- **After a review:** every request has one receipt. It shows:
  - the price paid
  - each model hired, with its vendor, calls, tokens and cost (from `usage.json`)
  - how many findings passed the check (`CONFIRMED`/`LIKELY`/`REFUTED`)
  - the attestation tx, or the refund

## Demo story

1. `claude mcp add omniswarm-guard -- node packages/guard/mcp.mjs --api http://omniswarm.localhost:18480`, then in an agent session ask "is it safe to pay drained-vault.test.near?" → the tool returns `block` with reasons and the attestation link.
2. Open `/r/<id>` → the **Receipt** panel shows: paid 1 NEAR (tx link), reviewers (model, vendor, calls, tokens, USD), findings that passed the check (n of m), the attested hash with **match**, refund: none.
3. `curl /api/reports/<id> | jq .receipt` → the same data as JSON, valid against the schema.

## Hackathon slice

`H+`: open it only if W15 and W16 are tagged by D11 noon. Both parts are independent, so ship whichever finishes.

## Wave DoR

- [ ] `wave-16` is in `main`.
- [ ] The lead has landed W18-01 (receipt DTO, MCP tool schemas).
- [ ] D11 noon go/no-go is recorded in FINAL_SPRINT.

## Features covered

- [ ] DTOs: W18-01
- [ ] Receipt in the API and on `/r/<id>`: W18-02, W18-03
- [ ] Guard MCP server and example config: W18-04, W18-05
- [ ] Wave check and tag: W18-06

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W18-01 | Lead contract:<br>• the `receipt` object in the `intake-api` report DTO: `{paid:{yocto,tx}, reviewers:[{id,vendor,model,calls,tokens,usd}], check:{passed,total,byStatus}, attestation:{tx,hash,match?}, refund?}`<br>• MCP tool input/output schemas<br>• regenerate the two API files | contract | S | H+ | — | `packages/schemas/**`, the generated files | `npm run test:schemas` → receipt fixtures validate | — |
| W18-02 | API: assemble `receipt` in `GET /api/reports/:id` from the request row, `reviewers/*/usage.json`, `findings-and-scores.json` statuses and the chain tx ids | server | S | H+ | W18-01 | `apps/api/src/modules/report-index/**` | `npm run test:intake -- receipt` → a fixture report gives the expected receipt; a refunded request has `refund` and no `attestation` | INTAKE §4 |
| W18-03 | Web: a `Receipt` panel on `/r/<id>` (table, tx links through `explorer.ts`, uses the W15-10 verify result) | client | S | H+ | W18-01 | `apps/web/src/components/report/Receipt*.tsx`, the `/r` receipt section | `npm run test:landing -- receipt` → it renders the fixture. axe → 0 violations | — |
| W18-04 | `packages/guard/mcp.mjs`:<br>• a stdio MCP server, no deps beyond the guard<br>• tools `guard_verdict{account,network}`, `get_attestation{request_hash\|account}`, `is_reported{account}`, which call the API or RPC read-only<br>• no keys, no signing | security | M | H+ | W18-01 | `packages/guard/mcp.mjs`, `packages/guard/test/mcp.test.mjs` | `node --test packages/guard/test/mcp.test.mjs` → `tools/list` returns 3 tools; `guard_verdict` on the recorded reader returns `block` for `drained-vault` | — |
| W18-05 | Example MCP config for Claude Code and Codex, plus a guard README §MCP with demo step 1 | docs | S | H+ | W18-04 | `packages/guard/examples/mcp/**`, `packages/guard/README.md` §MCP | Following the README in a clean shell → demo step 1 works against `stack:local` | — |
| W18-06 | Wave check, `checks/w18-check.md`, tag `wave-18` | test | S | H+ | W18-02..05 | `docs/plan/checks/w18-check.md` | `npm run check:w18` → green | — |

**Parallel groups:**
1. W18-01 (lead).
2. W18-02, W18-03 and W18-04 together.
3. W18-05.
4. W18-06.

## Wave DoD

- Every receipt field comes from a stored artifact or a chain tx. Nothing is recomputed from memory or estimated.
- The MCP server cannot sign and holds no key; a test asserts it never imports a signer.
- `check:w18` is green. Tag `wave-18`.
