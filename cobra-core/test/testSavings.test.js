const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const request = require("supertest");
const createTestSavingsRouter = require("../src/routes/testSavings");

const targetBuild = {
  build_id: "target-build",
  repo: "demo-repo",
  branch: "main",
  created_at: "2026-10-07T12:00:00.000Z",
};

const baseline = {
  id: "baseline-run",
  build_id: "baseline-build",
  branch: "main",
  suite: "unit",
  environment: "CI",
  completed_at: "2026-10-06T12:00:00.000Z",
  build_created_at: "2026-10-06T11:00:00.000Z",
  build_branch: "main",
  has_eligible_execution: true,
};

function historicalRow(overrides = {}) {
  return {
    test_id: "selected-test",
    historical_build_id: "coverage-build",
    historical_branch: "main",
    ...overrides,
  };
}

function createApp({ build = targetBuild, history = [historicalRow()], baselines = [baseline], executions = [] } = {}) {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM builds") && sql.includes("WHERE build_id = $1")) {
        return { rows: build ? [build] : [] };
      }
      if (sql.includes("FROM coverage_runs cr")) {
        return { rows: history.filter((row) => row.historical_branch === build.branch) };
      }
      if (sql.includes("FROM test_runs tr")) return { rows: baselines };
      if (sql.includes("FROM test_executions")) return { rows: executions };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(createTestSavingsRouter(pool));
  return { app, queries };
}

function execution(testId, status, durationMs, runId = baseline.id) {
  return { test_id: testId, status, duration_ms: durationMs, run_id: runId };
}

test("no completed baseline returns insufficient_data without invented savings", async () => {
  const { app } = createApp({ baselines: [] });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "no_completed_baseline_run");
  assert.equal(response.body.baseline, null);
  assert.equal(response.body.duration.potentialTimeSavedPercent, null);
});

