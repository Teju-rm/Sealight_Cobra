const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const createGateSettingsRouter = require("../src/routes/gateSettings");
const {
  defaultGateSettings,
  evaluateGateSettings,
  validateGateSettings,
} = require("../src/gateSettings");

function createTestServer(pool) {
  const app = express();
  app.use(express.json());
  app.use(createGateSettingsRouter(pool));
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

test("default settings provide the requested thresholds without changing existing gate behavior", () => {
  const defaults = defaultGateSettings();
  assert.deepEqual(
    Object.fromEntries(Object.entries(defaults).map(([key, setting]) => [key, setting.threshold])),
    { codeChangesCoverage: 50, overallCoverage: 80, failedTests: 0 }
  );
  assert.equal(Object.values(defaults).some((setting) => setting.enabled), false);
  assert.equal(evaluateGateSettings({
    settings: defaults,
    metrics: {},
    totalChanged: 1,
    coverageRunCount: 1,
  }), null);
});

test("enabled settings pass only when every available condition meets its comparator", () => {
  const settings = defaultGateSettings();
  settings.codeChangesCoverage.enabled = true;
  settings.overallCoverage.enabled = true;
  const result = evaluateGateSettings({
    settings,
    totalChanged: 4,
    coverageRunCount: 2,
    metrics: { code_changes_coverage: 75, overall_coverage: 80 },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.failedConditions, []);
});

test("an enabled unavailable metric fails closed and is reported", () => {
  const settings = defaultGateSettings();
  settings.failedTests.enabled = true;
  const result = evaluateGateSettings({
    settings,
    totalChanged: 4,
    coverageRunCount: 2,
    metrics: { failed_tests: null },
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.unavailableConditions, ["failedTests"]);
});

test("GET settings returns defaults and maps the unassigned branch sentinel", async (t) => {
  let queryValues;
  const server = await createTestServer({
    async query(_text, values) {
      queryValues = values;
      return { rows: [] };
    },
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/apps/travel-trust/branches/unassigned/gate-settings`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(queryValues, ["travel-trust", ""]);
  assert.equal(body.branch, null);
  assert.equal(body.configured, false);
  assert.equal(body.settings.overallCoverage.threshold, 80);
  assert.equal(body.dataAvailability.buildBranches, false);
  assert.equal(body.dataAvailability.failedTestCounts, false);
});

test("PUT settings persists validated settings as a new effective version", async (t) => {
  let queryText;
  let queryValues;
  const settings = defaultGateSettings();
  settings.codeChangesCoverage.enabled = true;
  const effectiveAt = "2026-10-07T00:00:00.000Z";
  const server = await createTestServer({
    async query(text, values) {
      queryText = text;
      queryValues = values;
      return { rows: [{ settings, effective_at: effectiveAt }] };
    },
  });
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/apps/travel-trust/branches/unassigned/gate-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(queryText, /INSERT INTO quality_gate_settings/);
  assert.deepEqual(queryValues.slice(0, 2), ["travel-trust", ""]);
  assert.deepEqual(JSON.parse(queryValues[2]), settings);
  assert.equal(body.settings.codeChangesCoverage.enabled, true);
  assert.equal(body.effectiveAt, effectiveAt);
});

test("settings reject invalid thresholds and unsupported specific stages", () => {
  const invalidThreshold = defaultGateSettings();
  invalidThreshold.overallCoverage.threshold = 101;
  assert.match(validateGateSettings(invalidThreshold), /0 to 100/);

  const unsupportedStage = defaultGateSettings();
  unsupportedStage.codeChangesCoverage.stage = "unit";
  assert.match(validateGateSettings(unsupportedStage), /named test stages are not stored/);
});
