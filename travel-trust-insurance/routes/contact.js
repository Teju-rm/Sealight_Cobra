const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const contactsPath = path.join(__dirname, '..', 'data', 'contacts.json');

// POST /api/contact - save contact message
router.post('/', function submitContactHandler(req, res) {
  try {
    const { name, email, message } = req.body;

    const errors = [];
    if (!name || name.trim().length < 2) {
      errors.push('Please enter your name.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Please enter a valid email address.');
    }
    if (!message || message.trim().length < 10) {
      errors.push('Please enter a message (at least 10 characters).');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    const contact = {
      id: 'MSG-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase(),
      name: name.trim(),
      email,
      message: message.trim(),
      timestamp: new Date().toISOString()
    };

    let contacts = [];
    try {
      const data = fs.readFileSync(contactsPath, 'utf8');
      contacts = JSON.parse(data);
    } catch (err) {
      contacts = [];
    }

    contacts.push(contact);
    fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2), 'utf8');

    res.json({
      success: true,
      message: 'Thank you for reaching out! We will get back to you within 24 hours.',
      contact
    });
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;

