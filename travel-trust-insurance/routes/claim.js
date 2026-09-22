const express = require('express');
const router = express.Router();
const { getDatabase, saveDatabase } = require('../db/database');

// Generate a unique claim ID: CLM- followed by random alphanumeric
function generateClaimId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'CLM-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST /api/claims — Submit a new claim
router.post('/', async function submitClaimHandler(req, res) {
  const { fullName, policyNumber, email, phone, incidentDate, claimType, description } = req.body;

  // Validation
  const errors = [];
  if (!fullName || !fullName.trim()) errors.push('Full name is required.');
  if (!policyNumber || !policyNumber.trim()) errors.push('Policy number is required.');
  if (!email || !email.trim()) errors.push('Email is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email is required.');
  if (!description || !description.trim()) errors.push('Description of the incident is required.');

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(' ') });
  }

  const claimId = generateClaimId();

  try {
    const db = await getDatabase();

    db.run(
      `INSERT INTO claims (full_name, policy_number, email, phone, date_of_incident, claim_type, description, claim_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName.trim(),
        policyNumber.trim(),
        email.trim(),
        phone ? phone.trim() : '',
        incidentDate || '',
        claimType || '',
        description.trim(),
        claimId
      ]
    );

    // Persist the database to disk
    saveDatabase();

    res.status(201).json({
      success: true,
      message: 'Claim submitted successfully.',
      claim_id: claimId,
      claim: { id: claimId },
      email: email.trim()
    });
  } catch (err) {
    console.error('Error saving claim to database:', err);
    res.status(500).json({ error: 'Failed to save claim. Please try again.' });
  }
});

// GET /api/claims — Retrieve all claims (for potential admin use)
router.get('/', async function listClaimsHandler(req, res) {
  try {
    const db = await getDatabase();
    const result = db.exec('SELECT * FROM claims ORDER BY created_at DESC');
    
    // Parse the result into objects
    const claims = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      const values = result[0].values;
      for (const row of values) {
        const obj = {};
        columns.forEach((col, idx) => { obj[col] = row[idx]; });
        claims.push(obj);
      }
    }
    
    res.json(claims);
  } catch (err) {
    console.error('Error fetching claims:', err);
    res.status(500).json({ error: 'Failed to retrieve claims.' });
  }
});

// GET /api/claims/lookup?claimId=xxx&policyNumber=yyy — Look up a claim by ID and policy number
router.get('/lookup', async function lookupClaimHandler(req, res) {
  const { claimId, policyNumber } = req.query;

  if (!claimId || !policyNumber) {
    return res.status(400).json({ error: 'Both Claim ID and Policy Number are required.' });
  }

  try {
    const db = await getDatabase();
    const result = db.exec(
      'SELECT * FROM claims WHERE claim_id = ? AND policy_number = ?',
      [claimId, policyNumber]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'No claim found with the provided Claim ID and Policy Number combination.' });
    }

    const columns = result[0].columns;
    const row = result[0].values[0];
    const claim = {};
    columns.forEach((col, idx) => { claim[col] = row[idx]; });

    res.json({
      id: claim.claim_id,
      fullName: claim.full_name,
      policyNumber: claim.policy_number,
      claimType: claim.claim_type,
      incidentDate: claim.date_of_incident,
      description: claim.description,
      status: claim.status,
      timestamp: claim.created_at
    });
  } catch (err) {
    console.error('Error looking up claim:', err);
    res.status(500).json({ error: 'Failed to look up claim.' });
  }
});

module.exports = router;

