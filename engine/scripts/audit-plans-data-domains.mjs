// Risk-domain tables of the review plans (audit-plans.mjs): per domain the marker and lead regexes, the source
// review checks, and the Python checks added when Python is detected. Data only. Mounted beside audit-plans.mjs
// in the sandbox (sandbox.sh), so it imports nothing.

export const DOMAIN_SPECS = [
  {
    id: 'http',
    title: 'HTTP / REST / GraphQL APIs',
    surfaces: ['S1', 'S2', 'S4', 'S6'],
    alwaysActive: false,
    summary: 'REST controllers, GraphQL resolvers, route guards, request schema validation, CORS/CSRF, and rate limits.',
    fileMarkers: [
      { re: /@(?:Controller|Get|Post|Put|Delete|Patch|Options|All)\s*\(/g, label: 'NestJS/Decorator HTTP route' },
      { re: /\b(?:app|router)\.(?:get|post|put|delete|patch|use)\s*\(\s*['"`/]/g, label: 'Express/Fastify/Hono route' },
      { re: /\b(?:FastAPI|APIRouter|@app\.(?:route|get|post)|http\.HandleFunc|gin\.Engine|axum::Router|actix_web)\b/g, label: 'HTTP framework router' },
      { re: /@(?:Resolver|Query|Mutation)\s*\(|type\s+Query\s*\{/g, label: 'GraphQL resolver/schema' },
      { re: /@\w+\.(?:get|post|put|delete|patch|route|api_route)\s*\(\s*['"]|\burlpatterns\b|\bAPIView\b|\bViewSet\b|\bBlueprint\s*\(/g, label: 'Python HTTP route (FastAPI/Flask/Django/DRF)' },
    ],
    leads: [
      {
        id: 'http-routes',
        title: 'HTTP Route & Controller Entry Points',
        re: /@(?:Controller|Get|Post|Put|Delete|Patch)\s*\([^)]*\)|\b(?:app|router)\.(?:get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]|@\w+\.(?:get|post|put|delete|patch|route|api_route)\s*\(\s*['"][^'"]+['"]|\burlpatterns\b|\bclass\s+\w+\((?:\w+\.)?(?:APIView|ViewSet|ModelViewSet|GenericAPIView)\)/g,
        note: 'Map each route to its auth guard, input schema validator, rate limit, and response DTO.',
      },
      {
        id: 'http-raw-input',
        title: 'Direct Request Input Access (Verify Schema Validation)',
        re: /\breq\.(?:body|query|params|headers)\b|@(?:Body|Query|Param)\s*\(\s*\)|\brequest\.(?:json|form|args|GET|POST|data|query_params|body)\b|await\s+request\.(?:json|body|form)\s*\(|\b(?:Body|Query|Form|Header|Cookie)\s*\(|\*\*\w*(?:payload|body|data)\w*\.(?:dict|model_dump)\s*\(|\*\*request\./g,
        note: 'Confirm input is validated via strict schema (e.g. @ZodBody/@ZodQuery/@ZodParams) and rejects unknown fields / mass assignment.',
      },
      {
        id: 'http-csrf-origin',
        title: 'Cookie / Origin / CSRF & Host Header Checks',
        re: /\b(?:SameSite|sameSite|samesite|csrf|xsrf|csrf_exempt|CSRFMiddleware|CORSMiddleware|allow_origins|allow_credentials|CORS_ALLOWED_ORIGINS|SESSION_COOKIE_\w+|TrustedHostMiddleware|headers\.origin|headers\.referer|headers\.host|CORS_ORIGINS)\b/g,
        note: 'Verify cookie-authenticated state changes enforce Origin/CSRF checks and host-bound planes cannot be spoofed.',
      },
    ],
  },
  {
    id: 'grpc',
    title: 'gRPC & Protobuf Services',
    surfaces: ['S1', 'S2', 'S4'],
    alwaysActive: false,
    summary: 'Protobuf schemas, unary/streaming RPC handlers, metadata authentication interceptors, message limits, and reflection.',
    fileMarkers: [
      { re: /\bsyntax\s*=\s*["']proto[23]["']|\bservice\s+[A-Za-z0-9_]+\s*\{/g, label: 'Protobuf service schema' },
      { re: /@(?:GrpcMethod|GrpcStreamMethod)\s*\(|\bTransport\.GRPC\b|@grpc\/grpc-js|\btonic::|\bprost::|\bgrpc\.NewServer\b|\bgrpc\.(?:aio\.)?server\s*\(|_pb2_grpc\b/g, label: 'gRPC server/client runtime' },
    ],
    leads: [
      {
        id: 'grpc-rpc-methods',
        title: 'gRPC Service & Method Definitions',
        re: /\brpc\s+[A-Za-z0-9_]+\s*\(|@(?:GrpcMethod|GrpcStreamMethod)\s*\([^)]*\)/g,
        note: 'Confirm HTTP guards are not assumed to protect gRPC handlers; verify dedicated gRPC auth interceptors/guards.',
      },
      {
        id: 'grpc-metadata-reflection',
        title: 'gRPC Metadata, Reflection & Message Limits',
        re: /\b(?:ServerReflection|tonic_reflection|reflection\.enable_server_reflection|maxReceiveMessageLength|maxSendMessageLength|grpc\.max_receive_message_length|ServerInterceptor|invocation_metadata)\b|\bgrpc\.Metadata\b|\bnew\s+Metadata\s*\(/g,
        note: 'Check if reflection is exposed in production, if metadata tokens are verified, and if message/stream sizes are bounded.',
      },
    ],
  },
  {
    id: 'websockets',
    title: 'WebSockets & Realtime Streams (WS / Socket.IO / SSE)',
    surfaces: ['S1', 'S2', 'S3', 'S6'],
    alwaysActive: false,
    summary: 'WebSocket gateways, Socket.IO / ws handlers, SSE streams, room/channel join authorization, and frame flood controls.',
    fileMarkers: [
      { re: /@(?:WebSocketGateway|SubscribeMessage|Sse)\s*\(|\bsocket\.io\b|\bWebSocketServer\b|\bnew\s+WebSocket\s*\(|\bgorilla\/websocket\b|\btokio_tungstenite\b|@\w+\.websocket\s*\(|\bWebSocketEndpoint\b|\bwebsockets\.(?:serve|connect|asyncio)|\bAsyncWebsocketConsumer\b|\bEventSourceResponse\b/g, label: 'WebSocket / SSE runtime' },
    ],
    leads: [
      {
        id: 'ws-gateways-events',
        title: 'WebSocket Gateways & Message Subscriptions',
        re: /@(?:WebSocketGateway|SubscribeMessage|Sse)\s*\([^)]*\)|@\w+\.websocket\s*\([^)]*\)|\basync\s+def\s+(?:websocket_\w+|\w*ws_\w*)\s*\(\s*\w*\s*:?\s*WebSocket\b|\bwebsocket\.(?:accept|receive_\w+|send_\w+)\s*\(|\b(?:ws|socket|io)\.on\s*\(\s*['"`](?:connection|message|[a-zA-Z0-9_:-]+)['"`]/g,
        note: 'Verify authentication on both initial handshake AND every subsequent message frame.',
      },
      {
        id: 'ws-rooms-broadcast',
        title: 'WebSocket Room Joins & Stream Broadcasts',
        re: /\b(?:socket|client)\.(?:join|leave|to|emit|send)\s*\(|\bgroup_(?:add|send)\s*\(|\b(?:manager|hub|connections)\.(?:broadcast|connect|subscribe|join)\s*\(/g,
        note: 'Check room/channel join calls for IDOR (can a user join another user\'s or an admin room without authorization?).',
      },
    ],
  },
  {
    id: 'databases',
    title: 'Databases, Transactions & Concurrency Locking',
    surfaces: ['S1', 'S2', 'S3'],
    alwaysActive: false,
    summary: 'SQL/NoSQL/Redis persistence, row-level locking (`FOR UPDATE`), transaction isolation, TOCTOU races, and query injection.',
    fileMarkers: [
      { re: /@prisma\/client|\b(?:PrismaClient|TypeOrmModule|drizzle-orm|Sequelize|mongoose|ioredis|sqlx::|diesel::|pg|mysql2|sqlite3)\b|datasource\s+db\s*\{|\b(?:sqlalchemy|psycopg2?|asyncpg|aiosqlite|peewee|tortoise|aioredis|redis\.asyncio|django\.db)\b/g, label: 'Database / ORM / Redis stack' },
    ],
    leads: [
      {
        id: 'db-locks-transactions',
        title: 'Transactions & Pessimistic Row Locks (`FOR UPDATE`)',
        re: /\$(?:transaction|queryRaw|executeRaw)\b|\bFOR\s+UPDATE\b|\bisolationLevel\b|\bwith_for_update\b|\bselect_for_update\b|\btransaction\.atomic\b|\bisolation_level\b|\bsession\.begin\b/gi,
        note: 'Verify every balance, credit, quota or entitlement mutation runs in ONE transaction under one canonical lock order.',
      },
      {
        id: 'db-state-mutations',
        title: 'Database Write / Update / Delete Operations',
        re: /\.(?:create|update|updateMany|upsert|delete|deleteMany)\s*\(\s*\{|\bsession\.(?:add|add_all|delete|merge|flush|commit)\s*\(|\.objects\.(?:create|bulk_create|update_or_create|get_or_create)\s*\(|\.(?:save|bulk_update)\s*\(/g,
        note: 'Check if state updates can race (TOCTOU) when called concurrently without a prior `FOR UPDATE` lock, and verify `where` clauses bind the authenticated owner.',
      },
      {
        id: 'db-raw-sql-redis',
        title: 'Raw Queries & Redis Cache / Queue Operations',
        re: /\$(?:queryRawUnsafe|executeRawUnsafe)\b|\.(?:query|raw|eval|evalsha|extra)\s*\(|\b(?:execute|executemany)\s*\(\s*(?:f['"]|['"][^'"\n]*(?:%s|%\(|\{))|\btext\s*\(\s*f?['"]|\bRawSQL\s*\(/g,
        note: 'Audit raw SQL/Redis scripts for parameter binding and injection.',
      },
    ],
  },
  {
    id: 'crypto',
    title: 'Cryptography, Web3 Signatures & On-Chain Custody',
    surfaces: ['S1', 'S3', 'S4', 'S6'],
    alwaysActive: false,
    summary: 'Solana/Anchor programs, Ed25519/SIWS authentication, Merkle roots & proofs, deterministic PRNG seeds, and key custody.',
    fileMarkers: [
      { re: /@solana\/web3\.js|\b(?:anchor_lang|solana_program|tweetnacl|ed25519|ethers|viem|createHash|subtle\.digest|solders\b|\bnacl\b|\bPyNaCl\b|cryptography\.hazmat|\bjose\.jwt\b|\bhmac\.compare_digest)\b/g, label: 'Crypto / Web3 / PRNG stack' },
    ],
    leads: [
      {
        id: 'crypto-sig-challenge',
        title: 'Signature Verification, SIWS Challenges & Nonces',
        re: /\b(?:sign\.detached\.verify|verifyMessage|solana:signIn|signMessage|challenge|nonce|verify_signature|VerifyKey|BadSignatureError|Signature\.from_bytes|compare_digest)\b/g,
        note: 'Verify the signed payload is compared byte-for-byte against the server-issued challenge (domain, wallet, nonce, expiry) and consumed once.',
      },
      {
        id: 'crypto-merkle-hash',
        title: 'Merkle Proofs, Roots & Hash Commitments',
        re: /\b(?:merkle|createHash\s*\(\s*['"`]sha256['"`]|keccak256)\b/gi,
        note: 'Check leaf encoding for domain separation and unambiguous field boundaries so concatenation collisions or forged leaves are impossible.',
      },
      {
        id: 'crypto-prng-random',
        title: 'Randomness & Seed Generation (`Math.random` vs CSPRNG)',
        re: /\b(?:Math\.random\s*\(|randomBytes|randomUUID|getRandomValues|random\.(?:random|randint|choice|choices|shuffle|seed|getrandbits)\s*\(|secrets\.token_\w+|os\.urandom|uuid\.uuid[14])\b/g,
        note: 'Confirm `Math.random()` is never used for tokens, nonces, challenges or value-bearing randomness, and that deterministic seeds are server-authoritative.',
      },
    ],
  },
  {
    id: 'scopes_roles',
    title: 'Scopes, Roles & Access Control Misvalidation',
    surfaces: ['S1', 'S3', 'S4'],
    alwaysActive: true,
    summary: 'Horizontal privilege escalation (IDOR), vertical role/admin bypass, host/plane isolation, and token/ticket scope confusion.',
    fileMarkers: [],
    leads: [
      {
        id: 'scope-guards-planes',
        title: 'Authentication Guards, Admin Checks & Host Plane Restrictions',
        re: /@(?:UseGuards|Public|Admin|Roles)\b|\bcanActivate\b|\bheaders\.host\b|\bDepends\s*\(\s*\w*(?:auth|user|admin|current|permission|role|session|wallet)\w*|\bSecurity\s*\(|\bpermission_classes\b|@(?:login_required|permission_required|user_passes_test)\b|\bis_(?:staff|superuser|admin)\b|\brequire_(?:admin|role|auth)\w*/g,
        note: 'Check every privileged controller/handler for an authenticated role check plus any host/plane restriction the design requires; new routes should be guarded by default.',
      },
      {
        id: 'scope-resource-lookup',
        title: 'Resource Lookups by ID / Account (IDOR & Ownership Check)',
        re: /@(?:Param|ZodParams)\b|\bfind(?:Unique|First|ById)\s*\(\s*\{[^}]{0,120}\bid\b|\bget_object_or_404\s*\(|\.(?:get|filter|filter_by)\s*\([^)\n]{0,120}\b\w*_?id\s*=|\bsession\.get\s*\(\s*\w+\s*,/g,
        note: 'Trace whether the fetched resource is verified to belong to the caller (session user, account or wallet) before mutation or private read.',
      },
    ],
  },
  {
    id: 'abuse_economy',
    title: 'Automation Abuse & Value-Flow Integrity',
    surfaces: ['S1', 'S2', 'S3', 'S6'],
    alwaysActive: true,
    summary: 'Server authority over value-bearing actions (rewards, credits, promotions, claims, payouts, settlements), client-reported state, replay and uniqueness, deadlines, idempotent jobs, and scripted or sybil abuse.',
    fileMarkers: [
      { re: /\b(?:telemetry|heartbeat|verdict|leaderboard|promo|coupon|voucher|referral|reward|payout|refund|withdrawal|settlement|airdrop|faucet)\b/g, label: 'Value-flow / automation-abuse surface' },
    ],
    leads: [
      {
        id: 'abuse-client-state',
        title: 'Client-Reported State, Telemetry & Verdict Rules',
        re: /\b(?:telemetry|heartbeats?|verdicts?|leaderboards?|anti_?cheat|antiCheat|clientScore|reportedScore)\b/g,
        note: 'Check whether a scripted client can forge, replay or reorder client-reported state (telemetry, heartbeats, scores) that the server accepts without independent verification.',
      },
      {
        id: 'abuse-background-jobs',
        title: 'Background Jobs, Schedulers & Async Workers',
        re: /@(?:shared_task|(?:celery|app|\w+_app)\.task)\b|\.(?:delay|apply_async)\s*\(|\bAsyncIOScheduler\b|\bBackgroundTasks\b|\basyncio\.create_task\s*\(|\bcrontab\s*\(/g,
        note: 'Check job idempotency and double-execution (retries, overlapping schedules, multiple workers) for money, payout and state transitions; confirm job inputs are server-derived.',
      },
      {
        id: 'abuse-value-actions',
        title: 'Rewards, Promotions, Claims & Payout Entry Points',
        re: /\b(?:redeem\w*|promo\w*|coupon\w*|voucher\w*|referral\w*|claim|payout|refund|withdraw|airdrop|faucet|settle\w*)\b/gi,
        note: 'Check whether scripts or sybil accounts can farm or double-redeem promotions and rewards, act after a deadline or cutoff, or stall a settlement; confirm each claim is unique, server-derived and bound to its owner.',
      },
    ],
  },
  {
    id: 'api_dto_abuse',
    title: 'API Abuse, Response DTO Leakage & Enumeration Oracles',
    surfaces: ['S1', 'S2', 'S4', 'S6'],
    alwaysActive: true,
    summary: 'Response DTO inspection, user/state enumeration oracles (e.g. "already registered"), over-broad entity serialization, and endpoint abuse.',
    fileMarkers: [],
    leads: [
      {
        id: 'dto-enumeration-messages',
        title: 'State & User Enumeration Oracles in Error / Response Messages',
        re: /['"`][^'"`\n]*\b(?:already\s+(?:registered|exists|used|claimed|redeemed)|not\s+found|invalid\s+(?:password|code|promo|signature|challenge)|no\s+such\s+user)\b[^'"`\n]*['"`]/gi,
        note: 'Double-check every distinct message/status code: if a public or unthrottled API reveals whether a user, wallet, promo code, or resource exists, check if bots can abuse it as an enumeration oracle.',
      },
      {
        id: 'dto-serializers-returns',
        title: 'Controller Response DTOs & Serialization Boundaries',
        re: /\b(?:Dto|Response|toJson|toResponse|serialize)\b|@(?:ZodSerializerDto|SerializeOptions)\b|\bresponse_model\b|\.model_dump\s*\(|\.dict\s*\(\s*\)|\bfrom_orm\b|\bserializers\.\w+|\bJsonResponse\s*\(|\bjsonify\s*\(/g,
        note: 'Verify responses use explicit allowlist DTOs and never serialize raw DB rows, internal secrets, unredacted seeds, or other users\' private fields.',
      },
      {
        id: 'api-abuse-throttling',
        title: 'Rate Limits, Batch Caps & Public Action Endpoints',
        re: /@(?:Throttle|SkipThrottle)\b|\b(?:rateLimit|maxItems|batch|actions\.json|\/api\/actions)\b|\b(?:slowapi|Limiter|limiter\.limit|throttle_classes|ratelimit|max_length|max_items|le=\d+)\b/g,
        note: 'Check public/unauthenticated endpoints and batch uploaders for missing rate limits, unbounded array sizes, or amplification.',
      },
    ],
  },
];

export const REVIEW_CHECKS = {
  http: ['Trace authentication, authorization, request validation, response fields and error handling in source.', 'Inspect CORS, CSRF, rate-limit and request-size configuration; cite missing controls and existing tests.'],
  grpc: ['Inspect protobuf schemas, authentication metadata, message bounds, deadlines and stream cancellation in source.', 'Check existing tests for authorization and resource-limit handling; do not send traffic to services.'],
  websockets: ['Trace upgrade authentication, Origin checks, room membership and per-message authorization in source.', 'Inspect frame bounds, cleanup, rate limits and existing coverage.'],
  databases: ['Trace queries, transactions, lock ordering, uniqueness constraints and rollback behavior.', 'Inspect parameter binding and existing concurrency tests; disclose untested schedules.'],
  crypto: ['Trace signer/owner checks, authority binding, PDA seeds, nonce expiry, custody and payout invariants.', 'Inspect dependency pins and existing signature/account-validation tests without constructing transactions or PoCs.'],
  scopes_roles: ['Map resource ownership and role checks from authenticated identity to each handler.', 'Compare admin, user and public entry points and cite inconsistent boundaries in source.'],
  abuse_economy: ['Inspect server authority, replay validation, uniqueness, deadlines and value-bearing state transitions.', 'Assess abuse resistance from source and existing tests; do not build automation clients or forged requests.'],
  api_dto_abuse: ['Compare response DTOs and errors with authorization and data-minimization requirements.', 'Trace field selection and enumeration differences in source; do not probe accounts or endpoints.'],
};

// Python-specific source checks, added to a domain's plan only when Python is a detected ecosystem.
export const PYTHON_CHECKS = {
  http: [
    'FastAPI/Starlette: every router must carry its auth `Depends(...)` (router-level or per-route); list routes with no dependency and confirm each is intentionally public. Check `include_router(..., dependencies=[...])` coverage and middleware ordering.',
    'Django/DRF: compare `permission_classes`/`DEFAULT_PERMISSION_CLASSES`, `csrf_exempt`, `DEBUG`, `ALLOWED_HOSTS`, `SECURE_*`/`SESSION_COOKIE_*` settings; Flask: `SECRET_KEY` source, session cookie flags, `Blueprint` before_request guards.',
    'Pydantic: request models should forbid unknown fields (`extra="forbid"`) and bound `max_length`/`ge`/`le`; flag `**payload.dict()`/`model_dump()` spread into ORM constructors or updates (mass assignment of role, owner, balance fields).',
    'CORS: `CORSMiddleware` with `allow_origins=["*"]` or reflected origin together with `allow_credentials=True`; cookie-authenticated state changes need Origin/CSRF checks (Starlette has no default CSRF).',
  ],
  grpc: ['grpcio: server interceptors must authenticate every method; check `max_receive_message_length`, reflection and `context.abort` paths that leak internals.'],
  websockets: ['FastAPI/Starlette/`websockets`: auth happens once at `accept()`; confirm the token is validated before accept, `Origin` is checked, and per-message authorization, size caps and rate limits exist. Look for broadcast managers that fan out private data by room id without membership checks.'],
  databases: [
    'SQLAlchemy/Django ORM: balance/credit/ticket/state changes must run in one transaction with `with_for_update()`/`select_for_update()` (or an atomic conditional UPDATE) in a canonical lock order; flag read-then-write across `await` points and separate sessions.',
    'Raw SQL: `text(f"...")`, `execute("..." % x)`, `.format`, `.raw()`/`.extra()`/`RawSQL` must use bound parameters; check `order_by`/column names taken from request data.',
    'Async correctness: shared module-level state mutated across coroutines, `asyncio.create_task` without error handling, and sessions shared between requests are race and data-leak sources.',
  ],
  crypto: [
    'python-jose/PyJWT: `decode` must pin `algorithms`, verify signature, `exp`, `aud` and `iss`; flag `options={"verify_signature": False}`, `verify=False`, HS/RS confusion and key material loaded from request data.',
    'Wallet auth (solders/PyNaCl/solana-py): confirm the signed message is the exact server-issued challenge (domain, nonce, expiry), nonce is single-use and stored atomically, and comparisons use `hmac.compare_digest`.',
    '`random`/`uuid1` must not generate tokens, nonces or seeds; require `secrets`/`os.urandom`. `pickle`, `marshal`, `yaml.load`, `jsonpickle` on untrusted input are code execution.',
  ],
  scopes_roles: ['Trace `Depends(get_current_user)`/permission dependencies into each handler and confirm the loaded object belongs to the caller (`owner_id == user.id`) before read or mutation, including admin/staff routes and background-job entry points.'],
  abuse_economy: ['Celery/APScheduler/BackgroundTasks: confirm jobs are idempotent under retries, overlapping schedules and multiple workers, and that payouts/settlements use a unique key or conditional state transition.'],
  api_dto_abuse: ['FastAPI: every route should declare `response_model` (or return an explicit schema); flag returning ORM objects, `**row.__dict__`, `.dict()` of internal models, verbose `HTTPException(detail=...)` and debug tracebacks/`DEBUG=True` responses.'],
};
