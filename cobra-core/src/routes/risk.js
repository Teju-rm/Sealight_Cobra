// src/routes/risk.js
//
// Mapping Engine — GET /risk/:buildId
//
// For a given build, returns:
//   - untestedChanges:    changed functions with zero total coverage hits
//   - testRecommendations: tests that already cover at least one changed function
//   - riskScore:          share of changed functions that are untested (0-1, 2dp)
//
// Does not touch changed_functions / coverage_runs writes — those stay in
// build-scan.js and ingest.js. This route only reads.

const express = require('express');

// Injected so tests can pass a mock/stub pool without hitting a real DB.
// In server.js this is called as createRiskRouter(pool).
// A fresh Router is created per call — a module-level singleton would
// accumulate a new /risk/:buildId handler on every call (e.g. once per
// test), and Express would keep answering with the first one registered.
function createRiskRouter(pool) {
  const router = express.Router();

  router.get('/risk/:buildId', async (req, res) => {
    const { buildId } = req.params;

    try {
      const untestedResult = await pool.query(
        `SELECT cf.file, cf.function, cf.status
         FROM changed_functions cf
         LEFT JOIN coverage_runs cr
           ON cr.build_id = cf.build_id
          AND cr.file = cf.file
          AND cr.function = cf.function
         WHERE cf.build_id = $1
         GROUP BY cf.file, cf.function, cf.status
         HAVING COALESCE(SUM(cr.hits), 0) = 0`,
        [buildId]
      );

      const untestedChanges = untestedResult.rows.map((row) => ({
        file: row.file,
        function: row.function,
        status: row.status,
      }));

      const recommendationsResult = await pool.query(
        `SELECT cr.test_id, cf.function
         FROM coverage_runs cr
         JOIN changed_functions cf
           ON cf.build_id = cr.build_id
          AND cf.file = cr.file
          AND cf.function = cr.function
         WHERE cr.build_id = $1
         GROUP BY cr.test_id, cf.function
         HAVING SUM(cr.hits) > 0`,
        [buildId]
      );

      const byTestId = new Map();
      for (const row of recommendationsResult.rows) {
        if (!byTestId.has(row.test_id)) {
          byTestId.set(row.test_id, []);
        }
        byTestId.get(row.test_id).push(row.function);
      }

      const testRecommendations = Array.from(byTestId.entries()).map(
        ([testId, coversChangedFunctions]) => ({
          testId,
          coversChangedFunctions,
        })
      );

      const totalResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM changed_functions
         WHERE build_id = $1`,
        [buildId]
      );
      const totalChanged = totalResult.rows[0].total;
      const riskScore =
        totalChanged === 0
          ? 0
          : Math.round((untestedChanges.length / totalChanged) * 100) / 100;

      res.json({
        buildId,
        untestedChanges,
        testRecommendations,
        riskScore,
      });
    } catch (err) {
      console.error(`GET /risk/${buildId} failed:`, err);
      res.status(500).json({ error: 'Failed to compute risk for build' });
    }
  });

  return router;
}

module.exports = createRiskRouter;
