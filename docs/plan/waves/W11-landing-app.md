# W11 — Landing & Review App

> **Track:** Front (F) · **Tag:** `wave-11` · **Check:** `npm run check:w11` (= `npm run test:landing && npm run test:e2e -- landing`) · **E2E:** `e2e/landing/*.spec.ts`
> **Depends on waves:** W00 (`shared/schemas/intake-api.schema.json`, `job` and `attestation` schemas, root scripts, CI).
> **Soft dependencies:** W08/W09 (real API; until the D10 gate the app runs on MSW mocks generated from the schema), W10 (contract id, `get_attestation` view, explorer links; mock chain until then), W07 (published report pages; a bundled sample report until then), W12 (staging host for the real-API e2e).
> **Specs:** [`INTAKE.md`](../../spec/INTAKE.md) §2–§4, §6 · [`ORCHESTRATION.md`](../../spec/ORCHESTRATION.md) §2, §6 · OD-04, OD-07, OD-08, OD-09
> **Owned paths:** `frontend/landing/**`, `e2e/landing/**`. Reads, without editing: `scripts/report-style.css` (tokens are copied by a script, W11-02), `shared/schemas/**`.

## Goal

A visitor understands what OmniSwarm does in one screen, can open a **sample report without a wallet**, and a NEAR user can **connect a testnet wallet, quote a public GitHub repo, sign the request (NEP-413), pay through `request_review`, watch the swarm work live, and open the published report with its on-chain attestation verified in the browser**. Everything works first on MSW mocks and a mock wallet, then on the real API and testnet after the D10 gate. The page uses the report's visual language so the landing and the report look like one product.

## Demo story (the e2e in words)

1. Open `http://localhost:<landing>/` → hero ("A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR"), how-it-works in four steps (swarm → debate → general review → on-chain attestation), trust section, pricing (testnet 1 NEAR), footer links to the repo, RULES.md and the sample report.
2. Click **View a sample report** → `/sample` shows the bundled published report in a frame, with tabs General review / Per-model reports / Cross-check, and a "Verified on NEAR testnet" badge (mock chain in dev).
3. Click **Connect NEAR wallet** (dev: mock wallet `alice.testnet`) → the header shows the account chip.
4. Paste `https://github.com/near-examples/guest-book-examples` → **Get quote** → commit SHA, price, queue depth and ETA appear; paste a private repo URL (mock) → "This repository is private. Only public repositories can be reviewed."
5. Click **Sign request** → the wallet signs the canonical message; the app shows the request hash and moves to **Pay 1 NEAR**.
6. Click **Pay** → pending state, then "Payment confirmed — queued #1"; the app routes to `/r/<id>`.
7. On `/r/<id>` the timeline advances (prepare → tests → review → cross-check → debate → adjudicate → general review → publish); each reviewer row shows pass `k/2` and tool calls `n/40`; the debate shows round `r/2`.
8. On `done` → **Open report** shows the report frame and the attestation badge with the tx link; the browser recomputes the report hash and shows "hash matches on-chain attestation".
9. With mock error `QUEUE_FULL` → the quote says "Queue is full, try later" and **Pay is never offered**. With the wallet rejecting the tx → "Payment cancelled in wallet" + **Retry**.
10. Open `/me` → the account's requests with statuses, report links and refund tx links.
11. Resize to 360 px → the whole flow still works; the axe check reports no serious violations.

## Hackathon slice

- **The hackathon e2e covers demo steps:** 1–11 on mocks (W11-18, W11-19); steps 3–8 again on testnet after the D10 gate (W11-21).
- **Deferred:** social login (NEAR Auth / FastAuth), mainnet network switch, OG image polish.
- **Still true:** the production build contains no mock wallet, no MSW and no secret (W11-20).

## Features covered

