CREATE TABLE IF NOT EXISTS mock_attestation (
  request_hash text PRIMARY KEY,
  report_sha256 text NOT NULL,
  tx text NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_refund (
  request_hash text PRIMARY KEY,
  tx text NOT NULL
);
