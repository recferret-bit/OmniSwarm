# W11 — Landing & Review App: owner check

Wave file: [`../waves/W11-landing-app.md`](../waves/W11-landing-app.md). About 10 minutes. Needs Google Chrome on the host. No paid key, no wallet extension, no testnet: everything below runs on MSW mocks and the mock connector.

## What this land is

`apps/web` (`@omniswarm/web`) is a Next.js 16 App Router app (TypeScript strict, `output: 'standalone'`) with Zustand stores. Routes: `/` (landing and request flow), `/sample` (bundled sample report), `/r/<id>` (status, then the report with the attestation check), `/me` (the account's requests).

- API: `src/lib/api/client.ts`, typed by `src/lib/api/schema.gen.ts`, generated from `packages/schemas/intake-api.schema.json` with `npm run gen:api -w apps/web`. `npm test` fails when the generated file is stale, and `ERROR_COPY` is exhaustive over the error-code union, so a new schema code fails `tsc` until it has copy.
- Wallet: `@hot-labs/near-connect` 0.12 `NearConnector` (`src/lib/near/near-connector.ts`). The mock connector (`src/mocks/wallet.ts`) is used only when the build sets `NEXT_PUBLIC_WALLET=mock`.
- NEP-413: the nonce comes from `POST /api/challenge`, the message from `@omniswarm/schemas/canonical-message`, the payload from `@omniswarm/schemas/nep413`, and the signature is sent as base64.
- Payment: `request_review` FunctionCall, 30 TGas, deposit = quoted price. The receiver is pinned to `NEXT_PUBLIC_CONTRACT_ID`; a different `contractId` from the API stops the payment (`CONTRACT_MISMATCH`). `{requestId, txHash}` is persisted in sessionStorage before `/payment`, and a reload during "Confirming" resumes the same transaction.
- Attestation: the browser fetches `findings-and-scores.json` and `general-review.json`, computes `digestReport` from `@omniswarm/schemas/canonical-json`, and compares the result with `get_attestation(request_hash)`. That value is read through a near-api-js `JsonRpcProvider` view on `NEXT_PUBLIC_RPC_URL` at finality `final`. `/sample` compares against a recorded fixture (`public/sample/attestation.json`) and labels itself "Attested (sample)".

## Gate

```sh
npm test -w apps/web            # gen:api --check, tsc --noEmit, Vitest (51 tests)
npm run build -w apps/web       # production build, standalone output
npm run guard -w apps/web       # production build in .next-guard + bundle scan
npm run test:e2e -- landing     # mock build in .next-e2e, next start, Chrome at 360x800
```

`npm run guard` builds with `NEXT_PUBLIC_WALLET=real` and `NEXT_PUBLIC_API_MOCK=0`. It then fails if any first-party output contains any of these:

- `MockConnector` or `alice.testnet`
- the MSW worker or `setupWorker`
- the mock reports origin
- a mock control (`Tamper the report`, `Mock mode (dev only)`, `REVIEW_FAILED`, `SSE_DROP`)
- the recorded sample hash inlined into code
- `ed25519:<base58 key>`, a base58 64-byte secret, `sk-…`, `ghp_…`, `github_pat_`, `OPENROUTER` or `ZAI_`

It also fails if `public/mockServiceWorker.js` exists. The e2e checks the scanner in the other direction: the mock build must trip `MockConnector`, the MSW worker check and the mock-control check.

## Steps (what the e2e drives, and what you see with `npm run dev -w apps/web`)

`npm run dev -w apps/web` runs on mocks by default (`.env.development`). Mock errors are set with `?mock=<CODE>` on any URL or with the dashed "Mock mode (dev only)" panel. The codes are `QUEUE_FULL`, `REPO_PRIVATE`, `REPO_TOO_LARGE`, `REPO_NOT_FOUND`, `RATE_LIMITED`, `NONCE_EXPIRED`, `PAYMENT_NOT_FOUND`, `REVIEW_FAILED`, `SSE_DROP` and `none`. `?wallet=reject` makes the next transaction fail.

1. `/` shows the hero "A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR". It also shows "Review a repo" and "View a sample report", How it works (four steps and the diagram), Trust ("Chain: mock (dev)" and the contract id), Pricing ("1 NEAR (testnet)", "2 passes × 40 tool calls", refund rules) and the footer links. axe reports nothing serious or critical.
2. **View a sample report** opens `/sample`, which says "No wallet is required to read a report." and "Attested (sample)", with a note that the record is not read from NEAR. The tabs General review / Per-model reports / Cross-check switch, and the published report loads in a sandboxed frame.
3. **Connect NEAR wallet** puts `alice.testnet` in the account chip. After a reload it is still connected. **Sign out** removes it.
4. `https://github.com/near-examples/guest-book-examples` → **Get quote** shows the commit, `1 NEAR`, `#0 in queue` and the ETA. `foo bar` shows "Not a GitHub repository" inline.
5. **Sign request** shows the request hash. Open the disclosure to see the public key, the base64 signature, the challenge nonce and the signed message. The e2e checks the signature with ed25519 over sha256 of the NEP-413 payload, and checks that `sha256(message)` equals the hash shown.
6. **Pay 1 NEAR** shows "Payment confirmed — queued #1" and routes to `/r/<id>`.
7. On `/r/<id>`, the steps run Awaiting payment → Queued → Running → Publishing → Done. The phases go prepare → tests → review → cross-check → debate → adjudicate → general review. Each reviewer row reaches `pass 2/2`.
8. **Open report** shows "hash matches on-chain attestation" and a link to the attest transaction. Both hashes are shown, and the e2e recomputes them from the served files. **Tamper the report** (mock panel) followed by **Verify again** shows "hash does not match the attestation".
9. With `?mock=QUEUE_FULL` you see "Queue is full, try later", and Sign and Pay are never offered. With `?mock=REPO_PRIVATE` you see "This repository is private. Only public repositories can be reviewed." With `?wallet=reject` you see "Payment cancelled in wallet." and **Retry**, and Retry pays. `?mock=PAYMENT_NOT_FOUND` confirms after a backoff. `?mock=REVIEW_FAILED` ends Refunded with a refund-tx link. `?mock=SSE_DROP` shows "Live updates paused — refreshing every 5 seconds."
10. `/me` lists the request with its status pill. Signed out, it says "Connect your wallet to see your requests".
11. Everything above runs at 360 px. axe is clean on `/`, `/sample` and `/r/<id>`.

## Deployment (W12)

`npm run build -w apps/web` writes `apps/web/.next/standalone`. Copy `.next/static` to `.next/standalone/apps/web/.next/static`, copy `public/` to `.next/standalone/apps/web/public`, then run `node apps/web/server.js` from the standalone root. nginx serves one origin:

- `location /api/` goes to Fastify (the `sid` cookie is HttpOnly and SameSite=Lax, so the API must be same-site).
- `location /_next/static/` and the `public/` files are served from disk.
- Everything else goes to the standalone server.

The Next rewrite of `/api/*` to `API_ORIGIN` exists only in `next dev`.

## Not in this land

- The real-API testnet e2e (W11-21, after the D10 gate).
- `sync:tokens` from `scripts/report-style.css`: the tokens in `src/app/globals.css` are copied by hand.
- A Content-Security-Policy beyond `frame-ancestors`. A full policy needs the near-connect executor origins and the reports origin.
- Debate round `r/R` and queue position on the status page: the progress schema has no round or position field.
- WebKit-mobile: `tests/e2e` ships `playwright-core` with the Chrome channel only.
