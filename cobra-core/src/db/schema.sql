CREATE TABLE IF NOT EXISTS builds (
  build_id     TEXT PRIMARY KEY,
  repo         TEXT NOT NULL,
  branch       TEXT,
  commit_sha   TEXT NOT NULL,
  language     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE builds ADD COLUMN IF NOT EXISTS branch TEXT;

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

CREATE TABLE IF NOT EXISTS test_executions (
  id           TEXT PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES test_runs(id) ON DELETE SET NULL,
  test_id      TEXT NOT NULL,
  suite        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'timedOut', 'skipped', 'interrupted')),
  duration_ms  BIGINT NOT NULL CHECK (duration_ms >= 0),
  executed_at  TIMESTAMPTZ NOT NULL,
  environment  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE test_executions ADD COLUMN IF NOT EXISTS run_id TEXT REFERENCES test_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_test_executions_build ON test_executions(build_id);
CREATE INDEX IF NOT EXISTS idx_test_executions_test_time ON test_executions(test_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_executions_run ON test_executions(run_id);

CREATE TABLE IF NOT EXISTS changed_functions (
  id           SERIAL PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  file         TEXT NOT NULL,
  function     TEXT NOT NULL,
  start_line   INTEGER,
  end_line     INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('new', 'modified', 'unchanged', 'deleted')),
  author       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coverage_runs (
  id           SERIAL PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  execution_id TEXT REFERENCES test_executions(id) ON DELETE SET NULL,
  test_id      TEXT NOT NULL,
  language     TEXT NOT NULL,
  file         TEXT NOT NULL,
  function     TEXT NOT NULL,
  start_line   INTEGER,
  end_line     INTEGER,
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changed_functions_build ON changed_functions(build_id);
CREATE INDEX IF NOT EXISTS idx_coverage_runs_build ON coverage_runs(build_id);
CREATE INDEX IF NOT EXISTS idx_coverage_runs_file_fn ON coverage_runs(build_id, file, function);
CREATE INDEX IF NOT EXISTS idx_coverage_runs_execution ON coverage_runs(execution_id);

CREATE TABLE IF NOT EXISTS quality_gate_settings (
  id           BIGSERIAL PRIMARY KEY,
  app          TEXT NOT NULL,
  branch       TEXT NOT NULL DEFAULT '',
  settings     JSONB NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_gate_settings_scope_effective
ON quality_gate_settings (app, branch, effective_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS quality_gate_rules (
  id         SERIAL PRIMARY KEY,
  repo       TEXT NOT NULL,
  metric     TEXT NOT NULL,
  operator   TEXT NOT NULL,
  threshold  NUMERIC NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_gate_rules_repo_enabled
ON quality_gate_rules (repo, enabled);
