require("dotenv").config();
const express = require("express");
const { pool } = require("./db/pool");
const ingestRoute = require("./routes/ingest");
const buildScanRoute = require("./routes/buildScan");
const createRiskRouter = require("./routes/risk");
const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(require("path").join(__dirname, "..", "public")));
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use(ingestRoute);
app.use(buildScanRoute);
app.use(createRiskRouter(pool));
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
console.log(`COBRA Ingestion API listening on :${PORT}`);
});
