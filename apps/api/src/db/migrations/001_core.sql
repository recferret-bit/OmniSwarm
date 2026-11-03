-- Core intake tables (INTAKE sections 3-5). Money is numeric(40,0) yocto; hashes are lowercase hex.

CREATE TABLE nonce (
  nonce text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip text NOT NULL
);
CREATE INDEX nonce_expires_idx ON nonce (expires_at);

CREATE TABLE request (
  id uuid PRIMARY KEY,
  account text NOT NULL,
  repo text NOT NULL CHECK (repo ~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  network text NOT NULL CHECK (network IN ('testnet', 'mainnet')),
  preset text NOT NULL CHECK (preset ~ '^[a-z0-9-]{1,40}$'),
  deployed text,
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  price_yocto numeric(40, 0) NOT NULL CHECK (price_yocto >= 0),
  status text NOT NULL CHECK (status IN ('awaiting_payment', 'queued', 'running', 'publishing', 'done', 'failed', 'refunded', 'expired')),
  attempts int NOT NULL DEFAULT 0,
  failure_cause text,
  report_sha256 text CHECK (report_sha256 ~ '^[0-9a-f]{64}$'),
  report_url text,
  max_severity text,
  incomplete boolean,
  attest_tx text,
  refund_tx text,
  queued_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX request_status_queued_idx ON request (status, queued_at, id);
CREATE INDEX request_account_created_idx ON request (account, created_at);

CREATE TABLE payment (
  tx_hash text PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES request (id),
  amount_yocto numeric(40, 0) NOT NULL,
  signer text NOT NULL,
  verified_at timestamptz NOT NULL
);

CREATE TABLE request_progress (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES request (id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  phase text NOT NULL,
  reviewer text,
  pass int CHECK (pass >= 1),
  percent real NOT NULL CHECK (percent >= 0 AND percent <= 100),
  message text
);
CREATE INDEX request_progress_request_idx ON request_progress (request_id, id);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  actor text NOT NULL,
  request_id uuid,
  event text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_request_idx ON audit_log (request_id, id);

-- Shared fixed-window counters for @fastify/rate-limit, so every API replica sees one budget.
CREATE TABLE rate_limit (
  key text PRIMARY KEY,
  count int NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limit_reset_idx ON rate_limit (reset_at);
