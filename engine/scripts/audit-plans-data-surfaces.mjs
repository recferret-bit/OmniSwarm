// Per-surface reviewer guidance tables of audit-plans.mjs renderSurfaceSkillGuidance: the surface titles and the
// stack-specific lines (Node, Python, Solana, NEAR contract and client). Data only; imports nothing.

export const SURFACE_TITLES = {
  S1: ['Identity, Scopes, Roles & Auth Planes', 'http, grpc, websockets, crypto, scopes_roles, api_dto_abuse'],
  S2: ['Input Handling, Protocol Parsing & Abuse', 'http, grpc, websockets, databases, api_dto_abuse'],
  S3: ['Business Logic, Value Flows, DB Locks & Custody', 'abuse_economy, databases, crypto, scopes_roles'],
  S4: ['Secrets, Config, Infrastructure & Response DTO Exposure', 'api_dto_abuse, http, grpc'],
  S5: ['Dependencies, Lockfiles, CI & Verifiable Builds', 'crypto, http'],
  S6: ['Client, Web Surface, WebSockets & Wallet Flows', 'http, websockets, crypto, abuse_economy, api_dto_abuse'],
};

export const NODE_SURFACE = {
  S1: ['- Node: audit guards/middleware (`@UseGuards`, Express middleware order), session cookies (`__Host-`, `httpOnly`, `SameSite`, `Secure`), CSRF/Origin checks and gRPC/WebSocket auth.'],
  S2: ['- Node: audit `@ZodBody/@ZodQuery/@ZodParams`/schema validators, prototype pollution, `child_process.exec`, `eval`/`new Function`, template-string SQL, SSRF and `path.join(req.*)` sinks.'],
  S3: ['- Node: audit single-transaction execution under `FOR UPDATE` row locks (Prisma `$transaction`, TypeORM) in canonical lock order and check-then-act gaps.'],
  S4: ['- Node: audit `.env` handling, helmet/CSP/nginx headers, Dockerfiles and leaked internal fields in controller DTOs.'],
  S5: ['- Node: audit `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml` advisories, lifecycle (`postinstall`) scripts and reachability.'],
  S6: ['- Node/browser: audit DOM XSS sinks, `postMessage` origin checks, CSP/SRI, CORS (`*` vs credentials) and WebSocket CSWSH.'],
};

export const PYTHON_SURFACE = {
  S1: [
    '- Python: map every FastAPI/Starlette route to its auth `Depends(...)` (router- and route-level), Django/DRF `permission_classes`, Flask `before_request`/decorators; list routes with none.',
    '- Python: audit JWT handling (python-jose/PyJWT: pinned `algorithms`, signature, `exp`/`aud`/`iss`), session/cookie flags, CSRF for cookie auth, and wallet-signature challenge binding (single-use nonce, domain, expiry, `hmac.compare_digest`).',
    '- Python: for every handler taking an `*_id`/wallet, confirm the loaded ORM object belongs to the caller before read or write (IDOR); compare admin/staff dependency chains with regular user routes.',
  ],
  S2: [
    '- Python: audit Pydantic models (`extra="forbid"`, length/range bounds), `**model.dict()` mass assignment, `Body/Query/Form` defaults and file uploads (`python-multipart`) for size/type/path handling.',
    '- Python: audit SQL built with f-strings/`%`/`.format` into `execute()`/`text()`/`.raw()`/`.extra()`; `subprocess(..., shell=True)`, `os.system`, `eval`/`exec`, `pickle`/`marshal`/`yaml.load`, XML parsers without `defusedxml`, Jinja2 `autoescape=False`/`render_template_string`, SSRF via `requests`/`httpx`/`aiohttp` with request-controlled URLs, `open()`/`send_file` path traversal.',
  ],
  S3: [
    '- Python: audit money/credit/ticket/state transitions for single-transaction execution with `with_for_update()`/`select_for_update()` or conditional UPDATEs; read-then-write across `await`, multiple sessions, and Celery/APScheduler retries or overlapping workers (idempotency keys).',
    '- Python: audit async races (shared module state, `asyncio.create_task` fire-and-forget, in-process caches/locks that break with multiple workers), Decimal vs float money math, and rounding/overflow in payout code.',
  ],
  S4: [
    '- Python: audit settings/env handling (`pydantic-settings` defaults, hard-coded secrets, `DEBUG=True`, `ALLOWED_HOSTS`, `SECRET_KEY`), response models vs ORM objects, verbose `HTTPException` detail and tracebacks, logging of secrets/tokens, Dockerfile (root user, base image pinning) and uvicorn/gunicorn proxy-header trust.',
  ],
  S5: [
    '- Python: audit `requirements*.txt`, `pyproject.toml`, `poetry.lock`/`uv.lock`/`Pipfile.lock`: unpinned `>=` specifiers and missing hashes mean the build is not reproducible and advisory scans cannot resolve versions; check `--index-url`/`--extra-index-url`, `-e`/`git+` dependencies and CI pip usage. Treat PyPI advisory leads (osv-scanner) as reachability questions.',
  ],
  S6: [
    '- Python-served client surface: audit server-rendered templates (Jinja2 autoescape, `|safe`, `Markup`), CORS/CSP/security headers set by middleware, WebSocket endpoints (handshake auth, Origin, per-message authorization) and what API responses expose to the browser.',
  ],
};

