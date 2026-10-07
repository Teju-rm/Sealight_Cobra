const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const request = require("supertest");
const createTestRunsRouter = require("../src/routes/testRuns");

function createApp({ build = { build_id: "build-1", branch: "main" }, existingRun } = {}) {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes("SELECT id, status FROM test_runs")) {
        return { rows: existingRun ? [existingRun] : [] };
      }
      if (text.includes("SELECT id, status, started_at FROM test_runs")) {
        return {
          rows: existingRun
            ? [{ ...existingRun, started_at: "2026-10-07T12:00:00.000Z" }]
            : [],
        };
      }
      if (text.includes("UPDATE test_runs")) {
        return {
          rows: [{
            id: values[0],
            build_id: "build-1",
            branch: "main",
            suite: "unit",
            environment: "CI",
            status: values[1],
            started_at: "2026-10-07T12:00:00.000Z",
            completed_at: values[2] || (values[1] === "running" ? null : "2026-10-07T12:10:00.000Z"),
            created_at: "2026-10-07T12:00:00.000Z",
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes("SELECT build_id, branch FROM builds")) {
        return { rows: build ? [build] : [] };
      }
      if (text.includes("INSERT INTO test_runs")) {
        return {
          rows: [{
            id: values[0],
            build_id: values[1],
            branch: values[2],
            suite: values[3],
            environment: values[4],
            status: "running",
            started_at: values[5] || "2026-10-07T12:00:00.000Z",
            completed_at: null,
            created_at: "2026-10-07T12:00:00.000Z",
          }],
        };
      }
      throw new Error(`unexpected pool query: ${text}`);
    },
    async connect() {
      return client;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createTestRunsRouter(pool));
  return { app, queries };
}

const createRunPayload = {
  id: "run-1",
  buildId: "build-1",
  suite: "unit",
  environment: "CI",
  startedAt: "2026-10-07T12:00:00.000Z",
};

test("POST /test-runs creates a run explicitly in running state", async () => {
  const { app, queries } = createApp();
  const response = await request(app).post("/test-runs").send(createRunPayload);

  assert.equal(response.status, 201);
  assert.equal(response.body.status, "running");
  assert.equal(response.body.branch, "main");
  assert.equal(response.body.completedAt, null);
  assert.match(queries[1].text, /'running'/);
});

for (const status of ["completed", "failed", "cancelled"]) {
  test(`PATCH /test-runs/:runId transitions a running run to ${status}`, async () => {
    const { app, queries } = createApp({ existingRun: { id: "run-1", status: "running" } });
    const response = await request(app)
      .patch("/test-runs/run-1")
      .send({ status, completedAt: "2026-10-07T12:10:00.000Z" });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, status);
    assert.equal(response.body.completedAt, "2026-10-07T12:10:00.000Z");
    assert.equal(queries.at(-1).text, "COMMIT");
  });
}

test("run creation requires an existing build", async () => {
  const { app } = createApp({ build: null });
  const response = await request(app).post("/test-runs").send(createRunPayload);
  assert.equal(response.status, 404);
});

test("PATCH rejects invalid run statuses", async () => {
  const { app, queries } = createApp();
  const response = await request(app).patch("/test-runs/run-1").send({ status: "unknown" });

  assert.equal(response.status, 400);
  assert.equal(queries.length, 0);
});

test("PATCH rejects a completion timestamp before the run started", async () => {
  const { app, queries } = createApp({ existingRun: { id: "run-1", status: "running" } });
  const response = await request(app)
    .patch("/test-runs/run-1")
    .send({ status: "completed", completedAt: "2026-10-07T11:59:00.000Z" });

  assert.equal(response.status, 400);
  assert.equal(queries.some(({ text }) => text.includes("UPDATE test_runs")), false);
  assert.equal(queries.at(-1).text, "ROLLBACK");
});

for (const status of ["completed", "failed", "cancelled"]) {
  test(`terminal ${status} run rejects a PATCH with the same status`, async () => {
    const { app, queries } = createApp({ existingRun: { id: "run-1", status } });
    const response = await request(app).patch("/test-runs/run-1").send({ status });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "A terminal test run is immutable");
    assert.equal(queries.some(({ text }) => text.includes("UPDATE test_runs")), false);
    assert.equal(queries.at(-1).text, "ROLLBACK");
  });
}

test("terminal completed run rejects a PATCH with only completedAt", async () => {
  const { app, queries } = createApp({
    existingRun: { id: "run-1", status: "completed" },
  });
  const response = await request(app)
    .patch("/test-runs/run-1")
    .send({ completedAt: "2026-10-07T12:10:00.000Z" });

  assert.equal(response.status, 400);
  assert.equal(queries.some(({ text }) => text.includes("UPDATE test_runs")), false);
});
