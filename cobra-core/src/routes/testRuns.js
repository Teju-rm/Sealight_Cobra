const express = require("express");

const RUN_STATUSES = new Set(["running", "completed", "failed", "cancelled"]);

function isTimestamp(value) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

module.exports = function createTestRunsRouter(pool) {
  const router = express.Router();

  router.post("/test-runs", async (req, res) => {
    const { id, buildId, suite, environment, startedAt } = req.body || {};
    if (typeof id !== "string" || !id.trim()
        || typeof buildId !== "string" || !buildId.trim()
        || typeof suite !== "string" || !suite.trim()
        || typeof environment !== "string" || !environment.trim()
        || (startedAt !== undefined && !isTimestamp(startedAt))) {
      return res.status(400).json({
        error: "id, buildId, suite, and environment are required; startedAt must be a valid timestamp when provided",
      });
    }

    try {
      const buildResult = await pool.query(
        "SELECT build_id, branch FROM builds WHERE build_id = $1",
        [buildId],
      );
      const build = buildResult.rows[0];
      if (!build) return res.status(404).json({ error: "Build not found" });

      const result = await pool.query(
        `INSERT INTO test_runs
           (id, build_id, branch, suite, environment, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'running', COALESCE($6::timestamptz, now()))
         RETURNING id, build_id, branch, suite, environment, status, started_at,
                   completed_at, created_at`,
        [id, buildId, build.branch, suite, environment, startedAt || null],
      );
      const row = result.rows[0];
      res.status(201).json({
        id: row.id,
        buildId: row.build_id,
        branch: row.branch,
        suite: row.suite,
        environment: row.environment,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      });
    } catch (err) {
      console.error("POST /test-runs failed:", err);
      res.status(500).json({ error: "Failed to create test run" });
    }
  });

  router.patch("/test-runs/:runId", async (req, res) => {
    const { runId } = req.params;
    const { status, completedAt } = req.body || {};
    if (!RUN_STATUSES.has(status)) {
      return res.status(400).json({ error: "status must be running, completed, failed, or cancelled" });
    }
    if (completedAt !== undefined && completedAt !== null && !isTimestamp(completedAt)) {
      return res.status(400).json({ error: "completedAt must be a valid timestamp or null" });
    }
    if (status === "running" && completedAt !== undefined && completedAt !== null) {
      return res.status(400).json({ error: "a running test run cannot have completedAt" });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const currentResult = await client.query(
        "SELECT id, status, started_at FROM test_runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Test run not found" });
      }
      if (current.status !== "running") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "A terminal test run is immutable" });
      }
      if (completedAt && Date.parse(completedAt) < new Date(current.started_at).getTime()) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "completedAt cannot be earlier than startedAt" });
      }

      const result = await client.query(
        `UPDATE test_runs
         SET status = $2,
             completed_at = CASE
               WHEN $2 = 'running' THEN NULL
               ELSE COALESCE($3::timestamptz, completed_at, now())
             END
         WHERE id = $1
         RETURNING id, build_id, branch, suite, environment, status, started_at,
                   completed_at, created_at`,
        [runId, status, completedAt || null],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      res.json({
        id: row.id,
        buildId: row.build_id,
        branch: row.branch,
        suite: row.suite,
        environment: row.environment,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      });
    } catch (err) {
      if (client) await client.query("ROLLBACK");
      console.error(`PATCH /test-runs/${runId} failed:`, err);
      res.status(500).json({ error: "Failed to update test run" });
    } finally {
      if (client) client.release();
    }
  });

  return router;
};
