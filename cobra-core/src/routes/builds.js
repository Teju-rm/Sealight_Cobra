const express = require("express");

const router = express.Router();

/**
 * GET /builds
 * Lists recent builds with summary risk stats, for the dashboard's
 * multi-build table view. Same "untested = SUM(hits) = 0" logic as
 * GET /risk/:buildId, kept consistent here.
 */
module.exports = function createBuildsRouter(pool) {
  router.get("/builds", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    try {
      const result = await pool.query(
        `WITH untested AS (
           SELECT cf.build_id, cf.file, cf.function
           FROM changed_functions cf
           LEFT JOIN coverage_runs cr
             ON cr.build_id = cf.build_id AND cr.file = cf.file AND cr.function = cf.function
           GROUP BY cf.build_id, cf.file, cf.function
           HAVING COALESCE(SUM(cr.hits), 0) = 0
         ),
         changed_counts AS (
           SELECT build_id, COUNT(*)::int AS total_changed
           FROM changed_functions
           GROUP BY build_id
         ),
         untested_counts AS (
           SELECT build_id, COUNT(*)::int AS total_untested
           FROM untested
           GROUP BY build_id
         )
         SELECT b.build_id, b.repo, b.commit_sha, b.language, b.created_at,
                COALESCE(cc.total_changed, 0) AS total_changed,
                COALESCE(uc.total_untested, 0) AS total_untested
         FROM builds b
         LEFT JOIN changed_counts cc ON cc.build_id = b.build_id
         LEFT JOIN untested_counts uc ON uc.build_id = b.build_id
         ORDER BY b.created_at DESC
         LIMIT $1`,
        [limit]
      );

      const builds = result.rows.map((row) => {
        const totalChanged = row.total_changed;
        const totalUntested = row.total_untested;
        const codeChangesCoverage =
          totalChanged === 0 ? null : Math.round(((totalChanged - totalUntested) / totalChanged) * 100);
        const verdict = totalChanged === 0 ? "no_data" : totalUntested > 0 ? "fail" : "pass";

        return {
          buildId: row.build_id,
          repo: row.repo,
          commitSha: row.commit_sha,
          language: row.language,
          createdAt: row.created_at,
          totalChangedFunctions: totalChanged,
          untestedChangedFunctions: totalUntested,
          codeChangesCoverage,
          verdict,
        };
      });

      res.json({ builds });
    } catch (err) {
      console.error("GET /builds failed:", err);
      res.status(500).json({ error: "Failed to list builds" });
    }
  });

  return router;
};
