// Per-surface reviewer guidance tables of audit-plans.mjs renderSurfaceSkillGuidance: the surface titles and the
// stack-specific lines (Node, Python, Solana, NEAR contract and client, EVM contract, wallet flows, infrastructure). The renderer
// groups them by review layer (harness-layers.mjs): Python and Node are web2; Solana, NEAR, EVM and wallet flows are web3;
// INFRA_SURFACE is infra. Data only; imports nothing.

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
  S4: ['- Node: audit how the app loads secrets (`.env`, literal fallbacks, public build-time variables), security headers the app sets itself (helmet/CSP), error responses, and leaked internal fields in controller DTOs.'],
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
  S4: ['- Solana: audit who holds the upgrade authority and each program authority, whether authority keypairs or deploy wallets are committed or referenced by path, hard-coded program ids and cluster URLs, and what `msg!` logs reveal.'],
  S6: ['- Solana: audit Solana Actions/Blinks (`/actions.json`, `/api/actions/*`) and wallet transaction signing flows.'],
  S5: ['- Solana: audit verifiable-build pinning (`cargo-build-sbf`, `solana-verify`) and RustSec advisories in `Cargo.lock`.'],
};

export const NEAR_CONTRACT_SURFACE = {
  S1: ['- NEAR contract: every public method is intentional. Callbacks use `#[private]` or an equivalent predecessor check. Authorization chooses `predecessor_account_id` or `signer_account_id` deliberately. Sensitive methods requiring a deposit-capable key use one yoctoNEAR; this does not replace caller authorization. Review initialization, migrations, duplicate inputs and account/amount bounds. Read the checklist in source; do not fetch it from the sandbox.'],
  S3: ['- NEAR contract: users pay for storage growth, collection prefixes are unique, balances are locked before a transfer, and callbacks are `#[private]` and settle success and failure. `ft_on_transfer` checks the fungible-token predecessor. `ft_resolve_transfer` is private. Release builds set `overflow-checks = true` or use checked arithmetic. Callbacks must remain safe if the callback receipt itself fails: bound result bytes before parsing, handle malformed results without panicking, bound inputs/loops/logs, and budget gas from measured worst cases with a margin (measurement remains unverified offline). Preserve invariants between receipts; record the original account, amount and operation state, settle once, and provide access-controlled recovery for stuck operations without double credits or refunds. Credit deposits only after success; lock withdrawals before scheduling and restore only on confirmed failure. Keep storage/refund liquidity available. `ft_on_transfer` returns the unused amount; `ft_resolve_transfer` refunds at most the original transfer and the receiver balance. Review initialization, upgrades/migrations, duplicate inputs, account/amount bounds, storage deletion refunds, and monitoring for failed callbacks. In `markdown_summary` add a NEAR paragraph: files reviewed, controls verified, and that cargo test was not run.'],
  S4: ['- NEAR contract: audit who can deploy, upgrade or migrate the contract (full-access keys, an owner or DAO account, an `upgrade` method), hard-coded account ids, and what logs and view methods expose.'],
  S5: ['- NEAR contract: record the `near-sdk` pin. RustSec still runs through the existing offline `cargo audit` when `Cargo.lock` is present. `cargo near build reproducible-wasm` needs Docker and ignores uncommitted changes, so it is outside this review. Do not install the wasm target and do not deploy.'],
};

export const NEAR_CLIENT_SURFACE = {
  S1: ['- NEAR client: `KeyPair.fromString`, an `ed25519:` secret, and the near CLI keychain are key custody. Report the source. Do not extract or use the key, and do not read the CLI configuration.'],
  S3: ['- NEAR Intents: `@defuse-protocol/one-click-sdk-typescript`, `@defuse-protocol/intents-sdk`, and `@near-intents-agent-api/sdk` are recognition only. Do not request a quote, submit a deposit, or call the agent API.'],
  S5: ['- NEAR AI: `@neardefi/shade-agent-js` is an unaudited published library, not a deprecated package to remove. Do not install it. Do not run `npx skills add` or `npm install` of NEAR SDKs during the review.'],
  S6: ['- NEAR client: `@hot-labs/near-connect` and `near-api-js` sign and broadcast. Review how the wallet is asked to sign. `v1.signer` is a lead, not a mainnet read. Do not call `cloud-api.near.ai`, `1click.chaindefuser.com`, `agentsonintents.com`, OutLayer, or NEAR MCP.'],
};

