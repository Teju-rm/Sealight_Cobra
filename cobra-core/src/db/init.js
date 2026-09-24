const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { pool } = require("./pool");

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema applied: builds, changed_functions, coverage_runs");
  await pool.end();
}

init().catch((err) => {
  console.error("DB init failed:", err.message);
  process.exit(1);
});
