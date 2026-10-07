const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const request = require("supertest");
const createIngestRouter = require("../src/routes/ingest");
const { JsAdapter } = require("../src/adapters/js/JsAdapter");
const { validateUCF } = require("../src/adapters/CoverageAdapter");
const coverageEntry = {
  file: "src/quote.js",
  function: "calculateQuote",
  startLine: 10,
  endLine: 24,
  hits: 3,
};
const execution = {
  id: "execution-1",
  suite: "CI",
  status: "passed",
  durationMs: 1250,
  executedAt: "2026-10-07T12:30:00.000Z",
  environment: "CI",
};

function createServer({ queryHook, runRows = [] } = {}) {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (queryHook) await queryHook(text, values);
      if (text.includes("FROM test_runs")) return { rows: runRows };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const app = express();
  app.use(express.json());
  app.use(createIngestRouter(pool));
  return { app, queries };
}

function payload(overrides = {}) {
  return {
    buildId: "build-1",
    testId: "CI > quote submission",
    language: "javascript",
    coverage: [coverageEntry],
    ...overrides,
  };
}

test("ingestion creates a test execution with duration and links coverage rows", async () => {
  const { app, queries } = createServer();
  const response = await request(app).post("/ingest").send(payload({ execution }));

  assert.equal(response.status, 201);
  assert.equal(response.body.executionId, execution.id);
  const executionInsert = queries.find(({ text }) => text.includes("INSERT INTO test_executions"));
  assert.deepEqual(executionInsert.values, [
    execution.id,
    "build-1",
    null,
    "CI > quote submission",
    "CI",
    "passed",
    1250,
    "2026-10-07T12:30:00.000Z",
    "CI",
  ]);
  const coverageInsert = queries.find(({ text }) => text.includes("INSERT INTO coverage_runs"));
  assert.match(coverageInsert.text, /execution_id/);
  assert.deepEqual(coverageInsert.values, [
    "build-1",
    execution.id,
    "CI > quote submission",
    "javascript",
    "src/quote.js",
    "calculateQuote",
    10,
    24,
    3,
  ]);
  assert.equal(queries.at(-1).text, "COMMIT");
});

test("the same logical test can have distinct executions across builds", async () => {
  const { app, queries } = createServer();
  const firstExecution = { ...execution, id: "execution-build-1" };
  const secondExecution = { ...execution, id: "execution-build-2" };

  const first = await request(app).post("/ingest").send(payload({ execution: firstExecution }));
  const second = await request(app).post("/ingest").send(payload({
    buildId: "build-2",
    execution: secondExecution,
  }));

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const executionInserts = queries.filter(({ text }) => text.includes("INSERT INTO test_executions"));
  assert.deepEqual(executionInserts.map(({ values }) => [values[0], values[1], values[3]]), [
    ["execution-build-1", "build-1", "CI > quote submission"],
    ["execution-build-2", "build-2", "CI > quote submission"],
  ]);
});

test("legacy coverage payloads remain valid and store no execution link", async () => {
  const legacyPayload = payload();
  assert.equal(validateUCF(legacyPayload).valid, true);

  const { app, queries } = createServer();
  const response = await request(app).post("/ingest").send(legacyPayload);

  assert.equal(response.status, 201);
  assert.equal(response.body.executionId, null);
  assert.equal(queries.some(({ text }) => text.includes("INSERT INTO test_executions")), false);
  const coverageInsert = queries.find(({ text }) => text.includes("INSERT INTO coverage_runs"));
  assert.equal(coverageInsert.values[1], null);
});

test("execution can reference a matching test run", async () => {
  const run = {
    id: "run-1",
    build_id: "build-1",
    suite: execution.suite,
    environment: execution.environment,
    status: "running",
  };
  const { app, queries } = createServer({ runRows: [run] });
  const response = await request(app).post("/ingest").send(payload({
    execution: { ...execution, runId: run.id },
  }));

  assert.equal(response.status, 201);
  const runLookup = queries.find(({ text }) => text.includes("FROM test_runs"));
  assert.deepEqual(runLookup.values, [run.id]);
  const executionInsert = queries.find(({ text }) => text.includes("INSERT INTO test_executions"));
  assert.equal(executionInsert.values[2], run.id);
});

