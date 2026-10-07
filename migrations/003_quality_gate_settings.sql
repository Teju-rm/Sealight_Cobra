CREATE TABLE IF NOT EXISTS quality_gate_settings (
  id           BIGSERIAL PRIMARY KEY,
  app          TEXT NOT NULL,
  branch       TEXT NOT NULL DEFAULT '',
  settings     JSONB NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_gate_settings_scope_effective
ON quality_gate_settings (app, branch, effective_at DESC, id DESC);
