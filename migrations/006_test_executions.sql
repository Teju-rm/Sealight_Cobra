CREATE TABLE IF NOT EXISTS test_executions (
  id           TEXT PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  test_id      TEXT NOT NULL,
  suite        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'timedOut', 'skipped', 'interrupted')),
  duration_ms  BIGINT NOT NULL CHECK (duration_ms >= 0),
  executed_at  TIMESTAMPTZ NOT NULL,
  environment  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_executions_build ON test_executions(build_id);
CREATE INDEX IF NOT EXISTS idx_test_executions_test_time ON test_executions(test_id, executed_at DESC);

ALTER TABLE coverage_runs
  ADD COLUMN IF NOT EXISTS execution_id TEXT
  REFERENCES test_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coverage_runs_execution ON coverage_runs(execution_id);
