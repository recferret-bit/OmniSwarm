-- The NEAR AI models a `nearai` review was queued with, snapshotted so a later change to the account's
-- choice does not alter a queued or retried job. NULL for every other preset.
ALTER TABLE request ADD COLUMN models text[];
