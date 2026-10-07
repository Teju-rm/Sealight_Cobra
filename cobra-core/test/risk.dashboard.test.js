const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const createRiskRouter = require("../src/routes/risk");
const { validateBuildScan } = require("../src/adapters/ChangedFunctionRecord");
const { JsBuildScanner } = require("../src/scanners/js/JsBuildScanner");

const build = {
  repo: "demo-app",
  created_at: "2026-10-06T12:00:00.000Z",
  reference_build_id: "previous-build",
  reference_commit_sha: "previous-sha",
  reference_created_at: "2026-10-05T12:00:00.000Z",
};

const untestedRows = [
  { file: "src/a.js", function: "changedOne", status: "modified", start_line: 15, author: "Alice Example" },
  { file: "src/a.js", function: "changedTwo", status: "new", start_line: 40, author: "Bob Builder" },
  { file: "src/b.js", function: "removedOne", status: "deleted", start_line: 8, author: null },
];

function createApp() {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM builds b")) return { rows: [build] };
      if (sql.includes("HAVING COALESCE")) return { rows: untestedRows };
      if (sql.includes("SELECT cr.test_id")) return { rows: [] };
      if (sql.includes("AS total") && sql.includes("FROM changed_functions")) {
        return { rows: [{ total: untestedRows.length, coverage_run_count: 3 }] };
      }
      if (sql.includes("per_function")) return { rows: [{ total: 10, covered: 8 }] };
      if (sql.includes("FROM quality_gate_settings")) return { rows: [] };
      if (sql.includes("FROM quality_gate_rules")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(createRiskRouter(pool));
  return app;
}

function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => {
    server.once("listening", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
    }));
  });
}

test("GET /risk/:buildId groups untested methods by file and includes author initials", async (t) => {
  const server = await listen(createApp());
  t.after(() => server.close());

  const response = await fetch(`${server.url}/risk/build-1?stage=all`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.build.app, "demo-app");
  assert.equal(body.build.referenceBuild.buildId, "previous-build");
  assert.equal(body.qualityRiskCount, 3);
  assert.equal(body.highPriorityCount, 2);
  assert.deepEqual(body.fileGroups.map((group) => [group.file, group.qualityRisks, group.highPriority]), [
    ["src/a.js", 2, 2],
    ["src/b.js", 1, 0],
  ]);
  assert.deepEqual(body.fileGroups[0].contributors, [
    { name: "Alice Example", initials: "AE" },
    { name: "Bob Builder", initials: "BB" },
  ]);
  assert.equal(body.fileGroups[0].methods[0].name, "changedOne");
  assert.equal(body.fileGroups[0].methods[0].line, 15);
  assert.equal(body.untestedChanges.length, 3);
});

test("risk search filters grouped files and methods without changing total gate risk", async (t) => {
  const server = await listen(createApp());
  t.after(() => server.close());

  const response = await fetch(`${server.url}/risk/build-1?search=changedTwo`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.qualityRiskCount, 3);
  assert.equal(body.untestedChanges.length, 3);
  assert.equal(body.fileGroups.length, 1);
  assert.equal(body.fileGroups[0].file, "src/a.js");
  assert.deepEqual(body.fileGroups[0].methods.map((method) => method.name), ["changedTwo"]);
});

test("risk endpoint rejects unavailable named test-stage filters", async (t) => {
  const server = await listen(createApp());
  t.after(() => server.close());

  const response = await fetch(`${server.url}/risk/build-1?stage=unit`);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /named test stages are not stored/);
});

test("build-scan author validation accepts absent, null and string values only", () => {
  const payload = {
    buildId: "build-1",
    repo: "demo-app",
    commitSha: "abc",
    language: "javascript",
    changes: [{ file: "src/a.js", function: "f", startLine: 1, endLine: 2, status: "modified" }],
  };
  assert.equal(validateBuildScan(payload).valid, true);
  assert.equal(validateBuildScan({ ...payload, changes: [{ ...payload.changes[0], author: null }] }).valid, true);
  assert.equal(validateBuildScan({ ...payload, changes: [{ ...payload.changes[0], author: "Alice" }] }).valid, true);
  const invalid = validateBuildScan({ ...payload, changes: [{ ...payload.changes[0], author: 42 }] });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors[0], /author must be a string or null/);
});

test("scanner author helper parses the latest named author and safely handles unavailable blame", () => {
  const scanner = new JsBuildScanner({ projectRoot: process.cwd() });
  scanner._git = (args) => {
    assert.deepEqual(args, ["log", "-L", "4,8:src/a.js", "-1", "--format=%an"]);
    return "Alice Example\n";
  };
  assert.equal(scanner._getAuthor("src/a.js", 4, 8), "Alice Example");
  scanner._git = () => { throw new Error("git history is unavailable"); };
  assert.equal(scanner._getAuthor("src/a.js", 4, 8), null);
});
