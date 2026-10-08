const express = require("express");
const { loadHistoricalCoverage } = require("./historicalTestSelectionData");

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

      const { rows: selectedRows, branchStrategy } = await loadHistoricalCoverage(pool, buildId, build);
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
        branchStrategy,
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

  router.get("/test-gaps/:buildId", async (req, res) => {
    const { buildId } = req.params;
    try {
      const buildResult = await pool.query(
        `SELECT build_id, repo, branch, language, created_at
         FROM builds
         WHERE build_id = $1`,
        [buildId],
      );
      if (buildResult.rows.length === 0) {
        return res.status(404).json({ error: "Build not found" });
      }

      const build = buildResult.rows[0];
      const changedResult = await pool.query(
        `SELECT file, function, status, start_line, end_line, author
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
          if (current.deleted && row.status !== "deleted") {
            Object.assign(current, {
              file: row.file,
              function: row.function,
              status: row.status,
              startLine: row.start_line ?? null,
              endLine: row.end_line ?? null,
              author: row.author ?? null,
              deleted: false,
            });
          } else {
            current.deleted = current.deleted && row.status === "deleted";
          }
        } else {
          changedFunctions.set(key, {
            file: row.file,
            function: row.function,
            status: row.status,
            startLine: row.start_line ?? null,
            endLine: row.end_line ?? null,
            author: row.author ?? null,
            deleted: row.status === "deleted",
          });
        }
      }

      const { rows: historicalRows, branchStrategy } =
        await loadHistoricalCoverage(pool, buildId, build);
      const coveredFunctionKeys = new Set(
        historicalRows.map((row) => functionKey(row.file, row.function)),
      );
      const gaps = [...changedFunctions.entries()]
        .filter(([key, changedFunction]) =>
          !changedFunction.deleted && !coveredFunctionKeys.has(key))
        .map(([, changedFunction]) => ({
          file: changedFunction.file,
          function: changedFunction.function,
          status: changedFunction.status,
          startLine: changedFunction.startLine,
          endLine: changedFunction.endLine,
          author: changedFunction.author,
          reason: "no_historical_coverage",
        }));
      const deletedFunctions = [...changedFunctions.values()]
        .filter((changedFunction) => changedFunction.deleted).length;

      res.json({
        buildId: build.build_id,
        repo: build.repo,
        branch: build.branch || null,
        language: build.language,
        branchStrategy,
        gaps,
        summary: {
          changedFunctions: changedFunctions.size,
          coveredChangedFunctions: [...changedFunctions.entries()].filter(
            ([key, changedFunction]) =>
              !changedFunction.deleted && coveredFunctionKeys.has(key),
          ).length,
          gaps: gaps.length,
          deletedFunctions,
        },
      });
    } catch (err) {
      console.error(`GET /test-gaps/${buildId} failed:`, err);
      res.status(500).json({ error: "Failed to analyze historical test gaps" });
    }
  });

  return router;
};
