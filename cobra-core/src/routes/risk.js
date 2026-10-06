// src/routes/risk.js
//
// Mapping Engine — GET /risk/:buildId
//
// For a given build, returns:
//   - untestedChanges:     changed functions with zero total coverage hits
//   - testRecommendations: tests that already cover at least one changed function
//   - riskScore:           share of changed functions that are untested (0-1, 2dp)
//   - overallCoverage:     % of all (file, function) pairs ever seen in coverage_runs
//                           for this build's repo that have been hit at least once
//   - verdict:             "no_data" | "pass" | "fail" — see evaluateVerdict() below
//
// Does not touch changed_functions / coverage_runs writes — those stay in
// build-scan.js and ingest.js. This route only reads.

const express = require('express');

// Metrics a quality_gate_rules row can reference, computed per request.
// Only metrics with real data behind them are supported. A rule naming an
// unsupported metric is skipped (not silently treated as passing or
// failing) and reported back in `skippedRules`, so a misconfigured rule is
// visible instead of hiding risk.
const SUPPORTED_METRICS = new Set(['code_changes_coverage', 'overall_coverage']);

const OPERATORS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '=': (a, b) => a === b,
  '==': (a, b) => a === b,
};

// Evaluates the pass/fail verdict for a build given its computed metrics
// and whatever enabled quality_gate_rules exist for its repo.
//   - No changed functions at all  -> "no_data" (regardless of rules —
//     there is nothing to have passed or failed yet).
//   - No enabled rules for repo    -> fallback to legacy behavior:
//     pass only if there are zero untested changes.
//   - Rules exist                  -> every enabled, evaluable rule must
//     pass. A rule referencing an unsupported metric is skipped, not
//     treated as a free pass.
function evaluateVerdict({ totalChanged, untestedCount, metrics, rules }) {
  if (totalChanged === 0) {
    return { verdict: 'no_data', skippedRules: [] };
  }

  if (rules.length === 0) {
    return { verdict: untestedCount === 0 ? 'pass' : 'fail', skippedRules: [] };
  }

  const skippedRules = [];
  let allPass = true;

  for (const rule of rules) {
    if (!SUPPORTED_METRICS.has(rule.metric)) {
      skippedRules.push({ metric: rule.metric, reason: 'unsupported metric' });
      continue;
    }
    const compare = OPERATORS[rule.operator];
    if (!compare) {
      skippedRules.push({ metric: rule.metric, reason: `unsupported operator "${rule.operator}"` });
      continue;
    }
    const actual = metrics[rule.metric];
    if (!compare(actual, Number(rule.threshold))) {
      allPass = false;
    }
  }

  return { verdict: allPass ? 'pass' : 'fail', skippedRules };
}

