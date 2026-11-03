-- Guard reports (INTAKE section 4, POST /api/guard/reports): a signed-in account reports a NEAR account
-- with evidence; the owner reviews it on the admin listener; an approved report is sent on chain as
-- `report_address` by a worker. pending -> approved -> reported, or pending -> rejected.
-- (Version 002 was the mock chain's tables, now a migration set of their own.)

CREATE TABLE guard_report (
  id uuid PRIMARY KEY,
  account text NOT NULL CHECK (account ~ '^[a-z0-9._-]{2,64}$'),
  reporter text NOT NULL,
  -- The registry's report_address limits (contracts/review-registry/INTERFACE.md v0.3.0).
  evidence_url text NOT NULL CHECK (evidence_url ~ '^https://[!-~]+$' AND octet_length(evidence_url) <= 2000),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 280),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'reported', 'rejected')),
  report_tx text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  reported_at timestamptz
);
-- One open report per reporter and account: a resubmission returns the open one.
CREATE UNIQUE INDEX guard_report_open_idx ON guard_report (reporter, account) WHERE status = 'pending';
CREATE INDEX guard_report_status_idx ON guard_report (status, created_at);
