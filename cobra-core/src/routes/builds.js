const express = require("express");
const { evaluateGateSettings } = require("../gateSettings");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const GATE_STATUSES = new Set(["passed", "failed", "no_data"]);

function getGateStatus({ totalChanged, totalUntested, coverageRunCount }) {
  if (totalChanged === 0 || coverageRunCount === 0) return "no_data";
  return totalUntested > 0 ? "failed" : "passed";
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function settingRuleFails(key, actualExpression) {
  const setting = `gate_settings->'${key}'`;
  const comparison = `CASE ${setting}->>'comparator'
    WHEN '>=' THEN ROUND(${actualExpression}, 2) >= (${setting}->>'threshold')::numeric
    WHEN '>' THEN ROUND(${actualExpression}, 2) > (${setting}->>'threshold')::numeric
    WHEN '<=' THEN ROUND(${actualExpression}, 2) <= (${setting}->>'threshold')::numeric
    WHEN '<' THEN ROUND(${actualExpression}, 2) < (${setting}->>'threshold')::numeric
    WHEN '=' THEN ROUND(${actualExpression}, 2) = (${setting}->>'threshold')::numeric
    ELSE false
  END`;
  return `(COALESCE((${setting}->>'enabled')::boolean, false)
    AND NOT COALESCE((${comparison}), false))`;
}

function buildListQuery({ app, branch, gateStatus, search, limit, offset }) {
  const values = [];
  const conditions = [];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (app) conditions.push(`repo = ${addValue(app)}`);
  if (branch) conditions.push(`COALESCE(branch, '') = ${addValue(branch)}`);
  if (gateStatus) conditions.push(`gate_status = ${addValue(gateStatus)}`);
  if (search) {
    const searchParameter = addValue(`%${search}%`);
    conditions.push(`(build_id ILIKE ${searchParameter} OR repo ILIKE ${searchParameter} OR commit_sha ILIKE ${searchParameter})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParameter = addValue(limit);
  const offsetParameter = addValue(offset);

  return {
    text: `WITH changed_function_coverage AS (
             SELECT cf.id, cf.build_id,
                    CASE WHEN COALESCE(SUM(cr.hits), 0) = 0 THEN 1 ELSE 0 END AS is_untested
             FROM changed_functions cf
             LEFT JOIN coverage_runs cr
               ON cr.build_id = cf.build_id
              AND cr.file = cf.file
              AND cr.function = cf.function
             GROUP BY cf.id, cf.build_id
           ),
           change_totals AS (
             SELECT build_id, COUNT(*)::int AS total_changed,
                    SUM(is_untested)::int AS total_untested
             FROM changed_function_coverage
             GROUP BY build_id
           ),
           coverage_pairs AS (
             SELECT build_id, file, function, SUM(hits) AS hits
             FROM coverage_runs
             GROUP BY build_id, file, function
           ),
           repo_coverage_pairs AS (
             SELECT b.repo, cr.file, cr.function, SUM(cr.hits) AS hits
             FROM coverage_runs cr
             JOIN builds b ON b.build_id = cr.build_id
             GROUP BY b.repo, cr.file, cr.function
           ),
           repo_coverage_totals AS (
             SELECT repo, COUNT(*)::int AS total_functions,
                    COUNT(*) FILTER (WHERE hits > 0)::int AS covered_functions
             FROM repo_coverage_pairs
             GROUP BY repo
           ),
           coverage_totals AS (
             SELECT build_id, COUNT(*)::int AS total_functions,
                    COUNT(*) FILTER (WHERE hits > 0)::int AS covered_functions
             FROM coverage_pairs
             GROUP BY build_id
           ),
           ordered_builds AS (
             SELECT b.*,
                    LAG(b.build_id) OVER (PARTITION BY b.repo, COALESCE(b.branch, '') ORDER BY b.created_at, b.build_id) AS reference_build_id,
                    LAG(b.created_at) OVER (PARTITION BY b.repo, COALESCE(b.branch, '') ORDER BY b.created_at, b.build_id) AS reference_created_at
             FROM builds b
           ),
           raw_summaries AS (
             SELECT ob.build_id, ob.repo, ob.branch, ob.commit_sha, ob.language, ob.created_at,
                    ob.reference_build_id, ob.reference_created_at,
                    COALESCE(ct.total_changed, 0)::int AS total_changed,
                    COALESCE(ct.total_untested, 0)::int AS total_untested,
                    COALESCE(covt.total_functions, 0)::int AS total_coverage_functions,
                    COALESCE(covt.covered_functions, 0)::int AS covered_functions,
                    COALESCE(rct.total_functions, 0)::int AS repo_total_coverage_functions,
                    COALESCE(rct.covered_functions, 0)::int AS repo_covered_functions,
                    (SELECT COUNT(*)::int FROM coverage_runs cr WHERE cr.build_id = ob.build_id) AS coverage_run_count,
                    gate_settings.settings AS gate_settings,
                    CASE
                      WHEN COALESCE(ct.total_changed, 0) = 0
                        OR NOT EXISTS (SELECT 1 FROM coverage_runs cr WHERE cr.build_id = ob.build_id)
                        THEN 'no_data'
                      WHEN COALESCE(ct.total_untested, 0) > 0 THEN 'failed'
                      ELSE 'passed'
                    END AS base_gate_status
             FROM ordered_builds ob
             LEFT JOIN change_totals ct ON ct.build_id = ob.build_id
             LEFT JOIN coverage_totals covt ON covt.build_id = ob.build_id
             LEFT JOIN repo_coverage_totals rct ON rct.repo = ob.repo
             LEFT JOIN LATERAL (
               SELECT qgs.settings
               FROM quality_gate_settings qgs
               WHERE qgs.app = ob.repo
                 AND qgs.branch = COALESCE(ob.branch, '')
                 AND qgs.effective_at <= ob.created_at
               ORDER BY qgs.effective_at DESC, qgs.id DESC
               LIMIT 1
             ) gate_settings ON true
           ),
           summaries AS (
             SELECT raw_summaries.*,
                    CASE
                      WHEN base_gate_status = 'no_data' THEN 'no_data'
                      WHEN COALESCE((gate_settings->'codeChangesCoverage'->>'enabled')::boolean, false)
                        OR COALESCE((gate_settings->'overallCoverage'->>'enabled')::boolean, false)
                        OR COALESCE((gate_settings->'failedTests'->>'enabled')::boolean, false)
                      THEN CASE
                        WHEN ${settingRuleFails("codeChangesCoverage", "((total_changed - total_untested)::numeric * 100 / NULLIF(total_changed, 0))")}
                          OR ${settingRuleFails("overallCoverage", "(repo_covered_functions::numeric * 100 / NULLIF(repo_total_coverage_functions, 0))")}
                          OR COALESCE((gate_settings->'failedTests'->>'enabled')::boolean, false)
                        THEN 'failed'
                        ELSE 'passed'
                      END
                      ELSE base_gate_status
                    END AS gate_status
             FROM raw_summaries
           ),
           filtered AS (
             SELECT * FROM summaries ${where}
           )
           SELECT filtered.*,
                  reference.commit_sha AS reference_commit_sha,
                  (SELECT COUNT(*)::int FROM filtered) AS total_count
           FROM filtered
           LEFT JOIN builds reference ON reference.build_id = filtered.reference_build_id
           ORDER BY filtered.created_at DESC, filtered.build_id DESC
           LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    values,
  };
}

module.exports = function createBuildsRouter(pool) {
  const router = express.Router();

  router.get("/builds", async (req, res) => {
    const app = typeof req.query.app === "string" ? req.query.app.trim() : "";
    const branch = typeof req.query.branch === "string" ? req.query.branch.trim() : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const gateStatus = typeof req.query.gateStatus === "string" ? req.query.gateStatus.trim().toLowerCase() : "";

    if (req.query.branch !== undefined && typeof req.query.branch !== "string") {
      return res.status(400).json({ error: "branch must be a string" });
    }
    if (gateStatus && !GATE_STATUSES.has(gateStatus)) {
      return res.status(400).json({ error: "gateStatus must be passed, failed, or no_data" });
    }

    const page = positiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = positiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const query = buildListQuery({ app, branch, gateStatus, search, limit, offset: (page - 1) * limit });

    try {
      const [result, appsResult, branchesResult] = await Promise.all([
        pool.query(query.text, query.values),
        pool.query("SELECT DISTINCT repo FROM builds ORDER BY repo"),
        pool.query("SELECT DISTINCT branch FROM builds WHERE branch IS NOT NULL AND branch <> '' ORDER BY branch"),
      ]);
      const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
      const builds = result.rows.map((row) => {
        const totalChanged = Number(row.total_changed);
        const totalUntested = Number(row.total_untested);
        const coverageRunCount = Number(row.coverage_run_count);
        const overallCoverage = Number(row.total_coverage_functions) === 0
          ? null
          : Math.round((Number(row.covered_functions) / Number(row.total_coverage_functions)) * 10000) / 100;
        const codeChangesCoverage = totalChanged === 0
          ? null
          : Math.round(((totalChanged - totalUntested) / totalChanged) * 10000) / 100;
        const repoCoverageTotal = Number(row.repo_total_coverage_functions);
        const repoOverallCoverage = !Number.isFinite(repoCoverageTotal)
          ? overallCoverage
          : repoCoverageTotal === 0
            ? null
            : Math.round(
                (Number(row.repo_covered_functions) / repoCoverageTotal) * 10000
              ) / 100;
        const configuredGate = evaluateGateSettings({
          settings: row.gate_settings,
          totalChanged,
          coverageRunCount,
          metrics: {
            code_changes_coverage: codeChangesCoverage,
            overall_coverage: repoOverallCoverage,
            failed_tests: null,
          },
        });
        const gateStatus = configuredGate?.status || getGateStatus({
          totalChanged,
          totalUntested,
          coverageRunCount,
        });

        return {
          buildId: row.build_id,
          repo: row.repo,
          branch: row.branch || null,
          commitSha: row.commit_sha,
          language: row.language,
          createdAt: row.created_at,
          referenceBuild: row.reference_build_id
            ? {
                buildId: row.reference_build_id,
                commitSha: row.reference_commit_sha,
                createdAt: row.reference_created_at,
              }
            : null,
          totalChangedFunctions: totalChanged,
          untestedChangedFunctions: totalUntested,
          overallCoverage,
          codeChangesCoverage,
          hasCoverageRun: coverageRunCount > 0,
          gateStatus,
        };
      });

      res.json({
        builds,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        filters: {
          apps: appsResult.rows.map((row) => row.repo).filter(Boolean),
          branches: branchesResult.rows.map((row) => row.branch).filter(Boolean),
        },
        dataAvailability: {
          branch: true,
          referenceBuild: "previous recorded build for the same app; the actual baseline ref is not persisted",
          testStages: false,
          testDuration: false,
          failedAndSkippedTests: false,
        },
      });
    } catch (err) {
      console.error("GET /builds failed:", err);
      res.status(500).json({ error: "Failed to list builds" });
    }
  });

  router.get("/builds/:buildId/stages", async (req, res) => {
    const { buildId } = req.params;
    try {
      const result = await pool.query(
        `WITH test_functions AS (
           SELECT cr.test_id, cr.file, cr.function,
                  SUM(cr.hits)::int AS hits, MAX(cr.created_at) AS last_calculated
           FROM coverage_runs cr
           WHERE cr.build_id = $1
           GROUP BY cr.test_id, cr.file, cr.function
         )
         SELECT tf.test_id, MAX(tf.last_calculated) AS last_calculated,
                COUNT(*)::int AS total_functions,
                COUNT(*) FILTER (WHERE tf.hits > 0)::int AS covered_functions,
                COUNT(*) FILTER (
                  WHERE EXISTS (
                    SELECT 1 FROM changed_functions cf
                    WHERE cf.build_id = $1 AND cf.file = tf.file AND cf.function = tf.function
                  )
                )::int AS changed_functions,
                COUNT(*) FILTER (
                  WHERE tf.hits = 0 AND EXISTS (
                    SELECT 1 FROM changed_functions cf
                    WHERE cf.build_id = $1 AND cf.file = tf.file AND cf.function = tf.function
                  )
                )::int AS untested_changed_functions
         FROM test_functions tf
         GROUP BY tf.test_id
         ORDER BY MAX(tf.last_calculated) DESC, tf.test_id`,
        [buildId]
      );

      const stages = result.rows.map((row) => ({
        stage: "Unassigned",
        testId: row.test_id,
        lastCalculated: row.last_calculated,
        durationSeconds: null,
        tests: 1,
        failed: null,
        skipped: null,
        overallCoverage:
          Number(row.total_functions) === 0
            ? null
            : Math.round((Number(row.covered_functions) / Number(row.total_functions)) * 10000) / 100,
        codeChangesCoverage:
          Number(row.changed_functions) === 0
            ? null
            : Math.round(
                ((Number(row.changed_functions) - Number(row.untested_changed_functions)) /
                  Number(row.changed_functions)) *
                  10000
              ) / 100,
        untestedChangedFunctions: Number(row.untested_changed_functions),
      }));

      res.json({
        buildId,
        stages,
        dataAvailability: { namedStages: false, duration: false, failedAndSkippedTests: false },
      });
    } catch (err) {
      console.error(`GET /builds/${buildId}/stages failed:`, err);
      res.status(500).json({ error: "Failed to list build test coverage" });
    }
  });

  return router;
};

module.exports.getGateStatus = getGateStatus;
