const express = require("express");
const { pool } = require("../db/pool");
const { validateUCF } = require("../adapters/CoverageAdapter");

const router = express.Router();

router.post("/ingest", async (req, res) => {
  const { valid, errors } = validateUCF(req.body);
  if (!valid) return res.status(400).json({ error: "invalid UCF payload", details: errors });

  const { buildId, testId, language, coverage } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO builds (build_id, repo, commit_sha, language)
       VALUES ($1, 'unknown', 'unknown', $2)
       ON CONFLICT (build_id) DO NOTHING`,
      [buildId, language]
    );

    for (const entry of coverage) {
      await client.query(
        `INSERT INTO coverage_runs (build_id, test_id, language, file, function, start_line, end_line, hits)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [buildId, testId, language, entry.file, entry.function, entry.startLine, entry.endLine, entry.hits]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ status: "ingested", buildId, testId, rows: coverage.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "ingestion failed", message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
