const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const request = require("supertest");
const createTestOptimizationRouter = require("../src/routes/testOptimization");
const createTestSelectionRouter = require("../src/routes/testSelection");

const target = {
  build_id: "target-build",
  repo: "demo-repo",
  branch: "main",
  created_at: "2026-10-08T12:00:00.000Z",
};

const baseline = {
  id: "baseline-run",
  build_id: "baseline-build",
  branch: "main",
  suite: "unit",
  environment: "CI",
  completed_at: "2026-10-07T12:00:00.000Z",
  has_eligible_execution: true,
};

const changedFunctions = [
  { file: "src/one.js", function: "one", status: "modified" },
  { file: "src/two.js", function: "two", status: "new" },
  { file: "src/three.js", function: "three", status: "modified" },
];

function historyRow(testId, file, functionName, overrides = {}) {
  return {
    test_id: testId,
    file,
    function: functionName,
    historical_build_id: "coverage-build",
    historical_branch: "main",
    execution_id: null,
    execution_suite: null,
    execution_status: null,
    execution_duration_ms: null,
    execution_executed_at: null,
    execution_environment: null,
    ...overrides,
  };
}

const defaultHistory = [
  historyRow("selected-A", "src/one.js", "one"),
  historyRow("selected-A", "src/two.js", "two"),
];

function exec(testId, status, duration, overrides = {}) {
  return {
    test_id: testId,
    status,
    duration_ms: duration,
    ...overrides,
  };
}

function createApp({
  build = target,
  changes = changedFunctions,
  history = defaultHistory,
  baselines = [baseline],
  executions = [
    exec("selected-A", "passed", "100"),
    exec("unselected-B", "passed", "300"),
  ],
  includeSelection = false,
} = {}) {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM builds") && sql.includes("WHERE build_id = $1")) {
        return { rows: build ? [build] : [] };
      }
      if (sql.includes("FROM changed_functions") && sql.includes("ORDER BY file")) {
        return { rows: changes };
      }
      if (sql.includes("FROM coverage_runs cr")) {
        const eligibleChanges = new Set(
          changes
            .filter((change) => change.status !== "deleted")
            .map((change) => JSON.stringify([change.file, change.function])),
        );
        return {
          rows: history.filter((row) =>
            eligibleChanges.has(JSON.stringify([row.file, row.function]))),
        };
      }
      if (sql.includes("FROM test_runs tr")) return { rows: baselines };
      if (sql.includes("FROM test_executions")) return { rows: executions };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(createTestOptimizationRouter(pool));
  if (includeSelection) app.use(createTestSelectionRouter(pool));
  return { app, queries };
}

test("returns ready optimization with selected, unselected, and uncovered entries", async () => {
  const { app } = createApp();
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ready");
  assert.equal(response.body.baseline.runId, baseline.id);
  assert.deepEqual(response.body.selection.selectedTests, [{
    testId: "selected-A",
    coveredFunctions: [
      { file: "src/one.js", function: "one" },
      { file: "src/two.js", function: "two" },
    ],
    representativeDurationMs: 100,
  }]);
  assert.deepEqual(response.body.selection.unselectedTests, [{
    testId: "unselected-B",
    representativeDurationMs: 300,
    reason: "no_selected_changed_function_coverage",
  }]);
  assert.deepEqual(response.body.selection.uncoveredFunctions, [{
    file: "src/three.js",
    function: "three",
    reason: "no_historical_coverage",
  }]);
  assert.deepEqual(response.body.duration, {
    unit: "ms",
    method: "median_per_test",
    fullSuiteMs: 400,
    selectedTestsMs: 100,
    potentialTimeSavedMs: 300,
    potentialTimeSavedPercent: 75,
  });
});

test("returns 404 when target build does not exist", async () => {
  const { app } = createApp({ build: null });
  const response = await request(app).get("/test-selection/missing/optimization");
  assert.equal(response.status, 404);
});

test("reports no completed baseline while retaining historical selection", async () => {
  const { app } = createApp({ baselines: [] });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "no_completed_baseline_run");
  assert.equal(response.body.selection.selectedTests.length, 1);
  assert.equal(response.body.duration.fullSuiteMs, null);
});

test("prefers same-branch baseline then falls back across branches", async () => {
  const otherBranch = {
    ...baseline,
    id: "release-run",
    branch: "release",
    completed_at: "2026-10-07T13:00:00.000Z",
  };
  const sameBranch = { ...baseline, id: "main-run", completed_at: "2026-10-07T11:00:00.000Z" };
  const preferred = createApp({
    baselines: [otherBranch, sameBranch],
    executions: [exec("selected-A", "passed", "100")],
  });
  const preferredResponse = await request(preferred.app).get("/test-selection/target-build/optimization");
  assert.equal(preferredResponse.body.baseline.runId, sameBranch.id);

  const fallback = createApp({
    baselines: [otherBranch],
    executions: [exec("selected-A", "passed", "100")],
    history: [historyRow("selected-A", "src/one.js", "one", { historical_branch: "release" })],
  });
  const fallbackResponse = await request(fallback.app).get("/test-selection/target-build/optimization");
  assert.equal(fallbackResponse.body.baseline.runId, otherBranch.id);
  assert.equal(fallbackResponse.body.selection.branchStrategy, "cross_branch_fallback");
});