function createRiskRouter(pool) {
  const router = express.Router();

  router.get('/risk/:buildId', async (req, res) => {
    const { buildId } = req.params;

    try {
      // 0. Resolve the build's repo — needed for both rule lookup and
      //    overallCoverage, which is scoped per-repo, not per-build.
      const buildResult = await pool.query(
        `SELECT repo FROM builds WHERE build_id = $1`,
        [buildId]
      );
      const repo = buildResult.rows[0] ? buildResult.rows[0].repo : null;

      // 1. Untested changes: a changed_functions row is "untested" when the
      //    total hits across all matching coverage_runs rows is 0 — either
      //    because no coverage_runs row exists at all, or because one exists
      //    with hits = 0 (e.g. V8 precise coverage records every loaded
      //    function, called or not).
      const untestedResult = await pool.query(
        `SELECT cf.file, cf.function, cf.status, cf.author
         FROM changed_functions cf
         LEFT JOIN coverage_runs cr
           ON cr.build_id = cf.build_id
          AND cr.file = cf.file
          AND cr.function = cf.function
         WHERE cf.build_id = $1
         GROUP BY cf.file, cf.function, cf.status, cf.author
         HAVING COALESCE(SUM(cr.hits), 0) = 0`,
        [buildId]
      );

      const untestedChanges = untestedResult.rows.map((row) => ({
        file: row.file,
        function: row.function,
        status: row.status,
        author: row.author,
      }));

      // 2. Test recommendations: distinct test_id in coverage_runs for this
      //    build whose (file, function) matches a changed_functions row for
      //    this build, grouped by test_id with the changed functions each
      //    test covers.
      const recommendationsResult = await pool.query(
        `SELECT cr.test_id, cf.function
         FROM coverage_runs cr
         JOIN changed_functions cf
           ON cf.build_id = cr.build_id
          AND cf.file = cr.file
          AND cf.function = cr.function
         WHERE cr.build_id = $1
         GROUP BY cr.test_id, cf.function
         HAVING SUM(cr.hits) > 0`,
        [buildId]
      );

      const byTestId = new Map();
      for (const row of recommendationsResult.rows) {
        if (!byTestId.has(row.test_id)) {
          byTestId.set(row.test_id, []);
        }
        byTestId.get(row.test_id).push(row.function);
      }

      const testRecommendations = Array.from(byTestId.entries()).map(
        ([testId, coversChangedFunctions]) => ({
          testId,
          coversChangedFunctions,
        })
      );

      // 3. Risk score + code_changes_coverage (its complement, as a %).
      const totalResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM changed_functions
         WHERE build_id = $1`,
        [buildId]
      );
      const totalChanged = totalResult.rows[0].total;
      const riskScore =
        totalChanged === 0
          ? 0
          : Math.round((untestedChanges.length / totalChanged) * 100) / 100;
      const codeChangesCoverage =
        totalChanged === 0
          ? null
          : Math.round(((totalChanged - untestedChanges.length) / totalChanged) * 10000) / 100;

      // 4. Overall coverage: of every (file, function) pair ever seen in
      //    coverage_runs for this build's repo — across ALL builds, not
      //    just this one — what % has been hit at least once. Scoped by
      //    repo via a join back to builds, since coverage_runs itself has
      //    no repo column.
      let overallCoverage = null;
      if (repo) {
        const overallResult = await pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE total_hits > 0)::int AS covered
           FROM (
             SELECT cr.file, cr.function, SUM(cr.hits) AS total_hits
             FROM coverage_runs cr
             JOIN builds b ON b.build_id = cr.build_id
             WHERE b.repo = $1
             GROUP BY cr.file, cr.function
           ) per_function`,
          [repo]
        );
        const { total, covered } = overallResult.rows[0];
        overallCoverage = total === 0 ? null : Math.round((covered / total) * 10000) / 100;
      }

      // 5. Quality gate verdict: configurable per-repo rules, falling back
      //    to the legacy "any untested change = fail" behavior when no
      //    rules are configured, so existing callers see no change unless
      //    they've opted in by adding rules.
      let rules = [];
      if (repo) {
        const rulesResult = await pool.query(
          `SELECT metric, operator, threshold
           FROM quality_gate_rules
           WHERE repo = $1 AND enabled = true`,
          [repo]
        );
        rules = rulesResult.rows;
      }

      const metrics = {
        code_changes_coverage: codeChangesCoverage,
        overall_coverage: overallCoverage,
      };

      const { verdict, skippedRules } = evaluateVerdict({
        totalChanged,
        untestedCount: untestedChanges.length,
        metrics,
        rules,
      });

      const response = {
        buildId,
        untestedChanges,
        testRecommendations,
        riskScore,
        overallCoverage,
        verdict,
      };
      // Only included when a configured rule couldn't be evaluated, so the
      // normal response shape stays unchanged for repos with no such issue.
      if (skippedRules.length > 0) {
        response.skippedRules = skippedRules;
      }

      res.json(response);
    } catch (err) {
      console.error(`GET /risk/${buildId} failed:`, err);
      res.status(500).json({ error: 'Failed to compute risk for build' });
    }
  });

  return router;
}

module.exports = createRiskRouter;
