-- Tables of the MockChainAdapter (src/chain/mock). Test and local-demo only: the adapter cannot be
-- selected when NODE_ENV=production, so in production these tables stay empty.

CREATE TABLE mock_chain_key (
  account text NOT NULL,
  public_key text NOT NULL,
  permission text NOT NULL CHECK (permission IN ('FullAccess', 'FunctionCall')),
  PRIMARY KEY (account, public_key)
);

CREATE TABLE mock_chain_account (
  account text PRIMARY KEY,
  code_hash text NOT NULL
);

CREATE TABLE mock_chain_request (
  request_hash text PRIMARY KEY,
  account text NOT NULL,
  deposit numeric(40, 0) NOT NULL,
  status text NOT NULL CHECK (status IN ('Pending', 'Running', 'Done', 'Refunded')),
  block_height bigint NOT NULL
);

CREATE TABLE mock_chain_tx (
  tx_hash text PRIMARY KEY,
  signer text NOT NULL,
  receiver text NOT NULL,
  method text NOT NULL,
  args jsonb NOT NULL,
  deposit numeric(40, 0) NOT NULL DEFAULT 0,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mock_chain_attestation (
  request_hash text PRIMARY KEY,
  repo text NOT NULL,
  commit_sha text NOT NULL,
  report_sha256 text NOT NULL,
  report_uri text NOT NULL,
  deployed text,
  code_hash text,
  max_severity text NOT NULL,
  block_height bigint NOT NULL,
  block_timestamp_ms bigint NOT NULL,
  binding_confirmed boolean NOT NULL,
  tx_hash text NOT NULL
);

CREATE TABLE mock_chain_event (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  request_hash text NOT NULL,
  data jsonb NOT NULL,
  ts timestamptz NOT NULL DEFAULT now()
);
