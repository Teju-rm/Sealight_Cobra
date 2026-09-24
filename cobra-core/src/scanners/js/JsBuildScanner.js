const { execFileSync } = require("child_process");
const path = require("path");
const { createInventory, inventorySource, allFunctions } = require("./inventory");

class JsBuildScanner {
  constructor({ projectRoot }) {
    this.projectRoot = projectRoot;
    this._repoRoot = undefined;
    this._subdir = undefined;
  }

  _resolveRepoRoot() {
    if (this._repoRoot !== undefined) return this._repoRoot;
    const repoRoot = path.resolve(this._git(["rev-parse", "--show-toplevel"], this.projectRoot).trim());
    const projectRoot = path.resolve(this.projectRoot);
    const relative = path.relative(repoRoot, projectRoot).split(path.sep).join("/");
    this._repoRoot = repoRoot;
    this._subdir = relative === "" ? null : relative;
    return this._repoRoot;
  }

  _resolveSubdir() {
    this._resolveRepoRoot();
    return this._subdir;
  }

  currentInventory() {
    return createInventory(this.projectRoot);
  }

  baselineInventory(ref) {
    const repoRoot = this._resolveRepoRoot();
    const subdir = this._subdir;
    const treeRef = subdir ? `${ref}:${subdir}` : ref;

    const names = this._git(["ls-tree", "-r", "--name-only", treeRef], repoRoot)
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((file) => /\.(?:js|cjs|mjs)$/.test(file))
      .filter((file) => !file.startsWith("node_modules/"));

    const files = {};
    for (const file of names) {
      try {
        const showRef = subdir ? `${ref}:${subdir}/${file}` : `${ref}:${file}`;
        const source = this._git(["show", showRef], repoRoot);
        files[file] = inventorySource(file, source);
      } catch (error) {
        console.warn(`Skipping ${file} at ${ref}: ${error.message}`);
      }
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), files };
  }

  _git(args, cwd = this.projectRoot) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }

  diff(current, baseline) {
    const previous = allFunctions(baseline);
    const latest = allFunctions(current);

    const unique = (functions) => {
      const groups = new Map();
      functions.forEach((fn) => groups.set(fn.logicalId, [...(groups.get(fn.logicalId) || []), fn]));
      return new Map([...groups].filter(([, entries]) => entries.length === 1).map(([id, entries]) => [id, entries[0]]));
    };

    const priorIds = new Map(previous.map((fn) => [fn.id, fn]));
    const latestIds = new Map(latest.map((fn) => [fn.id, fn]));
    const priorLogical = unique(previous);
    const latestLogical = unique(latest);

    const added = latest.filter((fn) => !priorIds.has(fn.id) && !priorLogical.has(fn.logicalId));
    const modified = latest.filter((fn) => {
      const prior = priorLogical.get(fn.logicalId);
      return prior && (prior.id !== fn.id || prior.hash !== fn.hash);
    });
    const removed = previous.filter((fn) => !latestIds.has(fn.id) && !latestLogical.has(fn.logicalId));

    return { added, modified, removed };
  }

  toChangedFunctionRecord({ buildId, repo, commitSha, baseRef = "HEAD~1" }) {
    const current = this.currentInventory();
    const baseline = this.baselineInventory(baseRef);
    const { added, modified, removed } = this.diff(current, baseline);

    const changes = [
      ...added.map((fn) => ({ file: fn.file, function: fn.name, startLine: fn.startLine, endLine: fn.endLine, status: "new" })),
      ...modified.map((fn) => ({ file: fn.file, function: fn.name, startLine: fn.startLine, endLine: fn.endLine, status: "modified" })),
      ...removed.map((fn) => ({ file: fn.file, function: fn.name, startLine: fn.startLine, endLine: fn.endLine, status: "deleted" })),
    ];

    return { buildId, repo, commitSha, language: "javascript", changes };
  }

  async submit(payload, buildScanUrl = process.env.BUILD_SCAN_URL || "http://127.0.0.1:4000/build-scan") {
    const res = await fetch(buildScanUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ingestion API rejected build-scan payload (${res.status}): ${text}`);
    }
    return res.json();
  }
}

module.exports = { JsBuildScanner };
