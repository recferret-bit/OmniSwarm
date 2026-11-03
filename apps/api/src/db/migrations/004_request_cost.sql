-- Model cost per request (W09-18), summed from every attempt's reviewers/*/usage.json when the request is
-- published or refunded. Read by the public GET /api/ledger.

CREATE TABLE request_cost (
  request_id uuid PRIMARY KEY REFERENCES request (id),
  cost_usd numeric(14, 6) NOT NULL CHECK (cost_usd >= 0),
  reviewers int NOT NULL CHECK (reviewers >= 0),
  recorded_at timestamptz NOT NULL
);
CREATE INDEX payment_verified_idx ON payment (verified_at DESC, request_id);
