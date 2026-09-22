const express = require('express');
const router = express.Router();
const { getDatabase, saveDatabase } = require('../db/database');

function formatAdminAuditLabel(action) {
  return `Admin action: ${action}`;
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    return res.redirect('/login');
  }

  next();
}

// GET /admin/claims — View all submitted claims (admin-only page)
router.get('/claims', requireAdmin, async function adminClaimsHandler(req, res) {
  try {
    const db = await getDatabase();

    // Query all claims ordered by most recent first
    const result = db.exec(
      'SELECT id, full_name, policy_number, email, phone, date_of_incident, claim_type, description, claim_id, created_at FROM claims ORDER BY created_at DESC'
    );

    // Parse sql.js result into array of objects
    const claims = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      const values = result[0].values;
      for (const row of values) {
        const obj = {};
        columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        claims.push(obj);
      }
    }

    res.render('admin-claims', {
      title: 'Admin — All Claims',
      navActive: '',
      claims
    });
  } catch (err) {
    console.error('Error fetching claims for admin:', err);
    res.status(500).send('Failed to load claims data.');
  }
});

// POST /admin/claims/:id/delete - Delete a settled claim (admin-only action)
router.post('/claims/:id/delete', requireAdmin, async function deleteAdminClaimHandler(req, res) {
  try {
    const db = await getDatabase();

    db.run('DELETE FROM claims WHERE id = ?', [req.params.id]);
    saveDatabase();

    res.redirect('/admin/claims');
  } catch (err) {
    console.error('Error deleting claim for admin:', err);
    res.status(500).send('Failed to delete claim.');
  }
});

module.exports = router;

