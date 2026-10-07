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
        await client.query(
          `INSERT INTO test_executions
             (id, build_id, test_id, suite, status, duration_ms, executed_at, environment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            execution.id,
            buildId,
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
