// src/server.js — temporary dev server for verifying risk.js locally.
// Once the real project server.js exists, delete this file and instead
// add these two lines to the real one's app.use(...) block:
//   const createRiskRouter = require('./routes/risk');
//   app.use(createRiskRouter(pool));
const express = require('express');
const pool = require('./db');
const createRiskRouter = require('./routes/risk');
const app = express();
app.use(createRiskRouter(pool));
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Mapping Engine dev server listening on http://localhost:${port}`);
  console.log(`Try: curl http://localhost:${port}/risk/test-run-1`);
});
