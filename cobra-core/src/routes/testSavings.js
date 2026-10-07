const express = require("express");
const { loadHistoricalCoverage } = require("./historicalTestSelectionData");
const {
  DURATION_METHOD,
  baselineResponse,
  loadBaselineDurations,
  loadBaselineRun,
} = require("./testOptimizationData");

function emptyDuration() {
  return {
    unit: "ms",
    method: DURATION_METHOD,
    fullSuiteMs: null,
    selectedTestsMs: null,
    potentialTimeSavedMs: null,
    potentialTimeSavedPercent: null,
  };
}

function insufficientResponse(buildId, reason, baseline = null) {
  return {
    buildId,
    status: "insufficient_data",
    reason,
    baseline,
    selection: {
      selectedTests: 0,
      baselineTests: 0,
      missingDurationTests: [],
      missingDurationTestCount: 0,
    },
    excludedExecutions: { skipped: 0, interrupted: 0, invalidDuration: 0 },
    duration: emptyDuration(),
  };
}

module.exports = function createTestSavingsRouter(pool) {
  const router = express.Router();

  router.get("/test-selection/:buildId/savings", async (req, res) => {
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

      const { rows: selectionRows } = await loadHistoricalCoverage(pool, buildId, build);
      const selectedTestIds = new Set(selectionRows.map((row) => row.test_id));
      const selectedTestList = [...selectedTestIds].sort();
      const { baseline } = await loadBaselineRun(pool, build);
      if (!baseline) {
        return res.json({
          ...insufficientResponse(buildId, "no_completed_baseline_run"),
          selection: {
            selectedTests: selectedTestIds.size,
            baselineTests: 0,
            missingDurationTests: [],
            missingDurationTestCount: 0,
          },
        });
      }
      const durationData = await loadBaselineDurations(pool, baseline.id);
      const { excludedExecutions, representativeDurations, fullSuiteMs } = durationData;
      const missingDurationTests = selectedTestList.filter((testId) => !representativeDurations.has(testId));
      const selection = {
        selectedTests: selectedTestIds.size,
        baselineTests: representativeDurations.size,
        missingDurationTests,
        missingDurationTestCount: missingDurationTests.length,
      };
      const baselineData = baselineResponse(baseline);

      if (representativeDurations.size === 0) {
        return res.json({
          ...insufficientResponse(buildId, "baseline_has_no_eligible_executions", baselineData),
          selection,
          excludedExecutions,
        });
      }
      if (!durationData.validFullSuiteDuration) {
        return res.json({
          ...insufficientResponse(buildId, "zero_full_suite_duration", baselineData),
          selection,
          excludedExecutions,
        });
      }
      if (missingDurationTests.length > 0) {
        return res.json({
          ...insufficientResponse(buildId, "selected_test_missing_duration", baselineData),
          selection,
          excludedExecutions,
        });
      }

      const selectedTestsMs = [...selectedTestIds].reduce(
        (total, testId) => total + representativeDurations.get(testId),
        0,
      );
      if (!Number.isFinite(selectedTestsMs) || selectedTestsMs > Number.MAX_SAFE_INTEGER) {
        return res.json({
          ...insufficientResponse(buildId, "invalid_selected_duration", baselineData),
          selection,
          excludedExecutions,
        });
      }
      const potentialTimeSavedMs = fullSuiteMs - selectedTestsMs;
      if (!Number.isFinite(potentialTimeSavedMs)
          || Math.abs(potentialTimeSavedMs) > Number.MAX_SAFE_INTEGER) {
        return res.json({
          ...insufficientResponse(buildId, "invalid_savings_duration", baselineData),
          selection,
          excludedExecutions,
        });
      }
      res.json({
        buildId,
        status: "ok",
        baseline: baselineData,
        selection,
        excludedExecutions,
        duration: {
          unit: "ms",
          method: DURATION_METHOD,
          fullSuiteMs,
          selectedTestsMs,
          potentialTimeSavedMs,
          potentialTimeSavedPercent: Math.round((potentialTimeSavedMs / fullSuiteMs) * 10000) / 100,
        },
      });
    } catch (err) {
      console.error(`GET /test-selection/${buildId}/savings failed:`, err);
      res.status(500).json({ error: "Failed to calculate potential test time savings" });
    }
  });

  return router;
};