// EVM contracts (Solidity, Vyper). Shown when the target has production contract source.
export const EVM_CONTRACT_SURFACE = {
  S1: ['- EVM contract: every `external`/`public` state-changing function has the access modifier it needs; authorization uses `msg.sender`, never `tx.origin`; ownership transfer is two-step; initializers run once and the implementation behind a proxy disables them; signature-authorized calls check the recovered signer against zero and bind a nonce, a deadline and an EIP-712 domain with the chain id.'],
  S2: ['- EVM contract: bound array lengths and loops fed by callers, validate addresses and amounts (zero address, zero amount, self-transfer), and treat every token and callback target a caller names as untrusted code.'],
  S3: ['- EVM contract: state is updated before any external call (checks-effects-interactions) or a reentrancy guard covers every path that shares the state, including cross-function and read-only reentrancy; low-level call results are checked; ERC-20 calls use SafeERC20 and measure the amount received; arithmetic is checked (Solidity >= 0.8, no `unchecked` on caller-influenced values) and division happens after multiplication; share and fee math cannot be rounded to the caller\'s advantage or inflated by a first deposit; prices do not come from a spot balance that a flash loan can move; `delegatecall` targets and `selfdestruct` are fixed and authorized. In `markdown_summary` add an EVM paragraph: files reviewed, controls verified, and that contract tests were not run.'],
  S4: ['- EVM contract: who holds the owner, admin and upgrade keys (an EOA, a multisig, a timelock), what a single key can do, whether privileged setters are bounded, and what events and public getters expose.'],
  S5: ['- EVM contract: the compiler version is pinned (no floating `pragma`), dependencies under `lib/` or `node_modules` are pinned to a release and not edited in place, and the build settings (optimizer, EVM version) are committed. `forge`, `hardhat` and `solc` are not in the sandbox image: do not install them; contract tests stay a coverage gap.'],
};

// Chain-neutral wallet flow checks, shown when production code imports a chain SDK or calls an injected wallet.
export const WALLET_SURFACE = {
  S1: ['- Wallet sign-in: the signed text is the exact server-issued challenge (domain, account, nonce, expiry), the nonce is single-use, and the verified public key is bound to the account the session is issued for.'],
  S3: ['- Off-chain ledger vs chain: a balance, credit or payout recorded by the backend must follow a transaction the server verified itself (hash, recipient, amount, finality), never a client report; payouts are idempotent and debited before they are sent.'],
  S4: ['- Key custody: signing keys held by a server or a script (environment, file, literal fallback, logs). Report where the key lives and who can read it. Do not read or use the key.'],
  S6: ['- Wallet signing intent: what the user is asked to sign and who chose it. Flag transactions or messages built from URL parameters, `postMessage` data or API responses and signed without showing the user the recipient and amount; access keys or approvals wider than the flow needs; `skipPreflight`; and hard-coded RPC endpoints without failover.'],
};

// Infrastructure checks, shown when the target has container, CI, proxy, deploy or environment files.
export const INFRA_SURFACE = {
  S1: ['- Infra: network-level access control (proxy `allow`/`deny`, internal-only locations, admin planes) must not be the only guard, and must cover every path that reaches the upstream.'],
  S4: [
    '- Containers: base image tag and digest, `USER` (root by default), `--privileged`, added capabilities, host mounts and the Docker socket, published ports and bind addresses, debug or inspector ports, secrets copied into an image layer.',
    '- Proxy and TLS: plain-HTTP listeners, missing HSTS and security headers, wildcard CORS added at the proxy, directory listing, version banners, and `X-Forwarded-*` headers passed through from the client instead of being set.',
    '- Secrets in configuration: committed `.env` files, compose `environment:` literals, default database passwords, and secrets written to logs or build output.',
    '- Orchestration and cloud: Kubernetes `securityContext` (`runAsNonRoot`, `allowPrivilegeEscalation`, `hostNetwork`, `hostPath`), Terraform ingress from `0.0.0.0/0`, public buckets and unencrypted storage.',
  ],
  S5: [
    '- CI: `pull_request_target` or `workflow_run` with a checkout of the PR head, workflow `permissions`, actions pinned to a commit, secrets in the environment of steps that run repository code, `${{ github.event.* }}` interpolated into `run:`, and secrets echoed to the log.',
    '- Build supply chain: piped installers, unpinned base images and tool downloads, `npm install` instead of `npm ci`, missing lockfiles, and build steps that fetch code at image build time.',
  ],
};
