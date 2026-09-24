#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { JsAdapter } = require("../src/adapters/js/JsAdapter");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Missing required --project <path-to-travel-trust-insurance>");
    process.exit(1);
  }

  const projectRoot = path.resolve(args.project);
  const artifactsDir = path.resolve(projectRoot, args.artifacts || "coverage-artifacts/playwright-tests");
  const buildId = args.build || process.env.BUILD_VERSION || "local";
  const ingestUrl = args["ingest-url"] || process.env.INGEST_URL || "http://127.0.0.1:4000/ingest";

  if (!fs.existsSync(artifactsDir)) {
    console.error(`No artifacts directory found at ${artifactsDir}. Run "npm run coverage:playwright" in TravelTrust first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(artifactsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No coverage record files found in ${artifactsDir}.`);
    process.exit(1);
  }

  const adapter = new JsAdapter({ projectRoot });
  let submitted = 0;
  let totalFunctions = 0;

  for (const file of files) {
    const filePath = path.join(artifactsDir, file);
    const record = adapter.parseNativeReport(filePath);
    const payload = adapter.toUCF(record, { buildId });
    if (payload.coverage.length === 0) {
      console.log(`skip  ${file} (no in-project functions resolved)`);
      continue;
    }
    await adapter.submit(payload, ingestUrl);
    submitted += 1;
    totalFunctions += payload.coverage.length;
    console.log(`sent  ${file}  ->  testId="${payload.testId}"  functions=${payload.coverage.length}`);
  }

  console.log(`\nDone. Submitted ${submitted}/${files.length} test records, ${totalFunctions} function-coverage rows, buildId=${buildId}.`);
}

main().catch((err) => {
  console.error("submit-js-coverage failed:", err.message);
  process.exit(1);
});
