-- The engine's live progress snapshot (phases, reviewer passes and calls, debate counts), as the worker read it.
-- Display only. Shape: intake-api.schema.json#/$defs/progress-detail.
ALTER TABLE request_progress ADD COLUMN detail jsonb;
