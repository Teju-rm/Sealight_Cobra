CREATE TABLE IF NOT EXISTS test_runs (
  id           TEXT PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  branch       TEXT,
  suite        TEXT NOT NULL,
  environment  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_test_runs_build_started ON test_runs(build_id, started_at DESC);

ALTER TABLE test_executions
  ADD COLUMN IF NOT EXISTS run_id TEXT
  REFERENCES test_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_executions_run ON test_executions(run_id);
