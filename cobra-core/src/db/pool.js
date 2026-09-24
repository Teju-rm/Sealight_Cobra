const { Pool } = require("pg");

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || "cobra",
      password: process.env.PGPASSWORD || "cobra",
      database: process.env.PGDATABASE || "cobra",
    });

module.exports = { pool };
