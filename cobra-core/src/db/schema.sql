CREATE TABLE IF NOT EXISTS builds (
  build_id     TEXT PRIMARY KEY,
  repo         TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  language     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS changed_functions (
  id           SERIAL PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
  file         TEXT NOT NULL,
  function     TEXT NOT NULL,
  start_line   INTEGER,
  end_line     INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('new', 'modified', 'unchanged', 'deleted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coverage_runs (
  id           SERIAL PRIMARY KEY,
  build_id     TEXT NOT NULL REFERENCES builds(build_id) ON DELETE CASCADE,
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
