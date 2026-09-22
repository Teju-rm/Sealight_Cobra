const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'travelers.db');

let db = null;
let SQL = null;

async function getDatabase() {
  if (db) return db;

  // Initialize sql.js
  SQL = await initSqlJs();

  // Load existing database file or create a new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create claims table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      date_of_incident TEXT DEFAULT '',
      claim_type TEXT DEFAULT '',
      description TEXT NOT NULL,
      claim_id TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'Submitted',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Save the database file after creating the table
  saveDatabase();

  return db;
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

module.exports = { getDatabase, saveDatabase };

