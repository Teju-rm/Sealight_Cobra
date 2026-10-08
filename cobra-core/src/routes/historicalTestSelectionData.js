async function loadHistoricalCoverage(pool, buildId, build, changedFunctionStatuses) {
  const result = await pool.query(
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
      AND ${changedFunctionStatuses ? "cf.status = ANY($4)" : "cf.status <> 'deleted'"}
     LEFT JOIN test_executions te ON te.id = cr.execution_id
     WHERE cr.build_id <> $1
       AND historical.repo = $2
       AND historical.created_at < $3
       AND cr.hits > 0`,
    changedFunctionStatuses
      ? [buildId, build.repo, build.created_at, changedFunctionStatuses]
      : [buildId, build.repo, build.created_at],
  );

  const sameBranchRows = result.rows.filter(
    (row) => row.historical_branch === build.branch,
  );
  const usedFallback = sameBranchRows.length === 0 && result.rows.length > 0;
  return {
    rows: usedFallback ? result.rows : sameBranchRows,
    branchStrategy: usedFallback ? "cross_branch_fallback" : "same_branch",
  };
}

module.exports = { loadHistoricalCoverage };
