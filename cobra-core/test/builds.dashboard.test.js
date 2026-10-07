const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const createBuildsRouter = require("../src/routes/builds");
const { getGateStatus } = require("../src/routes/builds");
const { validateBuildScan } = require("../src/adapters/ChangedFunctionRecord");

function createTestServer(pool) {
  const app = express();
  app.use(createBuildsRouter(pool));
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => {
    server.once("listening", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
      });
    });
  });
}

test("gate status distinguishes no changed functions and missing coverage from a pass", () => {
  assert.equal(getGateStatus({ totalChanged: 0, totalUntested: 0, coverageRunCount: 2 }), "no_data");
  assert.equal(getGateStatus({ totalChanged: 2, totalUntested: 0, coverageRunCount: 0 }), "no_data");
  assert.equal(getGateStatus({ totalChanged: 2, totalUntested: 1, coverageRunCount: 1 }), "failed");
  assert.equal(getGateStatus({ totalChanged: 2, totalUntested: 0, coverageRunCount: 1 }), "passed");
});

test("GET /builds paginates, filters, and returns build coverage summary", async (t) => {
  let queryText;
  let queryValues;
  const pool = {
    async query(text, values) {
      if (text.startsWith("SELECT DISTINCT repo")) return { rows: [{ repo: "travel-trust" }, { repo: "cobra-demo" }] };
      if (text.startsWith("SELECT DISTINCT branch")) return { rows: [{ branch: "main" }] };
      queryText = text;
      queryValues = values;
      return {
        rows: [{
          build_id: "build-2",
          repo: "travel-trust",
          commit_sha: "commit-2",
          language: "javascript",
          created_at: "2026-10-06T10:00:00.000Z",
          reference_build_id: "build-1",
          reference_created_at: "2026-10-05T10:00:00.000Z",
          reference_commit_sha: "commit-1",
          total_changed: 4,
          total_untested: 1,
          total_coverage_functions: 10,
          covered_functions: 7,
          coverage_run_count: 3,
          gate_status: "failed",
          total_count: 1,
        }],
      };
    },
  };
  const server = await createTestServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/builds?page=2&limit=5&app=travel-trust&gateStatus=failed&search=commit`);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.match(queryText, /ORDER BY filtered\.created_at DESC/);
  assert.match(queryText, /gate_status = \$2/);
  assert.deepEqual(queryValues, ["travel-trust", "failed", "%commit%", 5, 5]);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 1, totalPages: 1 });
  assert.equal(body.builds[0].overallCoverage, 70);
  assert.equal(body.builds[0].codeChangesCoverage, 75);
  assert.equal(body.builds[0].gateStatus, "failed");
  assert.equal(body.builds[0].referenceBuild.buildId, "build-1");
  assert.equal(body.builds[0].branch, null);
  assert.deepEqual(body.filters.apps, ["travel-trust", "cobra-demo"]);
  assert.deepEqual(body.filters.branches, ["main"]);
  assert.equal(body.dataAvailability.testStages, false);
});

test("GET /builds evaluates effective gate settings for build status filters", async (t) => {
  let queryText;
  const settings = {
    codeChangesCoverage: { enabled: true, stage: "all", comparator: ">=", threshold: 50 },
    overallCoverage: { enabled: false, stage: "all", comparator: ">=", threshold: 80 },
    failedTests: { enabled: false, stage: "all", comparator: "=", threshold: 0 },
  };
  const pool = {
    async query(text) {
      if (text.startsWith("SELECT DISTINCT repo")) return { rows: [{ repo: "travel-trust" }] };
      if (text.startsWith("SELECT DISTINCT branch")) return { rows: [] };
      queryText = text;
      return {
        rows: [{
          build_id: "build-settings",
          repo: "travel-trust",
          commit_sha: "commit-settings",
          language: "javascript",
          created_at: "2026-10-07T10:00:00.000Z",
          total_changed: 4,
          total_untested: 1,
          total_coverage_functions: 5,
          covered_functions: 4,
          coverage_run_count: 4,
          gate_settings: settings,
          total_count: 1,
        }],
      };
    },
  };
  const server = await createTestServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/builds?gateStatus=passed`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(queryText, /quality_gate_settings/);
  assert.match(queryText, /gate_status = \$1/);
  assert.equal(body.builds[0].gateStatus, "passed");
});

test("GET /builds filters by branch and returns only persisted branch names", async (t) => {
  let queryText;
  let queryValues;
  const pool = {
    async query(text, values) {
      if (text.startsWith("SELECT DISTINCT repo")) return { rows: [{ repo: "travel-trust" }] };
      if (text.startsWith("SELECT DISTINCT branch")) return { rows: [{ branch: "main" }, { branch: "release" }] };
      queryText = text;
      queryValues = values;
      return { rows: [{
        build_id: "main-build",
        repo: "travel-trust",
        branch: "main",
        commit_sha: "main-commit",
        language: "javascript",
        created_at: "2026-10-07T10:00:00.000Z",
        total_changed: 1,
        total_untested: 0,
        total_coverage_functions: 1,
        covered_functions: 1,
        coverage_run_count: 1,
        total_count: 1,
      }] };
    },
  };
  const server = await createTestServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/builds?app=travel-trust&branch=main`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(queryText, /COALESCE\(branch, ''\) = \$2/);
  assert.deepEqual(queryValues, ["travel-trust", "main", 25, 0]);
  assert.equal(body.builds[0].branch, "main");
  assert.deepEqual(body.filters.branches, ["main", "release"]);
});

test("GET /builds rejects repeated branch parameters", async (t) => {
  const server = await createTestServer({ query: async () => ({ rows: [] }) });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/builds?branch=main&branch=release`);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /branch must be a string/i);
});

test("build scan accepts an optional non-empty branch name", () => {
  const payload = { buildId: "build-1", repo: "app", commitSha: "sha", language: "javascript", changes: [] };
  assert.equal(validateBuildScan({ ...payload, branch: "main" }).valid, true);
  assert.equal(validateBuildScan({ ...payload, branch: "" }).valid, false);
  assert.equal(validateBuildScan(payload).valid, true);
});

test("GET /builds/:buildId/stages groups stored test IDs and leaves untracked measures null", async (t) => {
  let queryValues;
  const pool = {
    async query(_text, values) {
      queryValues = values;
      return {
        rows: [{
          test_id: "CI > quote submission",
          last_calculated: "2026-10-06T10:00:00.000Z",
          total_functions: 8,
          covered_functions: 6,
          changed_functions: 2,
          untested_changed_functions: 1,
        }],
      };
    },
  };
  const server = await createTestServer(pool);
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/builds/build-2/stages`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(queryValues, ["build-2"]);
  assert.equal(body.stages[0].stage, "Unassigned");
  assert.equal(body.stages[0].testId, "CI > quote submission");
  assert.equal(body.stages[0].overallCoverage, 75);
  assert.equal(body.stages[0].codeChangesCoverage, 50);
  assert.equal(body.stages[0].durationSeconds, null);
  assert.equal(body.stages[0].failed, null);
  assert.equal(body.stages[0].skipped, null);
  assert.equal(body.dataAvailability.namedStages, false);
});
