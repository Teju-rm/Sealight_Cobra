const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const request = require("supertest");
const createTestSelectionRouter = require("../src/routes/testSelection");

const targetBuild = {
  build_id: "target-build",
  repo: "travel-trust-insurance",
  branch: "main",
  created_at: "2026-10-07T12:00:00.000Z",
};

const changedFunctions = [
  { file: "routes/contact.js", function: "submitContactHandler", status: "modified" },
  { file: "routes/claim.js", function: "submitClaimHandler", status: "modified" },
];

function createApp({ build = targetBuild, changes = changedFunctions, history = [] } = {}) {
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
        const changedKeys = new Set(
          changes
            .filter((change) => change.status !== "deleted")
            .map((change) => JSON.stringify([change.file, change.function])),
        );
        return {
          rows: history.filter((row) =>
            row.hits > 0
            && row.historical_repo === values[1]
            && row.historical_created_at < values[2]
            && row.historical_build_id !== values[0]
            && changedKeys.has(JSON.stringify([row.file, row.function]))),
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(createTestSelectionRouter(pool));
  return { app, queries };
}

function historicalRow(overrides = {}) {
  return {
    test_id: "contact test",
    file: "routes/contact.js",
    function: "submitContactHandler",
    historical_build_id: "previous-build",
    historical_repo: "travel-trust-insurance",
    historical_created_at: "2026-10-06T12:00:00.000Z",
    historical_branch: "main",
    hits: 1,
    execution_id: null,
    execution_suite: null,
    execution_status: null,
    execution_duration_ms: null,
    execution_executed_at: null,
    execution_environment: null,
    ...overrides,
  };
}

test("historical positive-hit coverage selects tests and excludes zero-hit coverage", async () => {
  const { app, queries } = createApp({
    history: [
      historicalRow(),
      historicalRow({ test_id: "zero-hit test", hits: 0 }),
    ],
  });
  const response = await request(app).get("/test-selection/target-build");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.selectedTests.map(({ testId }) => testId), ["contact test"]);
  assert.equal(queries[2].sql.includes("cr.hits > 0"), true);
  assert.equal(response.body.branchStrategy, "same_branch");
});

test("query excludes target, other repositories, and builds at or after the cutoff", async () => {
  const { app, queries } = createApp({
    history: [
      historicalRow({ test_id: "other repository", historical_repo: "different-repo" }),
      historicalRow({ test_id: "future", historical_created_at: "2026-10-08T12:00:00.000Z" }),
      historicalRow({ test_id: "target build", historical_build_id: "target-build" }),
    ],
  });
  const response = await request(app).get("/test-selection/target-build");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.selectedTests, []);
  const historyQuery = queries[2];
  assert.match(historyQuery.sql, /historical\.repo = \$2/);
  assert.match(historyQuery.sql, /historical\.created_at < \$3/);
  assert.match(historyQuery.sql, /cr\.build_id <> \$1/);
  assert.deepEqual(historyQuery.values, [
    "target-build",
    "travel-trust-insurance",
    targetBuild.created_at,
  ]);
});

test("deduplicates a test that covers multiple changed functions", async () => {
  const { app } = createApp({
    history: [
      historicalRow(),
      historicalRow({
        file: "routes/claim.js",
        function: "submitClaimHandler",
      }),
    ],
  });
  const response = await request(app).get("/test-selection/target-build");

  assert.equal(response.body.selectedTests.length, 1);
  assert.equal(response.body.selectedTests[0].coveredFunctions.length, 2);
  assert.equal(response.body.summary.coveredFunctions, 2);
});

test("returns changed functions without history as uncovered", async () => {
  const { app } = createApp({ history: [historicalRow()] });
  const response = await request(app).get("/test-selection/target-build");

  assert.deepEqual(response.body.uncoveredFunctions, [{
    file: "routes/claim.js",
    function: "submitClaimHandler",
    reason: "no_historical_coverage",
  }]);
  assert.equal(response.body.summary.uncoveredFunctions, 1);
});

test("returns no selected tests when no historical coverage is available", async () => {
  const { app } = createApp({ history: [] });
  const response = await request(app).get("/test-selection/target-build");

  assert.deepEqual(response.body.selectedTests, []);
  assert.equal(response.body.branchStrategy, "same_branch");
  assert.equal(response.body.summary.selectedTests, 0);
  assert.equal(response.body.uncoveredFunctions.length, 2);
});

test("prefers same-branch history and falls back to same-repo history across branches", async () => {
  const sameBranch = createApp({
    history: [
      historicalRow({ test_id: "main test", historical_branch: "main" }),
      historicalRow({ test_id: "other branch test", historical_branch: "release" }),
    ],
  });
  const sameBranchResponse = await request(sameBranch.app).get("/test-selection/target-build");
  assert.deepEqual(sameBranchResponse.body.selectedTests.map(({ testId }) => testId), ["main test"]);
  assert.equal(sameBranchResponse.body.branchStrategy, "same_branch");

  const fallback = createApp({
    history: [historicalRow({ historical_branch: "release" })],
  });
  const fallbackResponse = await request(fallback.app).get("/test-selection/target-build");
  assert.deepEqual(fallbackResponse.body.selectedTests.map(({ testId }) => testId), ["contact test"]);
  assert.equal(fallbackResponse.body.branchStrategy, "cross_branch_fallback");
});

test("returns execution metadata when present and still selects legacy coverage", async () => {
  const { app } = createApp({
    history: [
      historicalRow({
        test_id: "execution-aware",
        execution_id: "execution-1",
        execution_suite: "CI",
        execution_status: "passed",
        execution_duration_ms: "1250",
        execution_executed_at: "2026-10-06T11:59:00.000Z",
        execution_environment: "CI",
      }),
      historicalRow({ test_id: "legacy" }),
    ],
  });
  const response = await request(app).get("/test-selection/target-build");

  assert.equal(response.status, 200);
  const executionTest = response.body.selectedTests.find(({ testId }) => testId === "execution-aware");
  const legacyTest = response.body.selectedTests.find(({ testId }) => testId === "legacy");
  assert.deepEqual(executionTest.executions, [{
    executionId: "execution-1",
    suite: "CI",
    status: "passed",
    durationMs: 1250,
    executedAt: "2026-10-06T11:59:00.000Z",
    environment: "CI",
  }]);
  assert.deepEqual(legacyTest.executions, []);
});

test("deleted functions are reported as uncovered without selecting coverage", async () => {
  const { app } = createApp({
    changes: [
      { file: "routes/old.js", function: "removed", status: "deleted" },
    ],
    history: [historicalRow({
      file: "routes/old.js",
      function: "removed",
    })],
  });
  const response = await request(app).get("/test-selection/target-build");

  assert.deepEqual(response.body.selectedTests, []);
  assert.deepEqual(response.body.uncoveredFunctions, [{
    file: "routes/old.js",
    function: "removed",
    reason: "deleted_function",
  }]);
});

test("returns 404 when the target build does not exist", async () => {
  const { app, queries } = createApp({ build: null });
  const response = await request(app).get("/test-selection/missing");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Build not found" });
  assert.equal(queries.length, 1);
});
