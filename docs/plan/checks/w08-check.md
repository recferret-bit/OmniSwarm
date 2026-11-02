# W08 — Intake API: owner check

Wave file: [`../waves/W08-intake-api.md`](../waves/W08-intake-api.md). About 5 minutes. No provider key and no Docker review sandbox. Postgres is a throwaway container on `127.0.0.1:55432` (`omniswarm` / `omniswarm`, database `omniswarm`).

Worktree: `../OmniSwarm-wt/w08` on `wave/w08-intake-api`.

```sh
docker run -d --name omniswarm-goal-pg -e POSTGRES_USER=omniswarm -e POSTGRES_PASSWORD=omniswarm -e POSTGRES_DB=omniswarm -p 127.0.0.1:55432:5432 postgres:16-alpine
export DATABASE_URL=postgres://omniswarm:omniswarm@127.0.0.1:55432/omniswarm
export SESSION_SECRET=dev-session-secret
```

## Steps

**1. Health and docs.** `npm run dev -w backend/intake` then:

- `GET /api/health` → `200` and `"ok": true`, `"network": "testnet"`, `"chain": {"rpc": true, "contract": true}`.
- `GET /api/docs` → HTML whose heading is `OpenAPI` and which lists `/api/challenge`, `/api/quote`, `/api/requests`, and `/api/requests/{id}/payment`.

**2. Challenge limit.** `POST /api/challenge` returns `{nonce, expiresAt}`. The nonce is 44-character base64. The 31st call in a minute from the same IP is `429` `RATE_LIMITED`.

**3. Quote.** `POST /api/quote` with `{"repoUrl":"https://github.com/near/near-sdk-rs","network":"testnet"}` returns `normalizedRepo: "near/near-sdk-rs"`, a 40-hex `commitSha`, `priceYocto: "1000000000000000000000000"`, `contractId: "review-registry.mock"`, `preset: "scripted"`. `private/hidden` → `REPO_PRIVATE`. `archived/old` → `REPO_ARCHIVED`. `huge/repo` → `REPO_TOO_LARGE`.

**4–6. Sign and pay.** `node backend/intake/scripts/sign-request.ts --account alice.mock --nonce <nonce>` prints the NEP-413 body. `POST /api/requests` returns `201` with `requestId` and `requestHash` and sets an httpOnly `sid` cookie. `node backend/intake/scripts/mock-pay.ts <requestId>` prints a tx hash. `POST /api/requests/<id>/payment` with the cookie returns `{"status":"queued","position":1}`.

**5. Rejections.** The same body again → `409 NONCE_USED`. One changed character in `message` → `401 SIG_INVALID`. `--permission FunctionCall` → `401 KEY_NOT_FULL_ACCESS`. A nonce older than five minutes → `401 NONCE_EXPIRED`. The same tx hash on a second request → `409 TX_ALREADY_USED`. `--amount 1` → `402 PAYMENT_MISMATCH`.

**7. Read.** `GET /api/requests/<id>` → `"status":"queued"`. `GET /api/requests?mine=1` with the cookie lists it. Without the cookie → `401`.

**8. Reconcile.** After mock-pay and before the payment call, `node backend/intake/scripts/reconcile.ts` moves that request to `queued`.

GitHub rows are recorded fixtures. Nothing in this check calls the GitHub API or a NEAR RPC.

## Automated checks

`npm run check:w08` (rules plus the HTTP spec above) passed against the throwaway Postgres. The engine suite was not changed.

Not in this land: live GitHub, the testnet chain adapter, and the worker (W09).
