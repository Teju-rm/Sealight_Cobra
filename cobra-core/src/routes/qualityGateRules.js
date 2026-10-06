// src/routes/qualityGateRules.js
//
// Minimal CRUD surface for quality_gate_rules, used by risk.js to compute
// the pass/fail verdict. Supported metrics are defined in risk.js
// (SUPPORTED_METRICS) — this route does not validate metric names against
// that list, so a typo here will show up as a "skippedRules" entry on the
// /risk/:buildId response rather than failing at write time. That's a
// known tradeoff for keeping this endpoint simple; worth hardening later
// if rules start being set by more than one or two people by hand.

const express = require('express');

function createQualityGateRulesRouter(pool) {
  const router = express.Router();

  // POST /quality-gate-rules
  // body: { repo, metric, operator, threshold, enabled? }
  router.post('/quality-gate-rules', async (req, res) => {
    const { repo, metric, operator, threshold, enabled = true } = req.body || {};
    if (!repo || !metric || !operator || threshold === undefined) {
      return res.status(400).json({
        error: 'repo, metric, operator, and threshold are required',
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO quality_gate_rules (repo, metric, operator, threshold, enabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, repo, metric, operator, threshold, enabled, created_at`,
        [repo, metric, operator, threshold, enabled]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('POST /quality-gate-rules failed:', err);
      res.status(500).json({ error: 'Failed to create quality gate rule' });
    }
  });

  // GET /quality-gate-rules/:repo — lists all rules (enabled or not) for a
  // repo, mainly for debugging/verifying what GET /risk/:buildId will see.
  router.get('/quality-gate-rules/:repo', async (req, res) => {
    const { repo } = req.params;
    try {
      const result = await pool.query(
        `SELECT id, repo, metric, operator, threshold, enabled, created_at
         FROM quality_gate_rules
         WHERE repo = $1
         ORDER BY id`,
        [repo]
      );
      res.json(result.rows);
    } catch (err) {
      console.error(`GET /quality-gate-rules/${repo} failed:`, err);
      res.status(500).json({ error: 'Failed to fetch quality gate rules' });
    }
  });

  return router;
}

module.exports = createQualityGateRulesRouter;
