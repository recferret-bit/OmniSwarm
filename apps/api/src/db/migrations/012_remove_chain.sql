-- OmniSwarm no longer has a NEAR chain integration: no payments, refunds, attestations, abuse reports or
-- guard. Reviews are free on the account's own provider key. This drops what only those features used.
-- Older migrations stay as they are (their ledger rows must keep matching).

-- Requests that never ran or were returned to the user have no valid status any more. They become `failed`
-- (with the old status as the cause) BEFORE the status constraint changes.
UPDATE request
SET failure_cause = coalesce(failure_cause, 'migrated_from_' || status),
    status = 'failed'
WHERE status IN ('awaiting_payment', 'refunded', 'expired');

ALTER TABLE request DROP CONSTRAINT IF EXISTS request_status_check;
ALTER TABLE request ADD CONSTRAINT request_status_check
  CHECK (status IN ('queued', 'running', 'publishing', 'done', 'failed'));

-- Payment ledger, abuse reports and the chain columns of `request` (dropping a column also drops its
-- constraints and indexes: request_network_check, the request_hash unique index).
DROP TABLE IF EXISTS payment CASCADE;
DROP TABLE IF EXISTS guard_report CASCADE;
ALTER TABLE request
  DROP COLUMN IF EXISTS network CASCADE,
  DROP COLUMN IF EXISTS deployed CASCADE,
  DROP COLUMN IF EXISTS request_hash CASCADE,
  DROP COLUMN IF EXISTS price_yocto CASCADE,
  DROP COLUMN IF EXISTS attest_tx CASCADE,
  DROP COLUMN IF EXISTS refund_tx CASCADE;

-- The old mock chain's tables and ledger (a development database may still hold them).
DROP TABLE IF EXISTS mock_chain_migrations CASCADE;
DROP TABLE IF EXISTS mock_chain_key CASCADE;
DROP TABLE IF EXISTS mock_chain_request CASCADE;
DROP TABLE IF EXISTS mock_chain_attestation CASCADE;
DROP TABLE IF EXISTS mock_chain_account CASCADE;
DROP TABLE IF EXISTS mock_chain_event CASCADE;
DROP TABLE IF EXISTS mock_chain_report CASCADE;
DROP TABLE IF EXISTS mock_chain_tx CASCADE;
