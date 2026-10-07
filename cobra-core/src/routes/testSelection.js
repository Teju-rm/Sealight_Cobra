const express = require("express");

function functionKey(file, functionName) {
  return JSON.stringify([file, functionName]);
}

module.exports = function createTestSelectionRouter(pool) {
  const router = express.Router();

  router.get("/test-selection/:buildId", async (req, res) => {
    const { buildId } = req.params;
    try {
      const buildResult = await pool.query(
        `SELECT build_id, repo, branch, created_at
         FROM builds
         WHERE build_id = $1`,
        [buildId],
      );
      if (buildResult.rows.length === 0) {
        return res.status(404).json({ error: "Build not found" });
      }

      const build = buildResult.rows[0];
      const changedResult = await pool.query(
        `SELECT file, function, status
         FROM changed_functions
         WHERE build_id = $1
         ORDER BY file, function`,
        [buildId],
      );
      const changedFunctions = new Map();
      for (const row of changedResult.rows) {
        const key = functionKey(row.file, row.function);
        const current = changedFunctions.get(key);
        if (current) {
          current.deleted = current.deleted && row.status === "deleted";
        } else {
          changedFunctions.set(key, {
            file: row.file,
            function: row.function,
            deleted: row.status === "deleted",
          });
        }
      }

      const historyResult = await pool.query(
        `SELECT cr.test_id, cr.file, cr.function, cr.build_id AS historical_build_id,
                historical.branch AS historical_branch,
                cr.execution_id,
                te.suite AS execution_suite,
                te.status AS execution_status,
                te.duration_ms AS execution_duration_ms,
                te.executed_at AS execution_executed_at,
                te.environment AS execution_environment
         FROM coverage_runs cr
         JOIN builds historical ON historical.build_id = cr.build_id
         JOIN changed_functions cf
           ON cf.build_id = $1
          AND cf.file = cr.file
          AND cf.function = cr.function
          AND cf.status <> 'deleted'
         LEFT JOIN test_executions te ON te.id = cr.execution_id
         WHERE cr.build_id <> $1
           AND historical.repo = $2
           AND historical.created_at < $3
           AND cr.hits > 0`,
        [buildId, build.repo, build.created_at],
      );

      const sameBranchRows = historyResult.rows.filter(
        (row) => row.historical_branch === build.branch,
      );
      const usedFallback = sameBranchRows.length === 0 && historyResult.rows.length > 0;
      const selectedRows = usedFallback ? historyResult.rows : sameBranchRows;
      const selectedTests = new Map();

      for (const row of selectedRows) {
        let selectedTest = selectedTests.get(row.test_id);
        if (!selectedTest) {
          selectedTest = {
            testId: row.test_id,
            coveredFunctions: new Map(),
            historicalBuilds: new Set(),
            executions: new Map(),
          };
          selectedTests.set(row.test_id, selectedTest);
        }
        selectedTest.coveredFunctions.set(functionKey(row.file, row.function), {
          file: row.file,
          function: row.function,
        });
        selectedTest.historicalBuilds.add(row.historical_build_id);
        if (row.execution_id) {
          selectedTest.executions.set(row.execution_id, {
            executionId: row.execution_id,
            suite: row.execution_suite,
            status: row.execution_status,
            durationMs: row.execution_duration_ms === null
              ? null
              : Number(row.execution_duration_ms),
            executedAt: row.execution_executed_at,
            environment: row.execution_environment,
          });
        }
      }

      const coveredFunctionKeys = new Set();
      const selectedTestsResponse = [...selectedTests.values()]
        .sort((left, right) => left.testId.localeCompare(right.testId))
        .map((selectedTest) => {
          for (const key of selectedTest.coveredFunctions.keys()) {
            coveredFunctionKeys.add(key);
          }
          return {
            testId: selectedTest.testId,
            coveredFunctions: [...selectedTest.coveredFunctions.values()],
            historicalBuilds: [...selectedTest.historicalBuilds].sort(),
            executions: [...selectedTest.executions.values()],
          };
        });

      const uncoveredFunctions = [...changedFunctions.entries()]
        .filter(([key, changedFunction]) =>
          changedFunction.deleted || !coveredFunctionKeys.has(key))
        .map(([, changedFunction]) => ({
          file: changedFunction.file,
          function: changedFunction.function,
          reason: changedFunction.deleted ? "deleted_function" : "no_historical_coverage",
        }));

      res.json({
        buildId: build.build_id,
        repo: build.repo,
        branch: build.branch || null,
        branchStrategy: usedFallback ? "cross_branch_fallback" : "same_branch",
        selectedTests: selectedTestsResponse,
        uncoveredFunctions,
        summary: {
          changedFunctions: changedFunctions.size,
          selectedTests: selectedTestsResponse.length,
          coveredFunctions: coveredFunctionKeys.size,
          uncoveredFunctions: uncoveredFunctions.length,
        },
      });
    } catch (err) {
      console.error(`GET /test-selection/${buildId} failed:`, err);
      res.status(500).json({ error: "Failed to select tests from historical coverage" });
    }
  });

  return router;
};
