const express = require("express");
const { pool } = require("../db/pool");
const { validateBuildScan } = require("../adapters/ChangedFunctionRecord");

const router = express.Router();

router.post("/build-scan", async (req, res) => {
  const { valid, errors } = validateBuildScan(req.body);
  if (!valid) return res.status(400).json({ error: "invalid build-scan payload", details: errors });

  const { buildId, repo, branch, commitSha, language, changes } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO builds (build_id, repo, branch, commit_sha, language)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (build_id) DO UPDATE SET repo = EXCLUDED.repo,
         branch = COALESCE(EXCLUDED.branch, builds.branch), commit_sha = EXCLUDED.commit_sha`,
      [buildId, repo, branch ?? null, commitSha, language]
    );

    for (const entry of changes) {
      await client.query(
        `INSERT INTO changed_functions (build_id, file, function, start_line, end_line, status, author)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [buildId, entry.file, entry.function, entry.startLine, entry.endLine, entry.status, entry.author ?? null]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ status: "recorded", buildId, changes: changes.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "build-scan ingestion failed", message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
