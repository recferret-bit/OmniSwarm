-- Local operator history. These rows are not paid requests and never enter the review queue.

CREATE TABLE operator_job (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('path', 'github')),
  source text NOT NULL,
  ref text,
  commit_sha text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  out_dir text,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX operator_job_created_idx ON operator_job (created_at DESC);
