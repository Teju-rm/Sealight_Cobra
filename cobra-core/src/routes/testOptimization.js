const express = require("express");
const { loadHistoricalCoverage } = require("./historicalTestSelectionData");
const {
  DURATION_METHOD,
  baselineResponse,
  loadBaselineDurations,
  loadBaselineRun,
} = require("./testOptimizationData");

function functionKey(file, functionName) {
  return JSON.stringify([file, functionName]);
}

function createEmptyDuration() {
  return {
    unit: "ms",
    method: DURATION_METHOD,
    fullSuiteMs: null,
    selectedTestsMs: null,
    potentialTimeSavedMs: null,
    potentialTimeSavedPercent: null,
  };
}

function createEmptyExcludedExecutions() {
  return { skipped: 0, interrupted: 0, invalidDuration: 0 };
}

function summarizeSelection({ changedFunctions, historicalRows, branchStrategy }) {
  const changedByKey = new Map();
  for (const row of changedFunctions) {
    const key = functionKey(row.file, row.function);
    const current = changedByKey.get(key);
    if (current) {
      current.deleted = current.deleted && row.status === "deleted";
    } else {
      changedByKey.set(key, {
        file: row.file,
        function: row.function,
        deleted: row.status === "deleted",
      });
    }
  }

  const selectedById = new Map();
  for (const row of historicalRows) {
    let selectedTest = selectedById.get(row.test_id);
    if (!selectedTest) {
      selectedTest = { testId: row.test_id, coveredFunctions: new Map() };
      selectedById.set(row.test_id, selectedTest);
    }
    const key = functionKey(row.file, row.function);
    selectedTest.coveredFunctions.set(key, { file: row.file, function: row.function });
  }

  const coveredFunctions = new Set();
  const selectedTests = [...selectedById.values()]
    .sort((left, right) => left.testId.localeCompare(right.testId))
    .map((selectedTest) => {
      for (const key of selectedTest.coveredFunctions.keys()) coveredFunctions.add(key);
      return {
        testId: selectedTest.testId,
        coveredFunctions: [...selectedTest.coveredFunctions.values()],
        representativeDurationMs: null,
      };
    });
  const uncoveredFunctions = [...changedByKey.entries()]
    .filter(([key, changedFunction]) =>
      changedFunction.deleted || !coveredFunctions.has(key))
    .map(([, changedFunction]) => ({
      file: changedFunction.file,
      function: changedFunction.function,
      reason: changedFunction.deleted ? "deleted_function" : "no_historical_coverage",
    }));

  return {
    branchStrategy,
    selectedTests,
    selectedTestIds: new Set(selectedTests.map((selectedTest) => selectedTest.testId)),
    uncoveredFunctions,
    changedFunctionCount: changedByKey.size,
  };
}

function makeResponse({
  buildId,
  status,
  reason,
  baseline,
  selection,
  summary,
  excludedExecutions,
  duration,
}) {
  return {
    buildId,
    status,
    ...(reason ? { reason } : {}),
    baseline,
    selection,
    summary,
    excludedExecutions,
    duration,
  };
}

