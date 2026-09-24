require("dotenv").config();
const express = require("express");
const ingestRoute = require("./routes/ingest");
const buildScanRoute = require("./routes/buildScan");

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use(ingestRoute);
app.use(buildScanRoute);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`COBRA Ingestion API listening on :${PORT}`);
});
