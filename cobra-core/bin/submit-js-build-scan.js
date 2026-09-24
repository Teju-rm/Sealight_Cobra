#!/usr/bin/env node
const path = require("path");
const { execFileSync } = require("child_process");
const { JsBuildScanner } = require("../src/scanners/js/JsBuildScanner");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.build || !args.repo) {
    console.error("Usage: --project <path> --build <buildId> --repo <name> [--base-ref HEAD~1] [--build-scan-url url]");
    process.exit(1);
  }

  const projectRoot = path.resolve(args.project);
  const baseRef = args["base-ref"] || "HEAD~1";
  const buildScanUrl = args["build-scan-url"] || process.env.BUILD_SCAN_URL || "http://127.0.0.1:4000/build-scan";

  let commitSha = "unknown";
  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    console.warn("Could not resolve HEAD commit sha (is this a git repo?) — continuing with 'unknown'.");
  }

  const scanner = new JsBuildScanner({ projectRoot });
  const payload = scanner.toChangedFunctionRecord({ buildId: args.build, repo: args.repo, commitSha, baseRef });

  console.log(`Comparing working tree against ${baseRef}...`);
  console.log(`  new:      ${payload.changes.filter((c) => c.status === "new").length}`);
  console.log(`  modified: ${payload.changes.filter((c) => c.status === "modified").length}`);
  console.log(`  deleted:  ${payload.changes.filter((c) => c.status === "deleted").length}`);

  if (payload.changes.length === 0) {
    console.log("No changes detected — nothing to submit.");
    return;
  }

  const result = await scanner.submit(payload, buildScanUrl);
  console.log(`\nSubmitted. Server response:`, result);
}

main().catch((err) => {
  console.error("submit-js-build-scan failed:", err.message);
  process.exit(1);
});