test("execution is accepted for a running test run", async () => {
  const { app } = createServer({
    runRows: [{
      id: "running-run",
      build_id: "build-1",
      suite: execution.suite,
      environment: execution.environment,
      status: "running",
    }],
  });
  const response = await request(app).post("/ingest").send(payload({
    execution: { ...execution, runId: "running-run" },
  }));

  assert.equal(response.status, 201);
});

test("execution is rejected for every terminal test-run status", async () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const run = {
      id: `${status}-run`,
      build_id: "build-1",
      suite: execution.suite,
      environment: execution.environment,
      status,
    };
    const { app, queries } = createServer({ runRows: [run] });
    const response = await request(app).post("/ingest").send(payload({
      execution: { ...execution, runId: run.id },
    }));

    assert.equal(response.status, 400);
    assert.equal(response.body.error, `execution.runId references a terminal test run (${status})`);
    assert.equal(queries.some(({ text }) => text.includes("INSERT INTO test_executions")), false);
    assert.equal(queries.some(({ text }) => text.includes("INSERT INTO coverage_runs")), false);
    assert.equal(queries.at(-1).text, "ROLLBACK");
  }
});

test("execution rejects a missing or unrelated test run", async () => {
  const invalidAssociations = [
    { runRows: [], runId: "missing-run", buildId: "build-1" },
    {
      runRows: [{
        id: "other-build-run",
        build_id: "build-2",
        suite: execution.suite,
        environment: execution.environment,
        status: "running",
      }],
      runId: "other-build-run",
      buildId: "build-1",
    },
    {
      runRows: [{
        id: "other-suite-run",
        build_id: "build-1",
        suite: "integration",
        environment: execution.environment,
        status: "running",
      }],
      runId: "other-suite-run",
      buildId: "build-1",
    },
  ];

  for (const invalid of invalidAssociations) {
    const { app, queries } = createServer({ runRows: invalid.runRows });
    const response = await request(app).post("/ingest").send(payload({
      buildId: invalid.buildId,
      execution: { ...execution, runId: invalid.runId },
    }));
    assert.equal(response.status, 400);
    assert.equal(queries.some(({ text }) => text.includes("INSERT INTO test_executions")), false);
    assert.equal(queries.some(({ text }) => text === "ROLLBACK"), true);
  }
});

test("execution rejects an invalid runId and legacy execution payload remains valid", async () => {
  const invalid = validateUCF(payload({ execution: { ...execution, runId: "  " } }));
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /execution\.runId/);

  const { app, queries } = createServer();
  const response = await request(app).post("/ingest").send(payload({ execution }));
  assert.equal(response.status, 201);
  const executionInsert = queries.find(({ text }) => text.includes("INSERT INTO test_executions"));
  assert.equal(executionInsert.values[2], null);
});

test("invalid execution duration and status are rejected before persistence", async () => {
  for (const invalidExecution of [
    { ...execution, durationMs: -1 },
    { ...execution, durationMs: 1.5 },
    { ...execution, status: "unknown" },
  ]) {
    const { app, queries } = createServer();
    const response = await request(app).post("/ingest").send(payload({ execution: invalidExecution }));
    assert.equal(response.status, 400);
    assert.equal(queries.length, 0);
  }
});

test("database build-reference rejection rolls back the execution and coverage transaction", async () => {
  const { app, queries } = createServer({
    queryHook(text) {
      if (text.includes("INSERT INTO test_executions")) {
        const error = new Error("test_executions_build_id_fkey");
        error.code = "23503";
        throw error;
      }
    },
  });
  const response = await request(app).post("/ingest").send(payload({ execution }));

  assert.equal(response.status, 500);
  assert.equal(queries.some(({ text }) => text === "ROLLBACK"), true);
  assert.equal(queries.some(({ text }) => text.includes("INSERT INTO coverage_runs")), false);
});

test("JavaScript adapter maps local test artifact execution metadata into the ingestion contract", () => {
  const adapter = new JsAdapter({ projectRoot: process.cwd() });
  const result = adapter.toUCF({
    executionId: "execution-1",
    runId: "run-1",
    testDescription: "CI > quote submission",
    testName: "quote submission",
    testSuite: "CI",
    status: "passed",
    durationMs: 1250,
    startedAt: "2026-10-07T12:29:58.750Z",
    environment: "CI",
  }, { buildId: "build-1" });

  assert.deepEqual(result.execution, {
    id: "execution-1",
    runId: "run-1",
    suite: "CI",
    status: "passed",
    durationMs: 1250,
    executedAt: "2026-10-07T12:29:58.750Z",
    environment: "CI",
  });
});
