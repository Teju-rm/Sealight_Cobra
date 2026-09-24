// src/db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'cobra',
  user: process.env.DB_USER || 'cobra',
  password: process.env.DB_PASSWORD || 'cobra',
});

module.exports = pool;