export const SOLANA_SURFACE = {
  S3: ['- Solana/Anchor: audit escrow invariants: `Signer` == stored authority, account owner checks, canonical PDA bumps, fixed CPI targets, `reload()` after CPI, closing/initialization and Merkle proof/root attestation rules. In `markdown_summary` add a dedicated "Solana program" paragraph: files reviewed, controls verified, and whether tests or builds actually ran.'],
  S6: ['- Solana: audit Solana Actions/Blinks (`/actions.json`, `/api/actions/*`) and wallet transaction signing flows.'],
  S5: ['- Solana: audit verifiable-build pinning (`cargo-build-sbf`, `solana-verify`) and RustSec advisories in `Cargo.lock`.'],
};

export const NEAR_CONTRACT_SURFACE = {
  S1: ['- NEAR contract: every public method is intentional. Callbacks use `#[private]` or an equivalent predecessor check. Authorization chooses `predecessor_account_id` or `signer_account_id` deliberately. Sensitive methods requiring a deposit-capable key use one yoctoNEAR; this does not replace caller authorization. Review initialization, migrations, duplicate inputs and account/amount bounds. Read the checklist in source; do not fetch it from the sandbox.'],
  S3: ['- NEAR contract: users pay for storage growth, collection prefixes are unique, balances are locked before a transfer, and callbacks are `#[private]` and settle success and failure. `ft_on_transfer` checks the fungible-token predecessor. `ft_resolve_transfer` is private. Release builds set `overflow-checks = true` or use checked arithmetic. Callbacks must remain safe if the callback receipt itself fails: bound result bytes before parsing, handle malformed results without panicking, bound inputs/loops/logs, and budget gas from measured worst cases with a margin (measurement remains unverified offline). Preserve invariants between receipts; record the original account, amount and operation state, settle once, and provide access-controlled recovery for stuck operations without double credits or refunds. Credit deposits only after success; lock withdrawals before scheduling and restore only on confirmed failure. Keep storage/refund liquidity available. `ft_on_transfer` returns the unused amount; `ft_resolve_transfer` refunds at most the original transfer and the receiver balance. Review initialization, upgrades/migrations, duplicate inputs, account/amount bounds, storage deletion refunds, and monitoring for failed callbacks. In `markdown_summary` add a NEAR paragraph: files reviewed, controls verified, and that cargo test was not run.'],
  S5: ['- NEAR contract: record the `near-sdk` pin. RustSec still runs through the existing offline `cargo audit` when `Cargo.lock` is present. `cargo near build reproducible-wasm` needs Docker and ignores uncommitted changes, so it is outside this review. Do not install the wasm target and do not deploy.'],
};

export const NEAR_CLIENT_SURFACE = {
  S1: ['- NEAR client: `KeyPair.fromString`, an `ed25519:` secret, and the near CLI keychain are key custody. Report the source. Do not extract or use the key, and do not read the CLI configuration.'],
  S3: ['- NEAR Intents: `@defuse-protocol/one-click-sdk-typescript`, `@defuse-protocol/intents-sdk`, and `@near-intents-agent-api/sdk` are recognition only. Do not request a quote, submit a deposit, or call the agent API.'],
  S5: ['- NEAR AI: `@neardefi/shade-agent-js` is an unaudited published library, not a deprecated package to remove. Do not install it. Do not run `npx skills add` or `npm install` of NEAR SDKs during the review.'],
  S6: ['- NEAR client: `@hot-labs/near-connect` and `near-api-js` sign and broadcast. Review how the wallet is asked to sign. `v1.signer` is a lead, not a mainnet read. Do not call `cloud-api.near.ai`, `1click.chaindefuser.com`, `agentsonintents.com`, OutLayer, or NEAR MCP.'],
};
