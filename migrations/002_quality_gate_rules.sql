-- 002_quality_gate_rules.sql

-- Configurable per-repo quality gate thresholds. When at least one enabled
-- rule exists for a repo, GET /risk/:buildId evaluates all of them instead
-- of the legacy "any untested change = fail" behavior. See risk.js for the
-- supported metric names (code_changes_coverage, overall_coverage).

CREATE TABLE quality_gate_rules (
id         SERIAL PRIMARY KEY,
repo       TEXT NOT NULL,
metric     TEXT NOT NULL,        -- e.g. 'code_changes_coverage', 'overall_coverage'
operator   TEXT NOT NULL,        -- one of: >=, <=, >, <, =
threshold  NUMERIC NOT NULL,
enabled    BOOLEAN NOT NULL DEFAULT true,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_gate_rules_repo_enabled
ON quality_gate_rules (repo, enabled);