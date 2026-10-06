// scripts/seed-quality-gate-rules.js
//
// Quick one-off way to add a rule without curling the POST endpoint.
// Usage:
//   node scripts/seed-quality-gate-rules.js --repo travel-trust-insurance --metric code_changes_coverage --operator ">=" --threshold 50
//
// Reuses the same DB_* env vars as src/db.js (host/port/database/user/password).

require('dotenv').config();
const { Pool } = require('pg');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { repo, metric, operator, threshold, enabled } = args;

  if (!repo || !metric || !operator || threshold === undefined) {
    console.error(
      'Usage: node scripts/seed-quality-gate-rules.js --repo <repo> --metric <metric> --operator <op> --threshold <n> [--enabled true|false]'
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'cobra',
    user: process.env.DB_USER || 'cobra',
    password: process.env.DB_PASSWORD || 'cobra',
  });

  try {
    const result = await pool.query(
      `INSERT INTO quality_gate_rules (repo, metric, operator, threshold, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, repo, metric, operator, threshold, enabled`,
      [repo, metric, operator, Number(threshold), enabled !== 'false']
    );
    console.log('Inserted rule:', result.rows[0]);
  } catch (err) {
    console.error('Failed to insert rule:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