module.exports = function createTestOptimizationRouter(pool) {
  const router = express.Router();

  router.get("/test-selection/:buildId/optimization", async (req, res) => {
    const { buildId } = req.params;
    try {
      const buildResult = await pool.query(
        `SELECT build_id, repo, branch, created_at
         FROM builds
         WHERE build_id = $1`,
        [buildId],
      );
      const build = buildResult.rows[0];
      if (!build) return res.status(404).json({ error: "Build not found" });

      const changedResult = await pool.query(
        `SELECT file, function, status
         FROM changed_functions
         WHERE build_id = $1
         ORDER BY file, function`,
        [buildId],
      );
      const historical = await loadHistoricalCoverage(pool, buildId, build);
      const selectionData = summarizeSelection({
        changedFunctions: changedResult.rows,
        historicalRows: historical.rows,
        branchStrategy: historical.branchStrategy,
      });
      const { baseline } = await loadBaselineRun(pool, build);
      const baselineData = baselineResponse(baseline);
      const selection = {
        branchStrategy: selectionData.branchStrategy,
        selectedTests: selectionData.selectedTests,
        unselectedTests: [],
        missingDurationTests: [],
        uncoveredFunctions: selectionData.uncoveredFunctions,
      };
      const summary = {
        changedFunctions: selectionData.changedFunctionCount,
        selectedTests: selectionData.selectedTests.length,
        unselectedTests: 0,
        missingDurationTestCount: 0,
        uncoveredFunctions: selectionData.uncoveredFunctions.length,
      };
      const excludedExecutions = createEmptyExcludedExecutions();
      let duration = createEmptyDuration();
      let reason = null;
      let representativeDurations = new Map();
      let fullSuiteMs = null;

      if (baseline) {
        const durationData = await loadBaselineDurations(pool, baseline.id);
        representativeDurations = durationData.representativeDurations;
        fullSuiteMs = durationData.fullSuiteMs;
        Object.assign(excludedExecutions, durationData.excludedExecutions);

        for (const selectedTest of selection.selectedTests) {
          if (representativeDurations.has(selectedTest.testId)) {
            selectedTest.representativeDurationMs = representativeDurations.get(selectedTest.testId);
          } else {
            selection.missingDurationTests.push(selectedTest.testId);
          }
        }
        selection.missingDurationTests.sort();
        const unselectedTests = [...representativeDurations.entries()]
          .filter(([testId]) => !selectionData.selectedTestIds.has(testId))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([testId, representativeDurationMs]) => ({
            testId,
            representativeDurationMs,
            reason: "no_selected_changed_function_coverage",
          }));
        selection.unselectedTests = unselectedTests;
        summary.unselectedTests = unselectedTests.length;
        summary.missingDurationTestCount = selection.missingDurationTests.length;
      }

      if (!baseline) {
        reason = "no_completed_baseline_run";
      } else if (representativeDurations.size === 0) {
        reason = "no_eligible_execution_data";
      } else if (!Number.isFinite(fullSuiteMs)
          || fullSuiteMs <= 0
          || fullSuiteMs > Number.MAX_SAFE_INTEGER) {
        reason = "invalid_full_suite_duration";
      } else if (selectionData.changedFunctionCount === 0) {
        reason = "no_changed_functions";
      } else if (selectionData.selectedTestIds.size === 0) {
        reason = "no_selected_tests";
      } else if (selection.missingDurationTests.length > 0) {
        reason = "selected_test_missing_duration";
      } else {
        const selectedTestsMs = [...selectionData.selectedTestIds].reduce(
          (total, testId) => total + representativeDurations.get(testId),
          0,
        );
        if (!Number.isFinite(selectedTestsMs)
            || selectedTestsMs < 0
            || selectedTestsMs > Number.MAX_SAFE_INTEGER) {
          reason = "invalid_selected_duration";
        } else {
          const potentialTimeSavedMs = fullSuiteMs - selectedTestsMs;
          if (!Number.isFinite(potentialTimeSavedMs)
              || Math.abs(potentialTimeSavedMs) > Number.MAX_SAFE_INTEGER) {
            reason = "invalid_savings_duration";
          } else {
            duration = {
              unit: "ms",
              method: DURATION_METHOD,
              fullSuiteMs,
              selectedTestsMs,
              potentialTimeSavedMs,
              potentialTimeSavedPercent:
                Math.round((potentialTimeSavedMs / fullSuiteMs) * 10000) / 100,
            };
          }
        }
      }

      res.json(makeResponse({
        buildId,
        status: reason ? "insufficient_data" : "ready",
        reason,
        baseline: baselineData,
        selection,
        summary,
        excludedExecutions,
        duration,
      }));
    } catch (err) {
      console.error(`GET /test-selection/${buildId}/optimization failed:`, err);
      res.status(500).json({ error: "Failed to build test optimization result" });
    }
  });

  return router;
};
