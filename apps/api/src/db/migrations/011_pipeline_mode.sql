-- Iterative step-by-step pipeline mode and follow-up debate round count.
ALTER TABLE request
  ADD COLUMN pipeline_mode text NOT NULL DEFAULT 'full'
    CHECK (pipeline_mode IN ('full', 'step-by-step', 'stage-1')),
  ADD COLUMN debate_rounds integer;

ALTER TABLE operator_job
  ADD COLUMN pipeline_mode text NOT NULL DEFAULT 'full'
    CHECK (pipeline_mode IN ('full', 'step-by-step', 'stage-1'));
