const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const leadsPath = path.join(__dirname, '..', 'data', 'leads.json');

// GET /api/quote - placeholder
router.get('/', function quoteReadyHandler(req, res) {
  res.json({ message: 'Quote endpoint ready' });
});

// POST /api/quote - save lead data
router.post('/', function submitQuoteHandler(req, res) {
  try {
    const { fullName, zipCode, insuranceType, email, phone } = req.body;

    // Validate
    const errors = [];
    if (!fullName || fullName.trim().length < 2) {
      errors.push('Please enter your full name.');
    }
    if (!zipCode || !/^\d{5}(-\d{4})?$/.test(zipCode)) {
      errors.push('Please enter a valid 5-digit ZIP code.');
    }
    if (!insuranceType) {
      errors.push('Please select an insurance type.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Please enter a valid email address.');
    }
    if (!phone || !/^[\d\s\-\(\)]{7,15}$/.test(phone)) {
      errors.push('Please enter a valid phone number.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const lead = {
      id: 'LEAD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase(),
      fullName: fullName.trim(),
      zipCode,
      insuranceType,
      email,
      phone,
      timestamp: new Date().toISOString()
    };

    let leads = [];
    try {
      const data = fs.readFileSync(leadsPath, 'utf8');
      leads = JSON.parse(data);
    } catch (err) {
      leads = [];
    }

    leads.push(lead);
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf8');

    res.json({
      success: true,
      message: 'Thank you! Your quote request has been submitted.',
      lead
    });
  } catch (error) {
    console.error('Error saving lead:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;