- [ ] App scaffold, typed API client from the schema, env contract — W11-01
- [ ] Design tokens copied from the report CSS, light/dark — W11-02
- [ ] MSW mocks with a request state machine, SSE and error injection — W11-03
- [ ] Mock wallet (NEP-413 test key) for dev and e2e — W11-04
- [ ] Hero, how-it-works, trust, pricing, sample report — W11-05..09
- [ ] NearConnector provider (testnet, `signMessage` filter, sign-in/out) — W11-10
- [ ] Quote form with repo validation and mapped error codes — W11-11
- [ ] Sign step (challenge, canonical message, `signMessage`, request hash) — W11-12
- [ ] Pay step with pending / failed / retry — W11-13
- [ ] Live status page (SSE, reviewer passes, debate rounds) — W11-14
- [ ] Report viewer + in-browser attestation check — W11-15
- [ ] My requests — W11-16
- [ ] Mobile layout and accessibility — W11-17
- [ ] Playwright e2e on mocks (happy path, failure paths) — W11-18, W11-19
- [ ] Bundle check: no mocks, no secrets in production — W11-20
- [ ] Real-API testnet e2e after the D10 gate — W11-21
- [ ] SEO / OG metadata — W11-22
- [ ] Wave check guide and tag — W11-23

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|
| W11-01 | Contract & scaffold: Vite + React + TS app in `frontend/landing/` (workspace), router (`/`, `/sample`, `/r/:id`, `/me`), typed API client and error-code union generated from `shared/schemas/intake-api.schema.json` by `npm run gen:api -w landing`, env contract `VITE_API_BASE`, `VITE_NETWORK`, `VITE_INTAKE_RECIPIENT`, `VITE_CONTRACT_ID`, `VITE_RPC_URL`, `VITE_EXPLORER_URL`, `VITE_WALLET=real|mock` in `.env.example` | contract | S | H | W00-05..10 | Run `npm run gen:api -w landing && npm run build -w landing` → it builds, and changing a DTO field in the schema makes `tsc` fail in the client | INTAKE §4 |
| W11-02 | Design tokens: `npm run sync:tokens -w landing` copies colour, type scale, spacing, `.panel`, `.pill`, `.review` tokens from `scripts/report-style.css` into `src/styles/tokens.css` (generated header, no edit of the source); light and dark themes; one `Panel`, `Pill`, `Button`, `Stat` component set | client | S | H | W11-01 | Open `/` in light and dark mode → panels, pills and stat tiles match the report's `report.html` side by side; `sync:tokens --check` fails if the report CSS changed and tokens were not re-synced | ORCH §6 |
| W11-03 | MSW mocks from the schema: handlers for every `/api/*` endpoint, an in-memory request state machine `awaiting_payment → queued → running → publishing → done` (plus `failed`, `refunded`), an SSE `/events` stream replaying a recorded progress script, error injection via `?mock=<ERROR_CODE>` | test | M | H | W11-01 | Run `VITE_API=mock npm run dev -w landing`, create a request → `/api/requests/:id` walks every status in order within 60 s; `?mock=QUEUE_FULL` makes `/api/quote` return 503 `QUEUE_FULL` | INTAKE §3, §4 |
| W11-04 | Mock wallet `MockConnector` with the NearConnector surface used by the app (`connect`, `signIn/signOut` events, `getAccounts`, `signMessage` producing a real NEP-413 signature with a test ed25519 key, `signAndSendTransaction` returning a `mock:` hash, reject mode); enabled only when `VITE_WALLET=mock` | test | M | H | W11-01 | Unit test: a `signMessage` output from the mock verifies with `near-api-js` `verifyMessage` against a stub provider; `?wallet=reject` makes `signAndSendTransaction` throw `UserRejected` | INTAKE §2, §3.4 |
| W11-05 | Hero, header, footer: one-line value statement, primary CTA "Review a repo", secondary "View a sample report", account chip slot, footer links (repo, RULES.md, README, licence) | client | S | H | W11-02 | Open `/` at 1280 px → hero, both CTAs and the footer links are visible above/below the fold; every link resolves (link checker in W11-18) | — |
| W11-06 | How-it-works section: four steps (independent reviewers with fixed passes → anonymized debate with cited evidence → cross-family judge + general review → report hash attested on NEAR), inline SVG diagram, each step links to the matching RULES.md section | client | S | H | W11-02 | Open `/#how` → four numbered steps with the diagram; the diagram is readable in both themes and at 360 px | ORCH §2–§4 |
| W11-07 | Trust section: offline sandbox, no exploits, "instructions in your repo are data", function-call key limits of the operator key, "model agreement does not certify security", what is real vs mock on this deployment (reads `/api/health`) | client | S | H | W11-02 | Open `/#trust` with the mock API reporting `chain.contract: mock` → the section shows "Chain: mock (dev)"; with `testnet` → "Chain: NEAR testnet" and the contract id | INTAKE §1, §6 |
| W11-08 | Pricing section: price from `/api/quote` defaults (or `/api/health`), hosted reviewer preset list (OD-04), passes and tool budget, refund policy (OD-07), "testnet only during the hackathon" (OD-08/09) | client | S | H | W11-03 | Open `/#pricing` → "1 NEAR (testnet)", the three hosted reviewers, "2 passes × 40 tool calls", and the refund rules | OD-04, OD-07, OD-08 |
| W11-09 | Sample report page `/sample`: bundled published report under `public/sample/` (W07/W14 output when available, the engine `scripted` demo report until then), tabs General review / Per-model / Cross-check, attestation badge from a recorded attestation fixture; no wallet needed | client | S | H | W11-02 | Open `/sample` without a wallet → the report frame loads, the three tabs switch content, and the badge reads "Attested (sample)" | ORCH §6 |
| W11-10 | Wallet provider: `@hot-labs/near-connect` `NearConnector({network: VITE_NETWORK, features: {signMessage: true}})` in a React context, `wallet:signIn` / `wallet:signOut` listeners, account chip with sign-out, session restore on reload, `Uint8Array(32)` nonce (no `Buffer`), falls back to `MockConnector` only when `VITE_WALLET=mock` | client | M | H | W11-01, W11-04 | Click **Connect NEAR wallet** with the mock → chip shows `alice.testnet`; reload → still connected; **Sign out** → chip disappears | INTAKE §2, §3.1 |
| W11-11 | Quote form: accepts `https://github.com/o/r`, `github.com/o/r`, `o/r`, optional `@ref`; client-side regex `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`; optional "deployed NEAR account" field; calls `/api/quote`; shows normalized repo, short commit SHA (link to GitHub), price, queue depth, ETA; maps `REPO_PRIVATE`, `REPO_TOO_LARGE`, `QUEUE_FULL`, `RATE_LIMITED`, `REPO_NOT_FOUND` to plain messages | client | M | H | W11-03 | Enter `foo bar` → inline "Not a GitHub repository"; enter a valid repo → quote card with SHA, `1 NEAR`, `#0 in queue`; `?mock=REPO_PRIVATE` → "This repository is private…" and no Sign button | INTAKE §3.3, §5 |
| W11-12 | Sign step: `POST /api/challenge` → canonical message builder (sorted keys, no whitespace, `v:1`, fields of INTAKE §3.4 incl. `deployed`) shared as a pure module with a test vector checked into `e2e/landing/fixtures/canonical.json` (same vector the backend tests use) → `signMessage({message, recipient: VITE_INTAKE_RECIPIENT, nonce})` (or `signInAndSignMessage` when not connected) → `POST /api/requests`; `requestHash` computed with WebCrypto and compared with the server's | client | M | H | W11-10, W11-11 | Unit test: the builder reproduces the fixture message and hash byte-for-byte; in the UI, **Sign request** → the request hash shown equals the one returned by the API, and `NONCE_EXPIRED` (mock) restarts the challenge automatically once | INTAKE §3.2–§3.5 |
| W11-13 | Pay step: `signAndSendTransaction({receiverId: contractId, actions: [FunctionCall request_review {request_hash}, 30 TGas, deposit=priceYocto]})`; states `idle → waiting-wallet → submitted → confirming → queued`, `failed` with reason; `POST /payment` retried with backoff on `PAYMENT_NOT_FOUND` (finality lag, max 60 s); idempotent re-send of the same `txHash` after a reload (stored in `sessionStorage`) | client | M | H | W11-12 | Click **Pay** with the mock → "Confirming…" then "Queued #1" and a route to `/r/<id>`; with `?wallet=reject` → "Payment cancelled in wallet" + **Retry**; reload during "Confirming…" → the page resumes confirming the same tx | INTAKE §3.6–§3.7 |
| W11-14 | Status page `/r/:id`: subscribes to `/api/requests/:id/events` (SSE, falls back to polling `/api/requests/:id` every 5 s on error), phase timeline, per-reviewer rows (family badge, model, pass `k/P`, tool calls `n/N`, stop reason), debate round `r/R`, queue position while queued, terminal states `done`, `failed` (reason), `refunded` (refund tx link) | client | M | H | W11-03, W11-02 | Open `/r/<mock id>` → the timeline reaches `done` with each reviewer at pass 2/2 and the debate at round 2/2; kill the SSE mock mid-run → the page keeps updating via polling and shows "live updates paused" | INTAKE §3.8, §4; ORCH §3 |
| W11-15 | Report viewer: `<iframe sandbox="allow-scripts" src=reportUrl>` where reports are served from the separate origin `reports.<domain>` (W12), so the report's own nonce'd filter script runs but cannot touch the app origin, cookies or wallet (reports quote target-repo text); `VITE_REPORTS_ORIGIN` added to the env contract; tabs General review / Per-model (from `reviewers/index.json`) / Cross-check; attestation badge: fetch the canonical report files from the reports origin (CORS `GET` only), compute `reportSha256` in the browser, read `get_attestation(request_hash)` via a read-only RPC `call_function` view on `VITE_RPC_URL`, show "hash matches on-chain attestation" + explorer tx link, or a red "mismatch" | client | M | H | W11-14, W11-09 | Open `/r/<done id>` → **Open report** shows the frame and a green badge; tamper the mock report file → the badge turns red "hash does not match the attestation" | INTAKE §3.9, §6 |
| W11-16 | My requests `/me`: `GET /api/requests?mine=1` with the session cookie, list with repo, SHA, status pill, created time, report link, refund tx link; empty and signed-out states | client | S | H | W11-12 | After two mock requests, open `/me` → two rows with status pills; sign out → "Connect your wallet to see your requests" | INTAKE §4 |
| W11-17 | Mobile and accessibility: layout at 360/768/1280 px, keyboard-only flow, visible focus, `aria-live` for status changes, AA contrast in both themes, `prefers-reduced-motion` respected | client | S | H | W11-05..16 | Run the e2e at 360 px → the whole flow passes; `@axe-core/playwright` on `/`, `/sample`, `/r/:id` → zero serious or critical violations | — |
| W11-18 | Playwright e2e on mocks, happy path: connect (mock wallet) → quote → sign → pay → status to `done` → report viewer badge green → `/me`; plus a link checker over the landing | test | M | H | W11-10..16 | `npm run test:e2e -- landing` → `happy-path.spec.ts` green in Chromium and WebKit-mobile; it fails if any internal link 404s | demo steps 1–8, 10 |
| W11-19 | Playwright e2e on mocks, failure paths: `QUEUE_FULL` before payment (no Pay button), wallet reject + retry, `PAYMENT_NOT_FOUND` then success, `failed` → `refunded` with refund link, SSE drop → polling | test | S | H | W11-18 | `npm run test:e2e -- landing --grep @failure` → five scenarios green | demo step 9 |
| W11-20 | Production bundle guard: `npm run check:bundle -w landing` builds with `VITE_WALLET=real`, asserts MSW and `MockConnector` are tree-shaken out, and greps `dist/` for key-shaped strings (`ed25519:`, `sk-`, `ghp_`, `github_pat_`, base58 64-byte secrets, `OPENROUTER`, `ZAI_`) | security | S | H | W11-04, W11-03 | Run `npm run check:bundle -w landing` → passes; add a fake `sk-…` string to a component → it fails naming the file | INTAKE §5 |
| W11-21 | Real-API e2e (D10 gate): `E2E_API=real E2E_BASE=https://<staging>` runs steps 3–8 against W08/W09/W10 on testnet; the mock wallet signs with a real testnet test account whose full-access key comes from the `E2E_TESTNET_KEY` env/CI secret (never committed) and pays 1 testnet NEAR; the review uses the hosted or `scripted` preset | test | M | H | W11-18, W08 API, W09 worker, W10 testnet contract, W12 staging | Run `E2E_API=real npm run test:e2e -- landing --grep @real` on the D10 gate → the request reaches `done`, and the badge's tx link opens the `attest` tx on the testnet explorer | INTAKE §3 |
| W11-22 | SEO and metadata: title, description, OG/Twitter card image (static SVG→PNG), favicon from the report palette, `robots.txt`; no third-party analytics or fonts loaded from trackers | client | S | H+ | W11-05 | Paste the landing URL into an OG preview tool (or `npx opengraph-cli`) → title, description and image render | — |
| W11-23 | Wave check: write `docs/plan/checks/w11-check.md` from the running mock stack (URLs, mock params, what to see per demo step), gate run, tag | docs | S | H | W11-01..21 | `npm run check:w11` green; the owner follows `checks/w11-check.md` steps 1–11 → every step matches | checks/README |

## Wave DoD

- `npm run check:w11` passes (Vitest unit + Playwright landing suite on mocks); `npm run check:bundle -w landing` passes.
- After the D10 gate, the `@real` e2e passes once against testnet and its run is recorded in `checks/w11-check.md`.
- Every page works at 360 px and has no serious axe violation.
- The production build contains no mock wallet, no MSW worker and no secret.
- Tag `wave-11` on the merge commit.
