-- The registry's guard blocklist (`report_address`, `is_reported`) on the mock chain.
CREATE TABLE IF NOT EXISTS mock_chain_report (
  account text PRIMARY KEY,
  evidence_uri text NOT NULL,
  reason text NOT NULL,
  tx_hash text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now()
);
