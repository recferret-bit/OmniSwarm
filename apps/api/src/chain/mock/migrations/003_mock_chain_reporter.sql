-- report_address records the predecessor (the operator) as the report's reporter.
ALTER TABLE mock_chain_report ADD COLUMN IF NOT EXISTS reporter text NOT NULL DEFAULT 'operator.mock';
