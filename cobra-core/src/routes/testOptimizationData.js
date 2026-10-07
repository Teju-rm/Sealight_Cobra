const INCLUDED_STATUSES = new Set(["passed", "failed", "timedOut"]);
const EXCLUDED_STATUSES = ["skipped", "interrupted"];
const DURATION_METHOD = "median_per_test";
const MAX_SAFE_TOTAL = Number.MAX_SAFE_INTEGER;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2
    : sorted[middle];
}

async function loadBaselineRun(pool, build) {
  const result = await pool.query(
    `SELECT tr.id, tr.build_id, tr.branch, tr.suite, tr.environment,
            tr.completed_at,
            EXISTS (
              SELECT 1
              FROM test_executions eligible
              WHERE eligible.run_id = tr.id
                AND eligible.status IN ('passed', 'failed', 'timedOut')
                AND eligible.duration_ms >= 0
            ) AS has_eligible_execution
     FROM test_runs tr
     JOIN builds historical ON historical.build_id = tr.build_id
     WHERE tr.status = 'completed'
       AND historical.repo = $1
       AND historical.created_at < $2
       AND tr.completed_at < $2
     ORDER BY tr.completed_at DESC, tr.created_at DESC, tr.id`,
    [build.repo, build.created_at],
  );
  const completedRuns = result.rows;
  const eligibleRuns = completedRuns.filter((run) => run.has_eligible_execution);
  const candidates = eligibleRuns.length > 0 ? eligibleRuns : completedRuns;
  const sameBranch = candidates.filter((run) => run.branch === build.branch);
  return {
    baseline: sameBranch[0] || candidates[0] || null,
  };
}

async function loadBaselineDurations(pool, runId) {
  const result = await pool.query(
    `SELECT test_id, status, duration_ms
     FROM test_executions
     WHERE run_id = $1
     ORDER BY test_id, executed_at, id`,
    [runId],
  );
  const excludedExecutions = { skipped: 0, interrupted: 0, invalidDuration: 0 };
  const durationsByTest = new Map();

  for (const execution of result.rows) {
    if (EXCLUDED_STATUSES.includes(execution.status)) {
      excludedExecutions[execution.status] += 1;
      continue;
    }
    const durationMs = Number(execution.duration_ms);
    if (!INCLUDED_STATUSES.has(execution.status)
        || !Number.isSafeInteger(durationMs)
        || durationMs < 0) {
      excludedExecutions.invalidDuration += 1;
      continue;
    }
    if (!durationsByTest.has(execution.test_id)) durationsByTest.set(execution.test_id, []);
    durationsByTest.get(execution.test_id).push(durationMs);
  }

  const representativeDurations = new Map(
    [...durationsByTest].map(([testId, durations]) => [testId, median(durations)]),
  );
  const allDurationValues = [...representativeDurations.values()];
  const fullSuiteMs = allDurationValues.reduce((total, value) => total + value, 0);
  const validFullSuiteDuration = representativeDurations.size > 0
    && fullSuiteMs > 0
    && Number.isFinite(fullSuiteMs)
    && fullSuiteMs <= MAX_SAFE_TOTAL;

  return {
    excludedExecutions,
    representativeDurations,
    fullSuiteMs: validFullSuiteDuration ? fullSuiteMs : null,
    validFullSuiteDuration,
  };
}

function baselineResponse(baseline) {
  if (!baseline) return null;
  return {
    runId: baseline.id,
    buildId: baseline.build_id,
    branch: baseline.branch || null,
    suite: baseline.suite,
    environment: baseline.environment,
  };
}

module.exports = {
  DURATION_METHOD,
  baselineResponse,
  loadBaselineDurations,
  loadBaselineRun,
};
