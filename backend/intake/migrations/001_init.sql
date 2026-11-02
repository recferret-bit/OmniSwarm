CREATE TABLE IF NOT EXISTS nonce (
  nonce text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip text NOT NULL
);

CREATE TABLE IF NOT EXISTS request (
  id uuid PRIMARY KEY,
  account text NOT NULL,
  repo text NOT NULL,
  commit_sha text NOT NULL,
  network text NOT NULL,
  preset text NOT NULL,
  deployed text,
  request_hash text UNIQUE NOT NULL,
  price_yocto text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS payment (
  tx_hash text PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES request(id),
  amount_yocto text NOT NULL,
  signer text NOT NULL,
  verified_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS request_progress (
  request_id uuid NOT NULL,
  ts timestamptz NOT NULL,
  phase text NOT NULL,
  reviewer text,
  pass int,
  percent numeric,
  message text
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  actor text NOT NULL,
  request_id uuid,
  event text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS job_stub (
  request_id uuid PRIMARY KEY,
  request_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_key (
  account text NOT NULL,
  public_key text PRIMARY KEY,
  permission text NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_request (
  request_hash text PRIMARY KEY,
  account text NOT NULL,
  deposit text NOT NULL,
  status text NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_tx (
  tx_hash text PRIMARY KEY,
  request_hash text NOT NULL,
  signer text NOT NULL,
  receiver text NOT NULL,
  amount_yocto text NOT NULL,
  success boolean NOT NULL
);
