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
const { evaluateGateSettings, hasEnabledSettings } = require('../gateSettings');

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
//   - No changed functions or no coverage rows -> "no_data".
//   - No enabled rules for repo    -> fallback to legacy behavior:
//     pass only if there are zero untested changes.
//   - Rules exist                  -> every enabled, evaluable rule must
//     pass. A rule referencing an unsupported metric is skipped, not
//     treated as a free pass.
function evaluateVerdict({ totalChanged, coverageRunCount, untestedCount, metrics, rules }) {
  if (totalChanged === 0 || coverageRunCount === 0) {
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

function contributorInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] || "")
    .join("")
    .toUpperCase();
}

function groupFileRisks(changes, search) {
  const matching = search
    ? changes.filter((change) => `${change.file} ${change.function}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    : changes;
  const files = new Map();

  for (const change of matching) {
    if (!files.has(change.file)) {
      files.set(change.file, {
        file: change.file,
        qualityRisks: 0,
        highPriority: 0,
        contributorsByName: new Map(),
        methods: [],
      });
    }
    const file = files.get(change.file);
    file.qualityRisks += 1;
    if (change.status === "new" || change.status === "modified") file.highPriority += 1;
    if (change.author) file.contributorsByName.set(change.author, contributorInitials(change.author));
    file.methods.push({
      name: change.function || "(Anonymous)",
      line: change.startLine,
      status: change.status,
      author: change.author,
    });
  }

  return Array.from(files.values())
    .map(({ contributorsByName, ...file }) => ({
      ...file,
      contributors: Array.from(contributorsByName, ([name, initials]) => ({ name, initials })),
    }))
    .sort((left, right) => right.qualityRisks - left.qualityRisks || left.file.localeCompare(right.file))
    .map((file) => ({
      ...file,
      methods: file.methods.sort((left, right) =>
        (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name)
      ),
    }));
}

function createRiskRouter(pool) {
  const router = express.Router();

  router.get('/risk/:buildId', async (req, res) => {
    const { buildId } = req.params;
    const stage = typeof req.query.stage === "string" ? req.query.stage.trim().toLowerCase() : "all";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : "";
    if (stage && stage !== "all") {
      return res.status(400).json({ error: "Only the all-stages view is available because named test stages are not stored" });
    }
    if (req.query.stage !== undefined && typeof req.query.stage !== "string") {
      return res.status(400).json({ error: "stage must be a string" });
    }
    if (req.query.search !== undefined && typeof req.query.search !== "string") {
      return res.status(400).json({ error: "search must be a string" });
    }

    try {
      // 0. Resolve the build's repo — needed for both rule lookup and
      //    overallCoverage, which is scoped per-repo, not per-build, and
      //    quality-gate settings, which are scoped to the build's branch.
      const buildResult = await pool.query(
        `SELECT b.repo, b.branch, b.created_at,
                (
                  SELECT previous.build_id
                  FROM builds previous
                  WHERE previous.repo = b.repo
                    AND (previous.created_at, previous.build_id) < (b.created_at, b.build_id)
                  ORDER BY previous.created_at DESC, previous.build_id DESC
                  LIMIT 1
                ) AS reference_build_id,
                (
                  SELECT previous.commit_sha
                  FROM builds previous
                  WHERE previous.repo = b.repo
                    AND (previous.created_at, previous.build_id) < (b.created_at, b.build_id)
                  ORDER BY previous.created_at DESC, previous.build_id DESC
                  LIMIT 1
                ) AS reference_commit_sha,
                (
                  SELECT previous.created_at
                  FROM builds previous
                  WHERE previous.repo = b.repo
                    AND (previous.created_at, previous.build_id) < (b.created_at, b.build_id)
                  ORDER BY previous.created_at DESC, previous.build_id DESC
                  LIMIT 1
                ) AS reference_created_at
         FROM builds b
         WHERE b.build_id = $1`,
        [buildId]
      );
      const build = buildResult.rows[0];
      const repo = build ? build.repo : null;
      const branch = build?.branch || "";

      // 1. Untested changes: a changed_functions row is "untested" when the
      //    total hits across all matching coverage_runs rows is 0 — either
      //    because no coverage_runs row exists at all, or because one exists
      //    with hits = 0 (e.g. V8 precise coverage records every loaded
      //    function, called or not).
      const untestedResult = await pool.query(
        `SELECT cf.file, cf.function, cf.status, cf.start_line, cf.author
         FROM changed_functions cf
         LEFT JOIN coverage_runs cr
           ON cr.build_id = cf.build_id
          AND cr.file = cf.file
          AND cr.function = cf.function
         WHERE cf.build_id = $1
         GROUP BY cf.file, cf.function, cf.status, cf.start_line, cf.author
         HAVING COALESCE(SUM(cr.hits), 0) = 0`,
        [buildId]
      );

      const untestedChanges = untestedResult.rows.map((row) => ({
        file: row.file,
        function: row.function,
        status: row.status,
        startLine: row.start_line ?? null,
        author: row.author ?? null,
      }));
      const fileGroups = groupFileRisks(untestedChanges, search);
      const highPriorityCount = untestedChanges.filter(
        (change) => change.status === "new" || change.status === "modified"
      ).length;

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
        `SELECT COUNT(*)::int AS total,
                (SELECT COUNT(*)::int FROM coverage_runs WHERE build_id = $1) AS coverage_run_count
         FROM changed_functions
         WHERE build_id = $1`,
        [buildId]
      );
      const totalChanged = totalResult.rows[0].total;
      const coverageRunCount = Number.isFinite(Number(totalResult.rows[0].coverage_run_count))
        ? Number(totalResult.rows[0].coverage_run_count)
        : undefined;
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
      let settings = null;
      if (repo && build?.created_at) {
        const settingsResult = await pool.query(
          `SELECT settings
           FROM quality_gate_settings
           WHERE app = $1 AND (branch = $2 OR branch = '')
             AND effective_at <= $3
           ORDER BY CASE WHEN branch = $2 THEN 0 ELSE 1 END,
                    effective_at DESC, id DESC
           LIMIT 1`,
          [repo, branch, build.created_at]
        );
        settings = settingsResult.rows[0]?.settings || null;
      }

      let rules = [];
      if (repo && !hasEnabledSettings(settings)) {
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
        failed_tests: null,
      };

      const configuredGate = evaluateGateSettings({
        settings,
        totalChanged,
        coverageRunCount,
        metrics,
      });
      const { verdict, skippedRules } = configuredGate
        ? {
            verdict: configuredGate.status === 'passed'
              ? 'pass'
              : configuredGate.status === 'no_data'
                ? 'no_data'
                : 'fail',
            skippedRules: configuredGate.unavailableConditions.map((condition) => ({
              metric: condition,
              reason: 'required data is not available',
            })),
          }
        : evaluateVerdict({
        totalChanged,
        coverageRunCount,
        untestedCount: untestedChanges.length,
        metrics,
        rules,
      });

      const response = {
        buildId,
        build: build
          ? {
              app: repo,
              branch: build.branch || null,
              createdAt: build.created_at,
              referenceBuild: build.reference_build_id
                ? {
                    buildId: build.reference_build_id,
                    commitSha: build.reference_commit_sha,
                    createdAt: build.reference_created_at,
                  }
                : null,
            }
          : null,
        untestedChanges,
        fileGroups,
        qualityRiskCount: untestedChanges.length,
        highPriorityCount,
        testRecommendations,
        riskScore,
        overallCoverage,
        verdict,
        dataAvailability: { branch: Boolean(build?.branch), namedTestStages: false, contributors: "per-function author when stored" },
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