test("historical selection query constrains repository, build cutoff, hits, and changed functions", async () => {
  const { app, queries } = createApp();
  await request(app).get("/test-selection/target-build/optimization");
  const historyQuery = queries.find(({ sql }) => sql.includes("FROM coverage_runs cr"));

  assert.match(historyQuery.sql, /historical\.repo = \$2/);
  assert.match(historyQuery.sql, /historical\.created_at < \$3/);
  assert.match(historyQuery.sql, /cr\.hits > 0/);
  assert.match(historyQuery.sql, /cf\.file = cr\.file/);
  assert.match(historyQuery.sql, /cf\.function = cr\.function/);
  assert.deepEqual(historyQuery.values, [target.build_id, target.repo, target.created_at]);
});

test("uses median for repeated executions and includes failed and timed-out tests", async () => {
  const { app } = createApp({
    executions: [
      exec("selected-A", "passed", "100"),
      exec("selected-A", "passed", "120"),
      exec("selected-A", "passed", "110"),
      exec("unselected-B", "failed", "300"),
      exec("unselected-C", "timedOut", "400"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.selection.selectedTests[0].representativeDurationMs, 110);
  assert.equal(response.body.duration.fullSuiteMs, 810);
  assert.equal(response.body.duration.selectedTestsMs, 110);
  assert.deepEqual(response.body.selection.unselectedTests.map(({ testId }) => testId), [
    "unselected-B",
    "unselected-C",
  ]);
});

test("excludes skipped and interrupted executions from tests and reports counts", async () => {
  const { app } = createApp({
    executions: [
      exec("selected-A", "passed", "100"),
      exec("skip-A", "skipped", "900"),
      exec("interrupt-A", "interrupted", "800"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.deepEqual(response.body.excludedExecutions, {
    skipped: 1,
    interrupted: 1,
    invalidDuration: 0,
  });
  assert.deepEqual(response.body.selection.unselectedTests, []);
});

test("invalid and unsafe durations are not treated as zero", async () => {
  const { app } = createApp({
    executions: [
      exec("selected-A", "passed", "9007199254740992"),
      exec("unselected-B", "passed", "invalid"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "no_eligible_execution_data");
  assert.equal(response.body.excludedExecutions.invalidDuration, 2);
  assert.equal(response.body.duration.fullSuiteMs, null);
});

test("selected tests without baseline durations are listed and make result insufficient", async () => {
  const { app } = createApp({ executions: [exec("unselected-B", "passed", "300")] });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "selected_test_missing_duration");
  assert.deepEqual(response.body.selection.missingDurationTests, ["selected-A"]);
  assert.equal(response.body.selection.selectedTests[0].representativeDurationMs, null);
  assert.equal(response.body.duration.potentialTimeSavedPercent, null);
});

test("empty selected set is not presented as a 100-percent optimization", async () => {
  const { app } = createApp({ history: [] });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "no_selected_tests");
  assert.equal(response.body.duration.potentialTimeSavedPercent, null);
  assert.equal(response.body.selection.unselectedTests.length, 2);
});

test("no changed functions is distinguished from no selected tests", async () => {
  const { app } = createApp({ changes: [], history: [] });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "no_changed_functions");
  assert.equal(response.body.summary.changedFunctions, 0);
  assert.equal(response.body.duration.potentialTimeSavedPercent, null);
});

test("deleted changed functions are uncovered and cannot select a test", async () => {
  const { app } = createApp({
    changes: [{ file: "src/deleted.js", function: "removed", status: "deleted" }],
    history: [historyRow("old-test", "src/deleted.js", "removed")],
  });
  const response = await request(app).get("/test-selection/target-build/optimization");

  assert.equal(response.body.reason, "no_selected_tests");
  assert.deepEqual(response.body.selection.uncoveredFunctions, [{
    file: "src/deleted.js",
    function: "removed",
    reason: "deleted_function",
  }]);
  assert.deepEqual(response.body.selection.selectedTests, []);
});

test("selected and unselected baseline tests never overlap", async () => {
  const { app } = createApp({
    executions: [
      exec("selected-A", "passed", "100"),
      exec("unselected-B", "passed", "300"),
      exec("also-selected", "failed", "200"),
    ],
    history: [
      ...defaultHistory,
      historyRow("also-selected", "src/three.js", "three"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/optimization");
  const selected = new Set(response.body.selection.selectedTests.map(({ testId }) => testId));
  const unselected = response.body.selection.unselectedTests.map(({ testId }) => testId);
  assert.equal(unselected.some((testId) => selected.has(testId)), false);
});

test("optimization uses the same selected test IDs as the Phase 13.2 endpoint", async () => {
  const { app } = createApp({ includeSelection: true });
  const optimization = await request(app).get("/test-selection/target-build/optimization");
  const selection = await request(app).get("/test-selection/target-build");

  assert.deepEqual(
    optimization.body.selection.selectedTests.map(({ testId }) => testId),
    selection.body.selectedTests.map(({ testId }) => testId),
  );
});

test("empty or unsafe full-suite duration is insufficient", async () => {
  for (const executions of [
    [exec("selected-A", "passed", "0")],
    [
      exec("selected-A", "passed", "9007199254740991"),
      exec("unselected-B", "passed", "1"),
    ],
  ]) {
    const { app } = createApp({ executions });
    const response = await request(app).get("/test-selection/target-build/optimization");
    assert.equal(response.body.status, "insufficient_data");
    assert.equal(response.body.reason, "invalid_full_suite_duration");
    assert.equal(response.body.duration.fullSuiteMs, null);
  }
});
