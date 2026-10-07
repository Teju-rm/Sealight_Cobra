const express = require("express");
const {
  defaultGateSettings,
  validateGateSettings,
} = require("../gateSettings");

const UNASSIGNED_BRANCH = "unassigned";

function createGateSettingsRouter(pool) {
  const router = express.Router();

  router.get("/apps/:app/branches/:branch/gate-settings", async (req, res) => {
    const app = req.params.app.trim();
    const branch = req.params.branch === UNASSIGNED_BRANCH ? "" : req.params.branch.trim();
    if (!app || !req.params.branch.trim()) {
      return res.status(400).json({ error: "app and branch are required" });
    }

    try {
      const result = await pool.query(
        `SELECT settings, effective_at
         FROM quality_gate_settings
         WHERE app = $1 AND branch = $2
         ORDER BY effective_at DESC, id DESC
         LIMIT 1`,
        [app, branch]
      );
      const row = result.rows[0];
      res.json({
        app,
        branch: branch || null,
        settings: row ? row.settings : defaultGateSettings(),
        configured: Boolean(row),
        effectiveAt: row ? row.effective_at : null,
        dataAvailability: { buildBranches: false, namedTestStages: false, failedTestCounts: false },
      });
    } catch (err) {
      console.error("GET gate settings failed:", err);
      res.status(500).json({ error: "Failed to fetch coverage settings" });
    }
  });

  router.put("/apps/:app/branches/:branch/gate-settings", async (req, res) => {
    const app = req.params.app.trim();
    const branch = req.params.branch === UNASSIGNED_BRANCH ? "" : req.params.branch.trim();
    if (!app || !req.params.branch.trim()) {
      return res.status(400).json({ error: "app and branch are required" });
    }

    const settings = req.body?.settings;
    const validationError = validateGateSettings(settings);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const result = await pool.query(
        `INSERT INTO quality_gate_settings (app, branch, settings)
         VALUES ($1, $2, $3::jsonb)
         RETURNING settings, effective_at`,
        [app, branch, JSON.stringify(settings)]
      );
      res.json({
        app,
        branch: branch || null,
        settings: result.rows[0].settings,
        configured: true,
        effectiveAt: result.rows[0].effective_at,
        dataAvailability: { buildBranches: false, namedTestStages: false, failedTestCounts: false },
      });
    } catch (err) {
      console.error("PUT gate settings failed:", err);
      res.status(500).json({ error: "Failed to save coverage settings" });
    }
  });

  return router;
}

module.exports = createGateSettingsRouter;