test("completed baseline without executions returns insufficient_data", async () => {
  const { app } = createApp({
    baselines: [{ ...baseline, has_eligible_execution: false }],
    executions: [],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "baseline_has_no_eligible_executions");
});

test("reports skipped and interrupted counts when a completed baseline has no eligible tests", async () => {
  const { app } = createApp({
    baselines: [{ ...baseline, has_eligible_execution: false }],
    executions: [
      execution("skipped-test", "skipped", "100"),
      execution("interrupted-test", "interrupted", "200"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.reason, "baseline_has_no_eligible_executions");
  assert.deepEqual(response.body.excludedExecutions, {
    skipped: 1,
    interrupted: 1,
    invalidDuration: 0,
  });
});

test("full-suite and selected durations use representative durations from one baseline", async () => {
  const { app, queries } = createApp({
    executions: [
      execution("selected-test", "passed", "1000"),
      execution("selected-test", "passed", "1200"),
      execution("selected-test", "passed", "1100"),
      execution("other-test", "failed", "2000"),
      execution("timed-out-test", "timedOut", "500"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.status, "ok");
  assert.equal(response.body.baseline.runId, baseline.id);
  assert.equal(response.body.duration.fullSuiteMs, 3600);
  assert.equal(response.body.duration.selectedTestsMs, 1100);
  assert.equal(response.body.duration.potentialTimeSavedMs, 2500);
  assert.equal(response.body.duration.potentialTimeSavedPercent, 69.44);
  assert.deepEqual(response.body.selection, {
    selectedTests: 1,
    baselineTests: 3,
    missingDurationTests: [],
    missingDurationTestCount: 0,
  });
  assert.deepEqual(queries[2].values, [targetBuild.repo, targetBuild.created_at]);
  assert.match(queries[2].sql, /tr\.completed_at < \$2/);
  assert.deepEqual(queries[3].values, [baseline.id]);
});

test("median is used for an even number of repeated executions", async () => {
  const { app } = createApp({
    executions: [
      execution("selected-test", "passed", "1000"),
      execution("selected-test", "passed", "1200"),
      execution("other-test", "passed", "1800"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.duration.selectedTestsMs, 1100);
  assert.equal(response.body.duration.fullSuiteMs, 2900);
});

test("skipped and interrupted executions are excluded and reported", async () => {
  const { app } = createApp({
    executions: [
      execution("selected-test", "passed", "100"),
      execution("skipped-test", "skipped", "900"),
      execution("interrupted-test", "interrupted", "800"),
      execution("failed-test", "failed", "200"),
      execution("timed-out-test", "timedOut", "300"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.status, "ok");
  assert.deepEqual(response.body.excludedExecutions, {
    skipped: 1,
    interrupted: 1,
    invalidDuration: 0,
  });
  assert.equal(response.body.selection.baselineTests, 3);
  assert.equal(response.body.duration.fullSuiteMs, 600);
});

test("selected-test duration is taken only from the chosen baseline run", async () => {
  const { app, queries } = createApp({
    baselines: [
      baseline,
      { ...baseline, id: "older-run", build_id: "older-build", completed_at: "2026-10-05T12:00:00.000Z" },
    ],
    executions: [
      execution("selected-test", "passed", "120"),
      execution("other-test", "passed", "380"),
    ],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.baseline.runId, baseline.id);
  assert.deepEqual(queries[3].values, [baseline.id]);
  assert.equal(response.body.duration.selectedTestsMs, 120);
});

test("skips a newer completed run with no eligible durations when choosing a baseline", async () => {
  const newerEmpty = {
    ...baseline,
    id: "newer-empty-run",
    completed_at: "2026-10-06T13:00:00.000Z",
    has_eligible_execution: false,
  };
  const olderUsable = {
    ...baseline,
    id: "older-usable-run",
    completed_at: "2026-10-06T12:00:00.000Z",
    has_eligible_execution: true,
  };
  const { app, queries } = createApp({
    baselines: [newerEmpty, olderUsable],
    executions: [execution("selected-test", "passed", "100", olderUsable.id)],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.status, "ok");
  assert.equal(response.body.baseline.runId, olderUsable.id);
  assert.deepEqual(queries[3].values, [olderUsable.id]);
});

test("missing selected-test duration returns insufficient_data, not zero", async () => {
  const { app } = createApp({
    history: [historicalRow(), historicalRow({ test_id: "missing-test" })],
    executions: [execution("selected-test", "passed", "100")],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.status, "insufficient_data");
  assert.equal(response.body.reason, "selected_test_missing_duration");
  assert.deepEqual(response.body.selection.missingDurationTests, ["missing-test"]);
  assert.equal(response.body.selection.missingDurationTestCount, 1);
  assert.equal(response.body.duration.fullSuiteMs, null);
  assert.equal(response.body.duration.potentialTimeSavedPercent, null);
});

test("zero or invalid full-suite duration is handled as insufficient data", async () => {
  for (const executions of [
    [execution("selected-test", "passed", "0")],
    [execution("selected-test", "passed", "not-a-duration")],
  ]) {
    const { app } = createApp({ executions });
    const response = await request(app).get("/test-selection/target-build/savings");
    assert.equal(response.body.status, "insufficient_data");
    assert.ok(["zero_full_suite_duration", "baseline_has_no_eligible_executions"].includes(response.body.reason));
    assert.equal(response.body.duration.potentialTimeSavedPercent, null);
  }
});

test("prefers the newest completed run on the target branch before cross-branch fallback", async () => {
  const olderSameBranch = { ...baseline, id: "same-branch-run", completed_at: "2026-10-05T12:00:00.000Z" };
  const newerOtherBranch = {
    ...baseline,
    id: "other-branch-run",
    branch: "release",
    build_branch: "main",
    completed_at: "2026-10-06T13:00:00.000Z",
  };
  const { app, queries } = createApp({
    baselines: [newerOtherBranch, olderSameBranch],
    executions: [execution("selected-test", "passed", "100")],
  });
  const response = await request(app).get("/test-selection/target-build/savings");

  assert.equal(response.body.baseline.runId, olderSameBranch.id);
  assert.deepEqual(queries[3].values, [olderSameBranch.id]);
});

test("target build must exist", async () => {
  const { app } = createApp({ build: null });
  const response = await request(app).get("/test-selection/missing/savings");
  assert.equal(response.status, 404);
});
