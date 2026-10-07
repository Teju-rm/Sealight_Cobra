const express = require("express");
const { validateUCF } = require("../adapters/CoverageAdapter");

function createIngestRouter(databasePool) {
  const router = express.Router();

  router.post("/ingest", async (req, res) => {
    const { valid, errors } = validateUCF(req.body);
    if (!valid) return res.status(400).json({ error: "invalid UCF payload", details: errors });

    const { buildId, testId, language, coverage, execution } = req.body;
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO builds (build_id, repo, commit_sha, language)
         VALUES ($1, 'unknown', 'unknown', $2)
         ON CONFLICT (build_id) DO NOTHING`,
        [buildId, language]
      );

      if (execution) {
        let runId = null;
        if (execution.runId) {
          const runResult = await client.query(
            `SELECT id, build_id, suite, environment, status
             FROM test_runs
             WHERE id = $1
             FOR SHARE`,
            [execution.runId],
          );
          const run = runResult.rows[0];
          if (!run) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "execution.runId does not reference an existing test run" });
          }
          if (run.status !== "running") {
            await client.query("ROLLBACK");
            return res.status(400).json({
              error: `execution.runId references a terminal test run (${run.status})`,
            });
          }
          if (run.build_id !== buildId) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "execution.runId belongs to a different build" });
          }
          if (run.suite !== execution.suite || run.environment !== execution.environment) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "execution suite and environment must match the referenced test run" });
          }
          runId = run.id;
        }

        await client.query(
          `INSERT INTO test_executions
             (id, build_id, run_id, test_id, suite, status, duration_ms, executed_at, environment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            execution.id,
            buildId,
            runId,
            testId,
            execution.suite,
            execution.status,
            execution.durationMs,
            execution.executedAt,
            execution.environment,
          ]
        );
      }

      for (const entry of coverage) {
        await client.query(
          `INSERT INTO coverage_runs
             (build_id, execution_id, test_id, language, file, function, start_line, end_line, hits)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            buildId,
            execution?.id ?? null,
            testId,
            language,
            entry.file,
            entry.function,
            entry.startLine,
            entry.endLine,
            entry.hits,
          ]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({
        status: "ingested",
        buildId,
        testId,
        executionId: execution?.id ?? null,
        runId: execution?.runId ?? null,
        rows: coverage.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "ingestion failed", message: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = createIngestRouter;
